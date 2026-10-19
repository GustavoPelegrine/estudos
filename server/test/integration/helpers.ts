import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { FakeAiProvider } from "../../src/ai/fake.js";
import type { AiProvider, AiRequest, AiResponse } from "../../src/ai/provider.js";
import { AiService } from "../../src/ai/service.js";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import { initFirebase } from "../../src/firebase.js";

export const PROJECT = "demo-estudos-odonto";

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST) {
  throw new Error("Testes de integração exigem os emuladores. Rode: npm run test:emulator (na raiz do projeto).");
}

/** Provedor de IA controlável nos testes: registra requisições e permite simular falhas. */
export class SpyProvider implements AiProvider {
  readonly name = "fake" as const;
  readonly model = "teste";
  readonly requests: AiRequest[] = [];
  private readonly fake = new FakeAiProvider();
  mode: "ok" | "invalid_json" | "timeout" | "unavailable" = "ok";

  async generate(req: AiRequest): Promise<AiResponse> {
    this.requests.push(req);
    const { AiError } = await import("../../src/ai/provider.js");
    if (this.mode === "invalid_json") return { text: "não é json {", model: this.model, usage: { promptTokens: 1, outputTokens: 1 } };
    if (this.mode === "timeout") throw new AiError("timeout", "A IA demorou demais para responder.", true);
    if (this.mode === "unavailable") throw new AiError("unavailable", "A Gemini API está indisponível no momento.", true);
    return this.fake.generate(req);
  }
}

export interface TestServer {
  url: string;
  provider: SpyProvider;
  firebase: ReturnType<typeof initFirebase>;
  close: () => Promise<void>;
}

export async function startServer(env: Record<string, string> = {}, appName = "test"): Promise<TestServer> {
  const config = loadConfig({ ...process.env, NODE_ENV: "test", FIREBASE_PROJECT_ID: PROJECT, AI_PROVIDER: "fake", ...env });
  const firebase = initFirebase(config, appName);
  const provider = new SpyProvider();
  const ai = new AiService(config.aiProvider === "none" ? null : provider, firebase.db, config);
  const app = createApp({ config, firebase, ai });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, provider, firebase, close: () => new Promise((r) => server.close(() => r())) };
}

/** Cria um usuário no emulador do Auth e devolve um ID token real. */
export async function signUp(email: string, password = "senha-forte-123"): Promise<{ uid: string; token: string }> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = (await res.json()) as { localId: string; idToken: string };
  if (!res.ok) throw new Error(`signUp falhou: ${JSON.stringify(body)}`);
  return { uid: body.localId, token: body.idToken };
}

export async function signInAnonymously(): Promise<string> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  return ((await res.json()) as { idToken: string }).idToken;
}

export async function clearEmulators(): Promise<void> {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
}

export function client(base: string, token?: string) {
  const call = async <T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* corpo não-JSON (ex.: PDF) */
    }
    return { status: res.status, body: parsed as T };
  };
  return {
    get: <T = any>(p: string) => call<T>("GET", p),
    post: <T = any>(p: string, b: unknown = {}) => call<T>("POST", p, b),
    patch: <T = any>(p: string, b: unknown) => call<T>("PATCH", p, b),
    del: <T = any>(p: string, b?: unknown) => call<T>("DELETE", p, b),
    raw: (p: string) => fetch(`${base}/api${p}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }),
  };
}
