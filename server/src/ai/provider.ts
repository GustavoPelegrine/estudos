/** Contrato comum dos provedores de IA (Gemini real ou simulado para desenvolvimento/testes). */

export type AiTask = "questions" | "flashcards" | "tutor";

export interface LabeledChunk {
  /** Rótulo curto usado no prompt e nas citações do modelo (ex.: "T3"). */
  label: string;
  fileName: string;
  subjectName: string;
  page: number;
  heading: string | null;
  text: string;
}

export interface AiRequest {
  task: AiTask;
  system: string;
  prompt: string;
  /** Esquema de resposta no formato OpenAPI aceito pela Gemini API (responseSchema). */
  responseSchema: Record<string, unknown>;
  temperature: number;
  maxOutputTokens: number;
  /** Dados estruturados usados apenas pelo provedor simulado. */
  context: { chunks: LabeledChunk[]; count?: number; question?: string };
}

export interface AiUsage {
  promptTokens: number;
  outputTokens: number;
}

export interface AiResponse {
  text: string;
  usage: AiUsage;
  model: string;
}

export interface AiProvider {
  readonly name: "gemini" | "fake";
  readonly model: string;
  generate(req: AiRequest, signal?: AbortSignal): Promise<AiResponse>;
}

export type AiErrorKind = "timeout" | "rate_limited" | "unavailable" | "blocked" | "invalid_response" | "config";

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}
