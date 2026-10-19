/**
 * Entrada da função serverless na Vercel (versão custo zero).
 * A Vercel chama o handler com (req, res) do Node; o app Express é criado uma vez por instância.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { AiService } from "./ai/service.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { initFirebase } from "./firebase.js";
import { createAiProvider } from "./providers.js";

let app: ReturnType<typeof createApp> | null = null;

function getApp() {
  if (!app) {
    const config = loadConfig();
    const firebase = initFirebase(config);
    app = createApp({ config, firebase, ai: new AiService(createAiProvider(config), firebase.db, config) });
  }
  return app;
}

export default function handler(req: IncomingMessage, res: ServerResponse) {
  // A rota da Vercel envia /api/<caminho> para esta função como /api?__path=<caminho>, caso a URL original não seja preservada.
  const url = new URL(req.url ?? "/", "http://local");
  const original = url.searchParams.get("__path");
  if (original !== null && url.pathname === "/api") {
    url.searchParams.delete("__path");
    const qs = url.searchParams.toString();
    req.url = `/api/${original}${qs ? `?${qs}` : ""}`;
  } else if (original !== null) {
    url.searchParams.delete("__path");
    req.url = `${url.pathname}${url.searchParams.size ? `?${url.searchParams}` : ""}`;
  }
  return getApp()(req as Parameters<ReturnType<typeof createApp>>[0], res as Parameters<ReturnType<typeof createApp>>[1]);
}
