import { extractPdf as extractWith, looksLikePdf, PdfExtractionError, type ExtractResult, type PdfJsLike } from "@estudos/shared/pdf";
import { importFresh } from "./stale-build";

/**
 * Extração do texto do PDF NO NAVEGADOR (versão custo zero: o arquivo não é enviado para a nuvem).
 * Usa o mesmo algoritmo de layout testado no backend (@estudos/shared/pdf).
 * O PDF.js é carregado sob demanda para não pesar no carregamento inicial do app.
 */
let pdfjsPromise: Promise<{ pdfjs: PdfJsLike; workerUrl: string }> | null = null;

async function loadPdfJs() {
  pdfjsPromise ??= (async () => {
    // Build "legacy": inclui compatibilidade com navegadores menos recentes (Safari/iOS, Chrome desatualizado).
    // O build padrão do pdfjs-dist 6 usa APIs de JavaScript muito novas e falha nesses navegadores.
    const [pdfjs, worker] = await importFresh(() => Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]));
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return { pdfjs: pdfjs as unknown as PdfJsLike, workerUrl: worker.default };
  })().catch((err: unknown) => {
    pdfjsPromise = null; // permite tentar de novo
    throw err;
  });
  return pdfjsPromise;
}

/**
 * Plano B: carrega o leitor na própria página em vez de em segundo plano (Web Worker).
 * O PDF.js passa a usar este módulo automaticamente quando globalThis.pdfjsWorker existe.
 */
let mainThreadReader = false;
async function useMainThreadReader(workerUrl: string) {
  if (mainThreadReader) return false;
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import(/* @vite-ignore */ workerUrl);
  mainThreadReader = true;
  return true;
}

// Recursos copiados para /pdfjs/ no build (web/vite.config.ts): fontes CID, fontes padrão e imagens JPEG 2000/JBIG2.
const PDFJS_RESOURCES = { cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/", iccUrl: "/pdfjs/iccs/" };

export async function extractPdfInBrowser(file: File, opts: { maxPages: number; onProgress?: (page: number, total: number) => void }): Promise<ExtractResult> {
  const { pdfjs, workerUrl } = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const read = () => extractWith(pdfjs, bytes, { maxPages: opts.maxPages, maxCharsPerPage: 100_000, timeoutMs: 180_000, onProgress: opts.onProgress, docParams: PDFJS_RESOURCES });
  try {
    return await read();
  } catch (err) {
    if (err instanceof PdfExtractionError && err.code === "invalid_pdf" && looksLikePdf(bytes)) {
      console.warn("Falha na leitura do PDF em segundo plano; tentando na própria página:", err.cause ?? err);
      const retried = await useMainThreadReader(workerUrl).catch(() => false);
      if (retried) {
        try {
          return await read();
        } catch (again) {
          throw withDetail(again);
        }
      }
    }
    throw withDetail(err);
  }
}

/** No celular/tablet não há console: o detalhe técnico e o navegador vão junto da mensagem para facilitar o suporte. */
function withDetail(err: unknown): unknown {
  if (!(err instanceof PdfExtractionError) || err.code !== "invalid_pdf") return err;
  console.warn("Falha na leitura do PDF:", err.cause ?? err);
  const c = err.cause as { name?: string; message?: string } | undefined;
  const detail = c ? `${c.name ?? "Erro"}: ${String(c.message ?? c).slice(0, 160)}` : "sem detalhe";
  return new PdfExtractionError(`${err.message} Detalhe técnico: ${detail} · ${browserLabel()}`, err.code, { cause: err.cause });
}

function browserLabel(): string {
  const ua = navigator.userAgent;
  const pick = (re: RegExp, name: string) => {
    const m = re.exec(ua);
    return m ? `${name} ${m[1]}` : null;
  };
  const os = pick(/OS (\d+[_\d]*) like Mac/, "iOS")?.replace(/_/g, ".") ?? (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1 ? "iPadOS" : null);
  const browser = pick(/CriOS\/([\d.]+)/, "Chrome") ?? pick(/FxiOS\/([\d.]+)/, "Firefox") ?? pick(/Edg\/([\d.]+)/, "Edge") ?? pick(/Chrome\/([\d.]+)/, "Chrome") ?? pick(/Version\/([\d.]+).*Safari/, "Safari") ?? pick(/Firefox\/([\d.]+)/, "Firefox") ?? "navegador desconhecido";
  return os ? `${browser} (${os})` : browser;
}

/**
 * Guarda os PDFs selecionados nesta aba, apenas em memória, para comparar com o texto extraído.
 * Nada é salvo nem enviado; ao recarregar a página, basta abrir o arquivo novamente.
 */
const localFiles = new Map<string, File>();
export const rememberLocalPdf = (materialId: string, file: File) => localFiles.set(materialId, file);
export const localPdfFor = (materialId: string) => localFiles.get(materialId) ?? null;
