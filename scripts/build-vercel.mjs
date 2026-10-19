#!/usr/bin/env node
/**
 * Gera .vercel/output no formato "Build Output API v3" da Vercel:
 *   static/              → site React (web/dist)
 *   functions/api.func/  → API Express empacotada (+ dependências rastreadas com @vercel/nft)
 *   config.json          → rotas (/api/* → função; demais → SPA) e cabeçalhos de segurança
 * Na Vercel: Build Command = "npm run build:vercel" (ver vercel.json).
 */
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { nodeFileTrace } from "@vercel/nft";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, ".vercel/output");
const funcDir = join(out, "functions/api.func");
const entryRel = "server/dist-vercel/vercel.mjs";

rmSync(out, { recursive: true, force: true });
mkdirSync(funcDir, { recursive: true });

// 1) Frontend
console.log("› build do frontend");
execSync("npm run build -w web", { cwd: root, stdio: "inherit" });
cpSync(join(root, "web/dist"), join(out, "static"), { recursive: true });

// 2) Função da API: nosso código empacotado; dependências do node_modules ficam externas e são copiadas.
console.log("› empacotando a API");
const entry = join(root, entryRel);
await build({
  entryPoints: [join(root, "server/src/vercel.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: entry,
  packages: "external",
  alias: { "@estudos/shared/pdf": join(root, "shared/src/pdf/index.ts"), "@estudos/shared": join(root, "shared/src/index.ts") },
  logLevel: "warning",
});
const { fileList } = await nodeFileTrace([entry], { base: root });
for (const file of fileList) {
  const dest = join(funcDir, file);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(join(root, file), dest, { dereference: true });
}
writeFileSync(
  join(funcDir, ".vc-config.json"),
  JSON.stringify({ runtime: "nodejs22.x", handler: entryRel, launcherType: "Nodejs", shouldAddHelpers: false, maxDuration: 60 }, null, 2),
);

// 3) Rotas e cabeçalhos
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // O emulador de login só é liberado em builds de teste local (VITE_USE_EMULATORS=true), nunca em produção.
  `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com${process.env.VITE_USE_EMULATORS === "true" ? " http://127.0.0.1:9099" : ""}`,
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "object-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");
const config = {
  version: 3,
  routes: [
    {
      src: "/(.*)",
      headers: {
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        "X-Frame-Options": "SAMEORIGIN",
      },
      continue: true,
    },
    { src: "/assets/(.*)", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
    // __path preserva o caminho original caso a plataforma entregue a URL reescrita à função.
    { src: "/api/(.*)", dest: "/api?__path=$1" },
    { handle: "filesystem" },
    { src: "/(.*)", dest: "/index.html", headers: { "Cache-Control": "no-cache" } },
  ],
};
writeFileSync(join(out, "config.json"), JSON.stringify(config, null, 2));
console.log(`✓ .vercel/output pronto (${fileList.size} arquivos na função)`);
