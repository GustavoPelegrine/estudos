/**
 * Wrapper do extrator para Node (PDF.js "legacy"). Na versão custo zero a extração roda no navegador;
 * este módulo é usado pelos testes e pelo gerador de dados de exemplo, com o MESMO algoritmo (@estudos/shared/pdf).
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { extractPdf as extractWith, type ExtractOptions, type ExtractResult, type PdfJsLike } from "@estudos/shared/pdf";

export { looksLikePdf, PdfExtractionError } from "@estudos/shared/pdf";

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
let pdfjsPromise: Promise<PdfJsLike> | null = null;

export async function extractPdf(bytes: Uint8Array, options: Omit<ExtractOptions, "docParams">): Promise<ExtractResult> {
  pdfjsPromise ??= import(pathToFileURL(join(pdfjsRoot, "legacy/build/pdf.mjs")).href) as Promise<PdfJsLike>;
  const pdfjs = await pdfjsPromise;
  return extractWith(pdfjs, bytes, {
    ...options,
    // O PDF.js em Node aceita caminhos de arquivo terminados em "/".
    docParams: { standardFontDataUrl: join(pdfjsRoot, "standard_fonts") + "/", cMapUrl: join(pdfjsRoot, "cmaps") + "/", cMapPacked: true },
  });
}
