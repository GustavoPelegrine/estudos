#!/usr/bin/env node
/**
 * Simula localmente a Vercel servindo .vercel/output (após "npm run build:vercel"):
 * arquivos estáticos com os cabeçalhos de config.json, /api/* → função empacotada,
 * demais rotas → index.html. Serve para validar o pacote antes de publicar.
 * Uso: PORT=3000 node --no-experimental-require-module scripts/serve-vercel-output.mjs
 *      (a flag reproduz a restrição do runtime da Vercel; variáveis do backend no ambiente)
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const out = resolve(".vercel/output");
const config = JSON.parse(readFileSync(join(out, "config.json"), "utf8"));
const vc = JSON.parse(readFileSync(join(out, "functions/api.func/.vc-config.json"), "utf8"));
const { default: handler } = await import(pathToFileURL(join(out, "functions/api.func", vc.handler)).href);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".wasm": "application/wasm" };

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  for (const r of config.routes) {
    if (r.headers && new RegExp(`^${r.src}$`).test(path)) for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  }
  const api = /^\/api\/(.*)$/.exec(path);
  if (api) {
    // Reproduz a reescrita da rota: /api/<caminho>?q → /api?__path=<caminho>&q
    const qs = new URL(req.url, "http://x").searchParams;
    qs.set("__path", api[1]);
    req.url = `/api?${qs}`;
    return handler(req, res);
  }
  let file = join(out, "static", path);
  if (path.startsWith("/assets/") && !existsSync(file)) {
    res.statusCode = 404;
    return res.end("not found");
  }
  if (!file.startsWith(join(out, "static")) || !existsSync(file) || statSync(file).isDirectory()) file = join(out, "static/index.html");
  res.setHeader("Content-Type", types[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT ?? 3000), "127.0.0.1", () => console.log(`Simulação da Vercel em http://127.0.0.1:${process.env.PORT ?? 3000}`));
