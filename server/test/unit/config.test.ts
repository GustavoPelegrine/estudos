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
  it("na Vercel assume produção (e por isso recusa emuladores e IA simulada)", () => {
    expect(loadConfig({ VERCEL: "1", GEMINI_API_KEY: "x" }).NODE_ENV).toBe("production");
    expect(() => loadConfig({ VERCEL: "1", AI_PROVIDER: "fake" })).toThrow(/simulado/);
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

describe("credencial da conta de serviço (Vercel)", () => {
  const sa = { type: "service_account", project_id: "p", client_email: "x@p.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" };
  it("aceita o JSON puro ou em base64", async () => {
    const { parseServiceAccount } = await import("../../src/firebase.js");
    expect(parseServiceAccount(JSON.stringify(sa)).clientEmail).toBe(sa.client_email);
    expect(parseServiceAccount(Buffer.from(JSON.stringify(sa)).toString("base64")).projectId).toBe("p");
  });
  it("rejeita conteúdo inválido sem expor o segredo na mensagem", async () => {
    const { parseServiceAccount } = await import("../../src/firebase.js");
    expect(() => parseServiceAccount("segredo-quebrado")).toThrow(/FIREBASE_SERVICE_ACCOUNT inválida/);
    expect(() => parseServiceAccount("segredo-quebrado")).not.toThrow(/segredo-quebrado/);
  });
});
