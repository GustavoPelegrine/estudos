import { describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "../../src/ai/gemini.js";
import { AiError, type AiRequest } from "../../src/ai/provider.js";

const req: AiRequest = { task: "tutor", system: "s", prompt: "p", responseSchema: {}, temperature: 0.2, maxOutputTokens: 100, context: { chunks: [] } };
const ok = (text: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "pensando…", thought: true }, { text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 }, ...extra }), { status: 200 });

function provider(fetchImpl: typeof fetch, over: Partial<ConstructorParameters<typeof GeminiProvider>[0]> = {}) {
  return new GeminiProvider({ apiKey: "CHAVE-SECRETA", model: "gemini-3.8-flash", timeoutMs: 1000, maxRetries: 2, fetchImpl, sleep: async () => undefined, ...over });
}

describe("cliente Gemini", () => {
  it("envia a chave no cabeçalho (nunca na URL) e ignora partes de raciocínio", async () => {
    const fetchImpl = vi.fn(async () => ok('{"a":1}'));
    const res = await provider(fetchImpl as unknown as typeof fetch).generate(req);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(url).not.toContain("CHAVE");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("CHAVE-SECRETA");
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.systemInstruction.parts[0].text).toBe("s");
    expect(res.text).toBe('{"a":1}');
    expect(res.usage).toEqual({ promptTokens: 10, outputTokens: 5 });
  });

  it("tenta novamente em 503/429 e depois tem sucesso", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 503 })).mockResolvedValueOnce(new Response("{}", { status: 429 })).mockResolvedValueOnce(ok("{}"));
    await expect(provider(fetchImpl).generate(req)).resolves.toMatchObject({ text: "{}" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("não repete erros de configuração (chave/modelo inválidos)", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 }));
    await expect(provider(fetchImpl as unknown as typeof fetch).generate(req)).rejects.toMatchObject({ kind: "config" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("desiste após o número máximo de tentativas", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    await expect(provider(fetchImpl as unknown as typeof fetch).generate(req)).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("aplica timeout por tentativa", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    await expect(provider(fetchImpl as unknown as typeof fetch, { timeoutMs: 20, maxRetries: 1 }).generate(req)).rejects.toMatchObject({ kind: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("trata bloqueio de segurança, resposta vazia e truncada", async () => {
    await expect(provider(vi.fn(async () => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 })) as unknown as typeof fetch).generate(req)).rejects.toMatchObject({ kind: "blocked" });
    const empty = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [] } }] }), { status: 200 }));
    await expect(provider(empty as unknown as typeof fetch, { maxRetries: 0 }).generate(req)).rejects.toBeInstanceOf(AiError);
    const truncated = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":' }] }, finishReason: "MAX_TOKENS" }] }), { status: 200 }));
    await expect(provider(truncated as unknown as typeof fetch, { maxRetries: 0 }).generate(req)).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("falha de rede vira erro amigável", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(provider(fetchImpl as unknown as typeof fetch, { maxRetries: 0 }).generate(req)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("envia o nível de raciocínio e, se o modelo recusar, segue sem ele", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT" } }), { status: 400 })).mockImplementation(async () => ok("{}"));
    const p = provider(fetchImpl as unknown as typeof fetch, { thinkingLevel: "low" });
    await expect(p.generate(req)).resolves.toMatchObject({ text: "{}" });
    const first = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
    const second = JSON.parse((fetchImpl.mock.calls[1]![1] as RequestInit).body as string);
    expect(first.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
    expect(second.generationConfig.thinkingConfig).toBeUndefined();
    await p.generate(req); // chamadas seguintes já não enviam
    const third = JSON.parse((fetchImpl.mock.calls[2]![1] as RequestInit).body as string);
    expect(third.generationConfig.thinkingConfig).toBeUndefined();
  });

  it("sem nível configurado, não envia thinkingConfig; 400 sem thinking não é repetido", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT" } }), { status: 400 }));
    await expect(provider(fetchImpl as unknown as typeof fetch).generate(req)).rejects.toMatchObject({ kind: "config" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).generationConfig.thinkingConfig).toBeUndefined();
  });
});
