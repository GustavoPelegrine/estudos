// Servidor HTTP para desenvolvimento local (e para quem preferir rodar em um servidor próprio).
import { AiService } from "./ai/service.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { initFirebase } from "./firebase.js";
import { log } from "./lib/log.js";
import { createAiProvider } from "./providers.js";

const config = loadConfig();
const firebase = initFirebase(config);
const ai = new AiService(createAiProvider(config), firebase.db, config);
const app = createApp({ config, firebase, ai });

app.listen(config.PORT, () => {
  log.info("server_started", { port: config.PORT, env: config.NODE_ENV, aiProvider: config.aiProvider, model: ai.modelName, emulators: config.emulators });
});
