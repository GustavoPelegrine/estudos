import { extractPdf as extractWith, type ExtractResult, type PdfJsLike } from "@estudos/shared/pdf";

/**
 * Extração do texto do PDF NO NAVEGADOR (versão custo zero: o arquivo não é enviado para a nuvem).
 * Usa o mesmo algoritmo de layout testado no backend (@estudos/shared/pdf).
 * O PDF.js é carregado sob demanda para não pesar no carregamento inicial do app.
 */
let pdfjsPromise: Promise<PdfJsLike> | null = null;

async function loadPdfJs(): Promise<PdfJsLike> {
  pdfjsPromise ??= (async () => {
    // Build "legacy": inclui compatibilidade com navegadores menos recentes (Safari/iOS, Chrome desatualizado).
    // O build padrão do pdfjs-dist 6 usa APIs de JavaScript muito novas e falha nesses navegadores.
    const [pdfjs, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]);
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs as unknown as PdfJsLike;
  })();
  return pdfjsPromise;
}

export async function extractPdfInBrowser(file: File, opts: { maxPages: number; onProgress?: (page: number, total: number) => void }): Promise<ExtractResult> {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    return await extractWith(pdfjs, bytes, { maxPages: opts.maxPages, maxCharsPerPage: 100_000, timeoutMs: 180_000, onProgress: opts.onProgress });
  } catch (err) {
    // Detalhe técnico só no console do navegador (ajuda no suporte); a interface mostra a mensagem amigável.
    console.warn("Falha na leitura do PDF:", (err as Error).cause ?? err);
    throw err;
  }
}

/**
 * Guarda os PDFs selecionados nesta aba, apenas em memória, para comparar com o texto extraído.
 * Nada é salvo nem enviado; ao recarregar a página, basta abrir o arquivo novamente.
 */
const localFiles = new Map<string, File>();
export const rememberLocalPdf = (materialId: string, file: File) => localFiles.set(materialId, file);
export const localPdfFor = (materialId: string) => localFiles.get(materialId) ?? null;
