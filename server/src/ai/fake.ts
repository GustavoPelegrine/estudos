import type { AiProvider, AiRequest, AiResponse, LabeledChunk } from "./provider.js";

/**
 * Provedor SIMULADO, apenas para desenvolvimento local e testes automatizados.
 * Produz respostas estruturalmente válidas a partir dos trechos recebidos, sem qualquer
 * inteligência real. É bloqueado em produção (ver config.ts) e todas as respostas são
 * marcadas como simuladas para não serem confundidas com conteúdo gerado pela Gemini.
 */
export class FakeAiProvider implements AiProvider {
  readonly name = "fake" as const;
  readonly model = "simulado-local";

  async generate(req: AiRequest): Promise<AiResponse> {
    const { chunks, count = 5, question = "" } = req.context;
    let data: unknown;
    if (req.task === "questions") data = { questions: makeQuestions(chunks, count) };
    else if (req.task === "flashcards") data = { cards: makeCards(chunks, count) };
    else data = makeTutor(chunks, question);
    return { text: JSON.stringify(data), model: this.model, usage: { promptTokens: 0, outputTokens: 0 } };
  }
}

function sentences(chunk: LabeledChunk): string[] {
  return chunk.text
    .replace(/\n/g, " ")
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 300);
}

function makeQuestions(chunks: LabeledChunk[], count: number) {
  const pool = chunks.flatMap((c) => sentences(c).map((s) => ({ c, s })));
  const out = [];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const { c, s } = pool[i] as { c: LabeledChunk; s: string };
    const others = pool.filter((_, j) => j !== i).slice(0, 12);
    const distractors = [0, 1, 2].map((k) => {
      const o = others[(i + k * 3) % Math.max(others.length, 1)];
      return o ? `[simulado] Afirmação não relacionada: ${o.s.slice(0, 90)} (${k + 1})` : `[simulado] Alternativa incorreta ${k + 1}`;
    });
    out.push({
      stem: `[Questão simulada ${i + 1}] Considerando o tema "${c.heading ?? c.subjectName}", qual descrição é sustentada pelo trecho estudado?`,
      options: [s, ...distractors],
      correctIndex: 0,
      explanation: `[simulado] A alternativa correta corresponde ao trecho ${c.label}.`,
      optionExplanations: ["", "[simulado] Não corresponde ao trecho.", "[simulado] Não corresponde ao trecho.", "[simulado] Não corresponde ao trecho."],
      topic: c.heading ?? c.subjectName,
      skill: "conceito",
      difficulty: "media",
      sourceIds: [c.label],
    });
  }
  return out;
}

function makeCards(chunks: LabeledChunk[], count: number) {
  return chunks
    .flatMap((c) => sentences(c).map((s) => ({ c, s })))
    .slice(0, count)
    .map(({ c, s }, i) => ({
      front: `[Cartão simulado ${i + 1}] O que o material afirma sobre ${c.heading ?? c.subjectName}?`,
      back: s,
      topic: c.heading ?? c.subjectName,
      sourceIds: [c.label],
    }));
}

function makeTutor(chunks: LabeledChunk[], question: string) {
  const top = chunks.slice(0, 2);
  if (!top.length) return { answer: "Não encontrei evidências nos trechos fornecidos.", evidence: "insuficiente", complementaryNote: "" };
  return {
    answer: `[Resposta simulada — IA real não configurada] Sobre "${question.slice(0, 80)}", os trechos mais relevantes dizem: ${top
      .map((c) => `${sentences(c)[0] ?? c.text.slice(0, 160)} [${c.label}]`)
      .join(" ")}`,
    evidence: "parcial",
    complementaryNote: "",
  };
}
