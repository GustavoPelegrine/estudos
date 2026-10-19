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

  async generateQuestions(uid: string, chunks: Chunk[], opts: { count: number; difficulty: Difficulty | "mista"; focus?: string; subjectName: string }) {
    const { labeled, labels } = label(chunks);
    const { system, prompt } = questionsPrompt(labeled, opts);
    return this.run(uid, { task: "questions", system, prompt, responseSchema: QUESTIONS_SCHEMA, temperature: 0.55, maxOutputTokens: 16_384, context: { chunks: labeled, count: opts.count } }, (raw) => {
      const result = validateQuestions(raw, labels, { subjectName: opts.subjectName });
      if (!result.questions.length) throw new AiError("invalid_response", "Nenhuma questão gerada passou na validação de qualidade.", true);
      return { questions: result.questions.slice(0, opts.count) as Question[], rejected: result.rejected };
    });
  }

  async generateFlashcards(uid: string, chunks: Chunk[], opts: { count: number; focus?: string }): Promise<{ cards: ValidCard[]; rejected: number }> {
    const { labeled, labels } = label(chunks);
    const { system, prompt } = flashcardsPrompt(labeled, opts);
    return this.run(uid, { task: "flashcards", system, prompt, responseSchema: FLASHCARDS_SCHEMA, temperature: 0.4, maxOutputTokens: 8192, context: { chunks: labeled, count: opts.count } }, (raw) => {
      const result = validateFlashcards(raw, labels);
      if (!result.cards.length) throw new AiError("invalid_response", "Nenhum flashcard gerado passou na validação.", true);
      return { cards: result.cards.slice(0, opts.count), rejected: result.rejected };
    });
  }

  async tutor(uid: string, chunks: Chunk[], question: string, history: { role: "user" | "assistant"; text: string }[]): Promise<TutorResult> {
    const { labeled, labels } = label(chunks);
    const { system, prompt } = tutorPrompt(labeled, question, history);
    return this.run(uid, { task: "tutor", system, prompt, responseSchema: TUTOR_SCHEMA, temperature: 0.3, maxOutputTokens: 6144, context: { chunks: labeled, question } }, (raw) => validateTutor(raw, labels));
  }

  private async run<T>(uid: string, req: AiRequest, validate: (raw: unknown) => T): Promise<T & { model: string }> {
    if (!this.provider) throw new AppError(503, "ai_unavailable", "A IA não está configurada neste servidor.");
    const reservation = await reserveAiCall(this.db, this.config, uid);
    // Uma nova tentativa apenas para respostas fora do formato (os erros de rede já têm retry no cliente).
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.provider.generate(req);
        await recordTokens(this.db, uid, res.usage.promptTokens, res.usage.outputTokens).catch(() => undefined);
        const out = validate(parseJson(res.text));
        return { ...out, model: res.model };
      } catch (err) {
        const aiErr = err instanceof AiError ? err : null;
        if (aiErr?.kind === "invalid_response" && attempt === 0) {
          log.warn("ai_invalid_response_retry", { task: req.task });
          continue;
        }
        await reservation.refund().catch(() => undefined);
        if (err instanceof AppError) throw err;
        if (aiErr) throw toAppError(aiErr);
        log.error("ai_unexpected_error", { task: req.task, name: (err as Error).name });
        throw new AppError(500, "ai_error", "Erro inesperado ao consultar a IA.");
      }
    }
    await reservation.refund().catch(() => undefined);
    throw new AppError(502, "ai_invalid_response", "A IA não retornou um resultado válido. Tente novamente.");
  }
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
