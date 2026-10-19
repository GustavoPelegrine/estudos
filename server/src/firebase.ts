import { cert, getApps, initializeApp, type App, type ServiceAccount } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Config } from "./config.js";

export interface FirebaseServices {
  app: App;
  auth: Auth;
  db: Firestore;
}

/**
 * Credenciais:
 * - Vercel (custo zero): FIREBASE_SERVICE_ACCOUNT com o JSON da conta de serviço (texto puro ou base64),
 *   guardado apenas nas variáveis de ambiente da Vercel — nunca no repositório.
 * - Google Cloud (Cloud Run): credenciais do ambiente (ADC), sem variável.
 * - Desenvolvimento/testes: as variáveis *_EMULATOR_HOST direcionam tudo aos emuladores.
 */
export function initFirebase(config: Config, name = "[DEFAULT]"): FirebaseServices {
  const existing = getApps().find((a) => a.name === name);
  const credential = config.FIREBASE_SERVICE_ACCOUNT ? cert(parseServiceAccount(config.FIREBASE_SERVICE_ACCOUNT)) : undefined;
  const app = existing ?? initializeApp({ projectId: config.FIREBASE_PROJECT_ID, ...(credential ? { credential } : {}) }, name);
  const db = getFirestore(app);
  if (!existing) db.settings({ ignoreUndefinedProperties: true });
  return { app, auth: getAuth(app), db };
}

export function parseServiceAccount(raw: string): ServiceAccount {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  try {
    const json = JSON.parse(text) as { project_id?: string; client_email?: string; private_key?: string };
    if (!json.client_email || !json.private_key) throw new Error();
    return { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key };
  } catch {
    // Não inclui o conteúdo na mensagem: é um segredo.
    throw new Error("FIREBASE_SERVICE_ACCOUNT inválida: cole o JSON completo da conta de serviço (ou o JSON em base64).");
  }
}
