import { FakeAiProvider } from "./ai/fake.js";
import { GeminiProvider } from "./ai/gemini.js";
import type { AiProvider } from "./ai/provider.js";
import type { Config } from "./config.js";

export function createAiProvider(config: Config): AiProvider | null {
  if (config.aiProvider === "gemini") {
    return new GeminiProvider({ apiKey: config.GEMINI_API_KEY as string, model: config.GEMINI_MODEL, timeoutMs: config.GEMINI_TIMEOUT_MS, maxRetries: config.GEMINI_MAX_RETRIES });
  }
  if (config.aiProvider === "fake") return new FakeAiProvider();
  return null;
}
