import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { Config } from "./config.js";

export interface FirebaseServices {
  app: App;
  auth: Auth;
  db: Firestore;
  bucket: ReturnType<ReturnType<typeof getStorage>["bucket"]>;
}

/**
 * Em produção (Cloud Run), as credenciais vêm da conta de serviço do ambiente (ADC):
 * nenhum arquivo de chave é necessário nem deve ser incluído no repositório.
 * Em desenvolvimento/testes, as variáveis *_EMULATOR_HOST direcionam tudo aos emuladores.
 */
export function initFirebase(config: Config, name = "[DEFAULT]"): FirebaseServices {
  const existing = getApps().find((a) => a.name === name);
  const bucketName = config.FIREBASE_STORAGE_BUCKET ?? `${config.FIREBASE_PROJECT_ID}.firebasestorage.app`;
  const app = existing ?? initializeApp({ projectId: config.FIREBASE_PROJECT_ID, storageBucket: bucketName }, name);
  const db = getFirestore(app);
  if (!existing) db.settings({ ignoreUndefinedProperties: true });
  return { app, auth: getAuth(app), db, bucket: getStorage(app).bucket(bucketName) };
}
