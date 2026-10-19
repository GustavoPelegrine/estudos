// Grava os PDFs de teste em disco (útil para testar o upload manualmente na interface).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeMixedPdf, makeScannedPdf, makeTextPdf, makeTwoColumnPdf, makeInjectionPdf } from "./pdfs.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "generated");
mkdirSync(out, { recursive: true });
const files: Record<string, () => Promise<Uint8Array>> = {
  "texto-simples.pdf": makeTextPdf,
  "duas-colunas.pdf": makeTwoColumnPdf,
  "digitalizado.pdf": () => makeScannedPdf(2),
  "misto.pdf": makeMixedPdf,
  "instrucoes-maliciosas.pdf": makeInjectionPdf,
};
for (const [name, make] of Object.entries(files)) {
  writeFileSync(join(out, name), await make());
  console.log("gerado", join(out, name));
}
