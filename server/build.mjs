// Empacota o backend em um único arquivo ESM. Dependências de node_modules ficam externas
// (pdfjs-dist precisa dos arquivos de fontes padrão em disco).
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: "dist/index.js",
  packages: "external",
  // @estudos/shared é código-fonte TypeScript do monorepo: precisa ser embutido.
  alias: { "@estudos/shared": "../shared/src/index.ts" },
  sourcemap: true,
  logLevel: "info",
});
