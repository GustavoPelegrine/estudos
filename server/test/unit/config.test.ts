import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

describe("configuração", () => {
  it("usa Gemini apenas quando há chave e escolhe o modelo padrão", () => {
    expect(loadConfig({}).aiProvider).toBe("none");
    const c = loadConfig({ GEMINI_API_KEY: "x" });
    expect(c.aiProvider).toBe("gemini");
    expect(c.GEMINI_MODEL).toBe("gemini-3.8-flash");
  });
  it("bloqueia IA simulada e emuladores em produção", () => {
    expect(() => loadConfig({ NODE_ENV: "production", AI_PROVIDER: "fake" })).toThrow(/simulado/);
    expect(() => loadConfig({ NODE_ENV: "production", GEMINI_API_KEY: "x", FIRESTORE_EMULATOR_HOST: "localhost:8085" })).toThrow(/emulador/);
  });
  it("exige chave quando AI_PROVIDER=gemini", () => {
    expect(() => loadConfig({ AI_PROVIDER: "gemini" })).toThrow(/GEMINI_API_KEY/);
  });
  it("não expõe o valor de variáveis inválidas na mensagem de erro", () => {
    expect(() => loadConfig({ MAX_PDF_MB: "segredo-invalido" })).toThrow(/MAX_PDF_MB/);
    expect(() => loadConfig({ MAX_PDF_MB: "segredo-invalido" })).not.toThrow(/segredo/);
  });
  it("lê listas de e-mails permitidos", () => {
    expect(loadConfig({ ALLOWED_EMAILS: " A@x.com, b@y.com " }).ALLOWED_EMAILS).toEqual(["a@x.com", "b@y.com"]);
  });
});
