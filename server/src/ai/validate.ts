import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Difficulty, Question, SourceRef } from "@estudos/shared";
import type { Chunk } from "../rag/chunker.js";
import { normalize } from "../rag/text.js";
import { AiError } from "./provider.js";
import { QUESTION_SKILLS } from "./prompts.js";

const text = (min: number, max: number) => z.string().trim().min(min).max(max);

const rawQuestion = z.object({
  stem: text(15, 1200),
  options: z.array(text(1, 500)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  explanation: text(10, 2500),
  optionExplanations: z.array(z.string().max(1200)).length(4).catch(["", "", "", ""]),
  topic: text(2, 120),
  skill: z.enum(QUESTION_SKILLS).catch("conceito"),
  difficulty: z.enum(["facil", "media", "dificil"]).catch("media"),
  sourceIds: z.array(z.string()).max(8).catch([]),
});
const rawQuestions = z.object({ questions: z.array(z.unknown()).max(60) });

const rawCard = z.object({
  front: text(5, 500),
  back: text(5, 1500),
  topic: text(2, 120),
  sourceIds: z.array(z.string()).max(8).catch([]),
});
const rawCards = z.object({ cards: z.array(z.unknown()).max(80) });

const rawTutor = z.object({
  answer: text(1, 12_000),
  evidence: z.enum(["suficiente", "parcial", "insuficiente"]),
  complementaryNote: z.string().max(3000).catch(""),
});

export function parseJson(textOut: string): unknown {
  // Alguns modelos envolvem o JSON em ```json … ``` mesmo com responseMimeType.
  const cleaned = textOut.trim().replace(/^```(?:json)?\s*/iu, "").replace(/```$/u, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AiError("invalid_response", "A IA retornou um formato inválido.", true);
  }
}

/** Mapa rótulo → trecho, usado para transformar sourceIds em referências verificáveis. */
export type LabelMap = Map<string, Chunk>;

export function toSourceRef(chunk: Chunk): SourceRef {
  return {
    materialId: chunk.materialId,
    fileName: chunk.fileName,
    subjectName: chunk.subjectName,
    page: chunk.page,
    excerpt: excerpt(chunk.text),
  };
}

function excerpt(s: string, max = 320): string {
  const flat = s.replace(/\s+/gu, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function validLabels(ids: string[], labels: LabelMap): Chunk[] {
  const out: Chunk[] = [];
  for (const id of ids) {
    const chunk = labels.get(id.trim().replace(/^\[|\]$/gu, ""));
    if (chunk && !out.includes(chunk)) out.push(chunk);
  }
  return out;
}

const BANNED_STEM = [
  /(afirma[çc][aã]o|alternativa|frase|informa[çc][aã]o)[^?]{0,40}(aparece|presente|consta|mencionad|citad)[^?]{0,30}(material|texto|apostila|trecho)/iu,
  /\b(segundo|de acordo com|conforme) (o|a) (texto|trecho|material|apostila)\b/iu,
  /\btrecho\s*T?\d+\b|\bT\d+\b/u,
];
const BANNED_OPTION = /^(todas|nenhuma) (as|das) (anteriores|alternativas)|^(a|b|c|d) e (b|c|d)\b|^apenas (a|b|c|d)\b/iu;

export interface QuestionValidationResult {
  questions: Question[];
  rejected: number;
}

/**
 * Valida e normaliza questões geradas:
 * - estrutura (4 alternativas, índice válido, campos obrigatórios);
 * - alternativas distintas e sem "todas/nenhuma das anteriores";
 * - enunciado sem moldes proibidos e sem citar rótulos internos;
 * - pelo menos uma referência a um trecho realmente fornecido (questão fundamentada);
 * - enunciados duplicados;
 * - redistribui a posição da alternativa correta de forma equilibrada.
 */
export function validateQuestions(raw: unknown, labels: LabelMap, opts: { subjectName: string; random?: () => number }): QuestionValidationResult {
  const parsed = rawQuestions.safeParse(raw);
  if (!parsed.success) throw new AiError("invalid_response", "A IA retornou questões em formato inválido.", true);
  const random = opts.random ?? Math.random;
  const seenStems = new Set<string>();
  const accepted: Question[] = [];
  let rejected = 0;
  for (const item of parsed.data.questions) {
    const q = rawQuestion.safeParse(item);
    if (!q.success) {
      rejected++;
      continue;
    }
    const v = q.data;
    const normOptions = v.options.map((o) => normalize(o));
    const sources = validLabels(v.sourceIds, labels);
    const stemKey = normalize(v.stem);
    const bad =
      new Set(normOptions).size !== 4 ||
      normOptions.some((o) => !o) ||
      v.options.some((o) => BANNED_OPTION.test(o.trim())) ||
      BANNED_STEM.some((re) => re.test(v.stem)) ||
      sources.length === 0 ||
      seenStems.has(stemKey);
    if (bad) {
      rejected++;
      continue;
    }
    seenStems.add(stemKey);
    const primary = sources[0] as Chunk;
    accepted.push({
      id: randomUUID(),
      stem: v.stem,
      options: v.options as Question["options"],
      correctIndex: v.correctIndex,
      explanation: v.explanation,
      optionExplanations: v.optionExplanations.map((e, i) => (i === v.correctIndex ? "" : e.trim())) as Question["optionExplanations"],
      topic: v.topic,
      skill: v.skill,
      difficulty: v.difficulty as Difficulty,
      subjectName: primary.subjectName || opts.subjectName,
      source: toSourceRef(primary),
    });
  }
  balanceCorrectPositions(accepted, random);
  return { questions: accepted, rejected };
}

/** Distribui as respostas corretas entre A–D de forma equilibrada e embaralha os distratores. */
export function balanceCorrectPositions(questions: Question[], random: () => number = Math.random): void {
  const targets: number[] = [];
  while (targets.length < questions.length) targets.push(...shuffle([0, 1, 2, 3], random));
  questions.forEach((q, i) => {
    const target = targets[i] as number;
    const pairs = q.options.map((option, idx) => ({ option, why: q.optionExplanations[idx] ?? "", correct: idx === q.correctIndex }));
    const correct = pairs.find((p) => p.correct)!;
    const others = shuffle(pairs.filter((p) => !p.correct), random);
    others.splice(target, 0, correct);
    q.options = others.map((p) => p.option) as Question["options"];
    q.optionExplanations = others.map((p) => p.why) as Question["optionExplanations"];
    q.correctIndex = target;
  });
}

function shuffle<T>(arr: T[], random: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

export interface ValidCard {
  front: string;
  back: string;
  topic: string;
  source: SourceRef;
  materialId: string;
  subjectName: string;
}

export function validateFlashcards(raw: unknown, labels: LabelMap): { cards: ValidCard[]; rejected: number } {
  const parsed = rawCards.safeParse(raw);
  if (!parsed.success) throw new AiError("invalid_response", "A IA retornou flashcards em formato inválido.", true);
  const seen = new Set<string>();
  const cards: ValidCard[] = [];
  let rejected = 0;
  for (const item of parsed.data.cards) {
    const c = rawCard.safeParse(item);
    const sources = c.success ? validLabels(c.data.sourceIds, labels) : [];
    const key = c.success ? normalize(c.data.front) : "";
    if (!c.success || !sources.length || seen.has(key) || BANNED_STEM[2]!.test(c.data.front)) {
      rejected++;
      continue;
    }
    seen.add(key);
    const primary = sources[0] as Chunk;
    cards.push({ front: c.data.front, back: c.data.back, topic: c.data.topic, source: toSourceRef(primary), materialId: primary.materialId, subjectName: primary.subjectName });
  }
  return { cards, rejected };
}

export interface TutorResult {
  text: string;
  citations: SourceRef[];
  grounded: boolean;
}

/**
 * Converte a resposta do tutor: rótulos [T3] viram números [1], [2]… ligados às referências reais.
 * Rótulos inexistentes são removidos (o modelo não pode criar citações).
 */
export function validateTutor(raw: unknown, labels: LabelMap): TutorResult {
  const parsed = rawTutor.safeParse(raw);
  if (!parsed.success) throw new AiError("invalid_response", "A IA retornou uma resposta em formato inválido.", true);
  const { answer, evidence, complementaryNote } = parsed.data;
  const citations: SourceRef[] = [];
  const numberOf = new Map<string, number>();
  const body = answer
    .replace(/\[\s*(T\d+(?:\s*[,;]\s*T\d+)*)\s*\]/gu, (_, group: string) => {
      const nums: number[] = [];
      for (const label of group.split(/[,;]/u).map((s) => s.trim())) {
        const chunk = labels.get(label);
        if (!chunk) continue;
        const key = `${chunk.materialId}:${chunk.page}`;
        let n = numberOf.get(key);
        if (!n) {
          citations.push(toSourceRef(chunk));
          n = citations.length;
          numberOf.set(key, n);
        }
        if (!nums.includes(n)) nums.push(n);
      }
      return nums.length ? `[${nums.join(", ")}]` : "";
    })
    .replace(/[ \t]+([.,;:])/gu, "$1")
    .trim();
  const grounded = evidence !== "insuficiente" && citations.length > 0;
  let textOut = body;
  if (!grounded) {
    textOut = `${body}\n\n⚠ Não encontrei evidências suficientes nos materiais selecionados para sustentar esta resposta. Confira em uma fonte confiável.`;
  } else if (evidence === "parcial") {
    textOut = `${body}\n\nObservação: os materiais selecionados respondem apenas parcialmente a esta pergunta.`;
  }
  const note = complementaryNote.replace(/\[\s*T\d+[^\]]*\]/gu, "").trim();
  if (note) textOut += `\n\nComplemento (não consta nos seus materiais — confirme com o professor ou bibliografia): ${note}`;
  return { text: textOut, citations, grounded };
}
