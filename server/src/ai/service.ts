import type { Firestore } from "firebase-admin/firestore";
import type { Difficulty, Question } from "@estudos/shared";
import type { Config } from "../config.js";
import { AppError } from "../http/errors.js";
import { log } from "../lib/log.js";
import type { Chunk } from "../rag/chunker.js";
import { recordTokens, reserveAiCall } from "../services/usage.js";
import { FLASHCARDS_SCHEMA, QUESTIONS_SCHEMA, TUTOR_SCHEMA, flashcardsPrompt, questionsPrompt, tutorPrompt } from "./prompts.js";
import { AiError, type AiProvider, type AiRequest, type LabeledChunk } from "./provider.js";
import { parseJson, validateFlashcards, validateQuestions, validateTutor, type LabelMap, type TutorResult, type ValidCard } from "./validate.js";

/**
 * Camada de serviço de IA: única porta de saída para o provedor.
 * Responsável por cota, montagem de prompts, novas tentativas de formato e validação.
 */
export class AiService {
  constructor(
    private readonly provider: AiProvider | null,
    private readonly db: Firestore,
    private readonly config: Config,
  ) {}

  get available(): boolean {
    return this.provider !== null;
  }

  get modelName(): string | null {
    return this.provider?.model ?? null;
  }

  get providerName(): "gemini" | "fake" | "none" {
    return this.provider?.name ?? "none";
  }

  /**
   * Questões e flashcards são gerados em LOTES PARALELOS (cada lote com uma parte dos trechos):
   * respostas menores chegam bem mais rápido e cabem no limite de tempo da função serverless.
   * Se um lote falhar, os demais são aproveitados; a validação final remove duplicatas e
   * redistribui a posição das respostas corretas.
   */
  async generateQuestions(uid: string, chunks: Chunk[], opts: { count: number; difficulty: Difficulty | "mista"; focus?: string; subjectName: string }) {
    const { labeled, labels } = label(chunks);
    const reqs = splitBatches(labeled, opts.count, QUESTIONS_PER_BATCH).map(({ part, count }) => {
      const { system, prompt } = questionsPrompt(part, { ...opts, count });
      return { task: "questions", system, prompt, responseSchema: QUESTIONS_SCHEMA, temperature: 0.55, maxOutputTokens: 8192, context: { chunks: part, count } } satisfies AiRequest;
    });
    return this.runMany(uid, reqs, (raws) => {
      const result = validateQuestions({ questions: raws.flatMap(listOf("questions")) }, labels, { subjectName: opts.subjectName });
      if (!result.questions.length) throw new AiError("invalid_response", "Nenhuma questão gerada passou na validação de qualidade.");
      return { questions: result.questions.slice(0, opts.count) as Question[], rejected: result.rejected };
    });
  }

  async generateFlashcards(uid: string, chunks: Chunk[], opts: { count: number; focus?: string }): Promise<{ cards: ValidCard[]; rejected: number; model: string }> {
    const { labeled, labels } = label(chunks);
    const reqs = splitBatches(labeled, opts.count, CARDS_PER_BATCH).map(({ part, count }) => {
      const { system, prompt } = flashcardsPrompt(part, { ...opts, count });
      return { task: "flashcards", system, prompt, responseSchema: FLASHCARDS_SCHEMA, temperature: 0.4, maxOutputTokens: 6144, context: { chunks: part, count } } satisfies AiRequest;
    });
    return this.runMany(uid, reqs, (raws) => {
      const result = validateFlashcards({ cards: raws.flatMap(listOf("cards")) }, labels);
      if (!result.cards.length) throw new AiError("invalid_response", "Nenhum flashcard gerado passou na validação.");
      return { cards: result.cards.slice(0, opts.count), rejected: result.rejected };
    });
  }

  async tutor(uid: string, chunks: Chunk[], question: string, history: { role: "user" | "assistant"; text: string }[]): Promise<TutorResult> {
    const { labeled, labels } = label(chunks);
    const { system, prompt } = tutorPrompt(labeled, question, history);
    const req: AiRequest = { task: "tutor", system, prompt, responseSchema: TUTOR_SCHEMA, temperature: 0.3, maxOutputTokens: 6144, context: { chunks: labeled, question } };
    return this.runMany(uid, [req], (raws) => validateTutor(raws[0], labels));
  }

  /** Uma operação (uma unidade da cota diária) com uma ou mais requisições em paralelo, sob o mesmo orçamento de tempo. */
  private async runMany<T>(uid: string, reqs: AiRequest[], combine: (raws: unknown[]) => T): Promise<T & { model: string }> {
    if (!this.provider) throw new AppError(503, "ai_unavailable", "A IA não está configurada neste servidor.");
    const reservation = await reserveAiCall(this.db, this.config, uid);
    const budget = new AbortController();
    const budgetTimer = setTimeout(() => budget.abort(), this.config.AI_TIME_BUDGET_MS);
    try {
      const settled = await Promise.allSettled(reqs.map((req) => this.oneRequest(req, budget.signal, uid)));
      const ok = settled.filter((r): r is PromiseFulfilledResult<{ raw: unknown; model: string }> => r.status === "fulfilled").map((r) => r.value);
      if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
      if (ok.length < reqs.length) log.warn("ai_partial_batches", { task: reqs[0]?.task, ok: ok.length, total: reqs.length });
      return { ...combine(ok.map((r) => r.raw)), model: (ok[0] as { model: string }).model };
    } catch (err) {
      await reservation.refund().catch(() => undefined);
      if (err instanceof AppError) throw err;
      if (err instanceof AiError) throw toAppError(err);
      log.error("ai_unexpected_error", { task: reqs[0]?.task, name: (err as Error).name });
      throw new AppError(500, "ai_error", "Erro inesperado ao consultar a IA.");
    } finally {
      clearTimeout(budgetTimer);
    }
  }

  /** Uma requisição ao provedor, com uma nova tentativa se a resposta vier fora do formato JSON. */
  private async oneRequest(req: AiRequest, signal: AbortSignal, uid: string): Promise<{ raw: unknown; model: string }> {
    const provider = this.provider as AiProvider;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await provider.generate(req, signal);
        await recordTokens(this.db, uid, res.usage.promptTokens, res.usage.outputTokens).catch(() => undefined);
        return { raw: parseJson(res.text), model: res.model };
      } catch (err) {
        if (err instanceof AiError && err.kind === "invalid_response" && attempt === 0 && !signal.aborted) {
          log.warn("ai_invalid_response_retry", { task: req.task });
          continue;
        }
        throw err;
      }
    }
  }
}

const QUESTIONS_PER_BATCH = 4;
const CARDS_PER_BATCH = 7;
const MAX_BATCHES = 3;

/** Divide os trechos (intercalados, para cada lote cobrir o material todo) e a quantidade entre os lotes. */
export function splitBatches<C>(chunks: C[], total: number, perBatch: number): { part: C[]; count: number }[] {
  const n = Math.max(1, Math.min(MAX_BATCHES, Math.ceil(total / perBatch), chunks.length));
  return Array.from({ length: n }, (_, i) => ({
    part: chunks.filter((_, j) => j % n === i),
    count: Math.floor(total / n) + (i < total % n ? 1 : 0),
  }));
}

function listOf(key: string) {
  return (raw: unknown): unknown[] => {
    const value = (raw as Record<string, unknown> | null)?.[key];
    return Array.isArray(value) ? value : [];
  };
}

function label(chunks: Chunk[]): { labeled: LabeledChunk[]; labels: LabelMap } {
  const labels: LabelMap = new Map();
  const labeled = chunks.map((c, i) => {
    const l = `T${i + 1}`;
    labels.set(l, c);
    return { label: l, fileName: c.fileName, subjectName: c.subjectName, page: c.page, heading: c.heading, text: c.text };
  });
  return { labeled, labels };
}

export function toAppError(err: AiError): AppError {
  switch (err.kind) {
    case "timeout":
      return new AppError(504, "ai_timeout", err.message);
    case "rate_limited":
      return new AppError(429, "ai_rate_limited", err.message);
    case "blocked":
      return new AppError(422, "ai_blocked", err.message);
    case "invalid_response":
      return new AppError(502, "ai_invalid_response", "A IA não retornou um resultado válido. Tente novamente.");
    case "config":
      return new AppError(503, "ai_config", err.message);
    default:
      return new AppError(503, "ai_unavailable", err.message);
  }
}
