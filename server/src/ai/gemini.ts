import { log } from "../lib/log.js";
import { AiError, type AiProvider, type AiRequest, type AiResponse } from "./provider.js";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  /** generationConfig.thinkingConfig.thinkingLevel; omitido quando indefinido. */
  thinkingLevel?: string;
  fetchImpl?: typeof fetch;
  /** Espera entre tentativas (substituível nos testes). */
  sleep?: (ms: number) => Promise<void>;
}

interface GeminiPart {
  text?: string;
  thought?: boolean;
}

interface GeminiBody {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { code?: number; status?: string; message?: string };
}

/**
 * Cliente REST mínimo da Gemini API.
 * - A chave vai no cabeçalho x-goog-api-key (nunca na URL, para não aparecer em logs).
 * - Timeout por tentativa com AbortController.
 * - Novas tentativas com backoff exponencial apenas para 429/5xx/timeout.
 */
export class GeminiProvider implements AiProvider {
  readonly name = "gemini" as const;
  readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Vira true se a API recusar o thinkingConfig (ex.: modelo trocado): o app segue sem ele. */
  private thinkingRejected = false;

  constructor(private readonly options: GeminiOptions) {
    this.model = options.model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async generate(req: AiRequest, signal?: AbortSignal): Promise<AiResponse> {
    let lastError: AiError | null = null;
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(Math.min(8000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250));
      if (signal?.aborted) break;
      try {
        return await this.once(req, signal);
      } catch (err) {
        lastError = err instanceof AiError ? err : new AiError("unavailable", "Falha de comunicação com a IA.", true);
        if (!lastError.retryable || signal?.aborted) break;
        log.warn("gemini_retry", { attempt: attempt + 1, kind: lastError.kind });
      }
    }
    throw lastError ?? new AiError("timeout", "A IA demorou demais para responder.");
  }

  private async once(req: AiRequest, outerSignal?: AbortSignal): Promise<AiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const onAbort = () => controller.abort();
    outerSignal?.addEventListener("abort", onAbort, { once: true });
    const started = Date.now();
    const sendThinking = Boolean(this.options.thinkingLevel) && !this.thinkingRejected;
    let res: Response;
    try {
      res = await this.fetchImpl(`${API_BASE}/models/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": this.options.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          generationConfig: {
            temperature: req.temperature,
            maxOutputTokens: req.maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: req.responseSchema,
            ...(sendThinking ? { thinkingConfig: { thinkingLevel: this.options.thinkingLevel } } : {}),
          },
        }),
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) throw new AiError("timeout", "A IA demorou demais para responder.", true);
      throw new AiError("unavailable", "Não foi possível conectar à IA.", true);
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener("abort", onAbort);
    }

    const body = (await res.json().catch(() => ({}))) as GeminiBody;
    if (!res.ok && res.status === 400 && sendThinking) {
      // O modelo não aceitou o nível de raciocínio: desliga o parâmetro e tenta de novo (retry imediato).
      this.thinkingRejected = true;
      log.warn("gemini_thinking_rejected", { level: this.options.thinkingLevel });
      throw new AiError("unavailable", "Ajustando a configuração da IA.", true);
    }
    if (!res.ok) {
      // Registra apenas status e código — nunca o corpo da requisição.
      log.warn("gemini_http_error", { status: res.status, apiStatus: body.error?.status, task: req.task });
      if (res.status === 429) throw new AiError("rate_limited", "Limite de uso da Gemini API atingido. Tente novamente em alguns minutos.", true);
      if (res.status >= 500) throw new AiError("unavailable", "A Gemini API está indisponível no momento.", true);
      if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) {
        throw new AiError("config", "A integração com a IA está mal configurada (chave ou modelo). Avise a administração.");
      }
      throw new AiError("unavailable", "A IA recusou a solicitação.");
    }
    if (body.promptFeedback?.blockReason) throw new AiError("blocked", "A solicitação foi bloqueada pelos filtros de segurança da IA.");
    const candidate = body.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? "")
      .join("")
      .trim();
    if (candidate?.finishReason === "SAFETY") throw new AiError("blocked", "A resposta foi bloqueada pelos filtros de segurança da IA.");
    if (!text) throw new AiError("invalid_response", "A IA não retornou conteúdo.", true);
    if (candidate?.finishReason === "MAX_TOKENS") throw new AiError("invalid_response", "A resposta da IA foi interrompida por excesso de tamanho.", true);
    log.info("gemini_ok", {
      task: req.task,
      ms: Date.now() - started,
      promptTokens: body.usageMetadata?.promptTokenCount,
      outputTokens: body.usageMetadata?.candidatesTokenCount,
    });
    return {
      text,
      model: this.model,
      usage: { promptTokens: body.usageMetadata?.promptTokenCount ?? 0, outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0 },
    };
  }
}
