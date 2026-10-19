import { initializeApp } from "firebase/app";
import { browserLocalPersistence, connectAuthEmulator, getAuth, setPersistence } from "firebase/auth";

/**
 * Configuração PÚBLICA do Firebase (identifica o projeto; não é segredo).
 * A chave da Gemini API nunca chega ao navegador: toda chamada de IA passa pelo backend.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const usingEmulators = import.meta.env.VITE_USE_EMULATORS === "true";

export const app = initializeApp(config);
export const auth = getAuth(app);
auth.languageCode = "pt-BR";

// Sessão persistente no dispositivo (o Firebase renova o token automaticamente).
void setPersistence(auth, browserLocalPersistence);

if (usingEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}
