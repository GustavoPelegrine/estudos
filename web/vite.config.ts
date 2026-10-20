import { cpSync, createReadStream, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Arquivos auxiliares do PDF.js (mapas de caracteres, fontes padrão, decodificadores de imagem em WebAssembly),
 * servidos em /pdfjs/. São baixados pelo leitor só quando um PDF precisa deles.
 */
const PDFJS_DIRS = ["cmaps", "standard_fonts", "wasm", "iccs"];
function pdfjsAssets(): Plugin {
  const root = dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
  let outDir = "dist";
  return {
    name: "pdfjs-assets",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use("/pdfjs", (req, res, next) => {
        const file = normalize(join(root, decodeURIComponent((req.url ?? "").split("?")[0] ?? "")));
        if (!file.startsWith(root) || !PDFJS_DIRS.some((d) => file.startsWith(join(root, d))) || !existsSync(file) || !statSync(file).isFile()) return next();
        if (file.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      for (const d of PDFJS_DIRS) cpSync(join(root, d), join(outDir, "pdfjs", d), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    // Em desenvolvimento, /api é encaminhado ao backend local (em produção o Firebase Hosting faz isso).
    proxy: { "/api": { target: "http://127.0.0.1:8080", changeOrigin: false } },
  },
  build: { sourcemap: false, target: "es2022" },
  test: { environment: "jsdom", setupFiles: ["./src/test-setup.ts"], css: false },
});
