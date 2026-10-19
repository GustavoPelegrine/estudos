import { FakeAiProvider } from "./ai/fake.js";
import { GeminiProvider } from "./ai/gemini.js";
import type { AiProvider } from "./ai/provider.js";
import { AiService } from "./ai/service.js";
import { createApp } from "./app.js";
import { loadConfig, type Config } from "./config.js";
import { initFirebase } from "./firebase.js";
import { log } from "./lib/log.js";

export function createAiProvider(config: Config): AiProvider | null {
  if (config.aiProvider === "gemini") {
    return new GeminiProvider({ apiKey: config.GEMINI_API_KEY as string, model: config.GEMINI_MODEL, timeoutMs: config.GEMINI_TIMEOUT_MS, maxRetries: config.GEMINI_MAX_RETRIES });
  }
  if (config.aiProvider === "fake") return new FakeAiProvider();
  return null;
}

const config = loadConfig();
const firebase = initFirebase(config);
const ai = new AiService(createAiProvider(config), firebase.db, config);
const app = createApp({ config, firebase, ai });

app.listen(config.PORT, () => {
  log.info("server_started", { port: config.PORT, env: config.NODE_ENV, aiProvider: config.aiProvider, model: ai.modelName, emulators: config.emulators });
});
