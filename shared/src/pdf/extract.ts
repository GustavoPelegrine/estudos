/**
 * Extração de texto de PDF independente de plataforma: recebe o módulo do PDF.js já carregado
 * (build de navegador no app, build "legacy" em Node nos testes) e aplica o mesmo algoritmo de layout.
 */
import type { ExtractionReport, MaterialPage } from "../types.js";
import { blocksToText, garbageRatio, layoutPage, linesToBlocks, stripRunningHeaders, type Line, type RawTextItem } from "./layout.js";

export const EXTRACTOR_VERSION = "layout-v2";
const MIN_PAGE_CHARS = 15;

export interface ExtractOptions {
  maxPages: number;
  /** Limite de caracteres por página (documentos do Firestore têm 1 MiB). */
  maxCharsPerPage: number;
  timeoutMs: number;
  /** Parâmetros extras repassados a getDocument (fontes padrão, cMaps…). */
  docParams?: Record<string, unknown>;
  onProgress?: (page: number, total: number) => void;
}

export interface ExtractResult {
  pages: MaterialPage[];
  report: ExtractionReport;
}

export class PdfExtractionError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_pdf" | "encrypted" | "too_many_pages" | "timeout",
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Subconjunto da API do PDF.js usado aqui (compatível com as builds de navegador e Node). */
interface PdfPageLike {
  getTextContent(): Promise<{ items: unknown[] }>;
  getOperatorList(): Promise<{ fnArray: number[] }>;
  cleanup(): unknown;
}
interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}
export interface PdfJsLike {
  getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocLike>; destroy(): Promise<void> };
  OPS: { paintImageXObject: number; paintInlineImageXObject: number; paintImageMaskXObject: number };
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF-" pode aparecer após alguns bytes iniciais; a especificação tolera até 1024.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

export async function extractPdf(pdfjs: PdfJsLike, bytes: Uint8Array, options: ExtractOptions): Promise<ExtractResult> {
  if (!looksLikePdf(bytes)) throw new PdfExtractionError("O arquivo selecionado não é um PDF válido.", "invalid_pdf");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), // cópia: o PDF.js transfere o buffer
    // pdfjs-dist ≥ 4.2.67 não usa eval (correção do CVE-2024-4367); mantenha a dependência atualizada.
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
    ...options.docParams,
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void task.destroy();
      reject(new PdfExtractionError("A leitura do PDF excedeu o tempo limite.", "timeout"));
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([readDocument(pdfjs, task.promise, options), timeout]);
  } catch (err) {
    if (err instanceof PdfExtractionError) throw err;
    const name = (err as { name?: string }).name;
    if (name === "PasswordException") throw new PdfExtractionError("O PDF está protegido por senha. Remova a proteção e tente novamente.", "encrypted");
    throw new PdfExtractionError("Não foi possível abrir o PDF. O arquivo pode estar corrompido.", "invalid_pdf", { cause: err });
  } finally {
    clearTimeout(timer);
    void task.destroy();
  }
}

async function readDocument(pdfjs: PdfJsLike, docPromise: Promise<PdfDocLike>, options: ExtractOptions): Promise<ExtractResult> {
  const doc = await docPromise;
  if (doc.numPages > options.maxPages) {
    throw new PdfExtractionError(`O PDF tem ${doc.numPages} páginas; o limite é ${options.maxPages}.`, "too_many_pages");
  }
  const imageOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject]);

  const rawPages: { lines: Line[]; columns: boolean; hasImages: boolean }[] = [];
  const fontSizes: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    options.onProgress?.(p, doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter((it): it is RawTextItem => typeof it === "object" && it !== null && "str" in it);
    const layout = layoutPage(items);
    for (const line of layout.lines) for (let i = 0; i < Math.min(line.text.length, 200); i += 10) fontSizes.push(line.fs);
    let hasImages = false;
    if (layout.lines.reduce((n, l) => n + l.text.length, 0) < MIN_PAGE_CHARS) {
      const ops = await page.getOperatorList();
      hasImages = ops.fnArray.some((fn) => imageOps.has(fn));
    }
    rawPages.push({ lines: layout.lines, columns: layout.columns, hasImages });
    page.cleanup();
  }
  return buildResult(rawPages, mode(fontSizes) || 11, options.maxCharsPerPage);
}

function buildResult(rawPages: { lines: Line[]; columns: boolean; hasImages: boolean }[], bodyFontSize: number, maxCharsPerPage: number): ExtractResult {
  const stripped = stripRunningHeaders(rawPages.map((p) => p.lines));
  const pages: MaterialPage[] = [];
  const multiColumnPages: number[] = [];
  const garbledPages: number[] = [];
  const scannedPages: number[] = [];
  let truncated = false;

  stripped.pages.forEach((lines, i) => {
    const pageNumber = i + 1;
    const raw = rawPages[i] as (typeof rawPages)[number];
    let text = blocksToText(linesToBlocks(lines, bodyFontSize));
    if (text.length > maxCharsPerPage) {
      text = text.slice(0, maxCharsPerPage);
      truncated = true;
    }
    const hasText = text.replace(/\s/gu, "").length >= MIN_PAGE_CHARS || (text.trim().length > 0 && lines.length > 0 && !raw.hasImages);
    if (!hasText && raw.hasImages) scannedPages.push(pageNumber);
    if (raw.columns && hasText) multiColumnPages.push(pageNumber);
    if (hasText && garbageRatio(text) > 0.2) garbledPages.push(pageNumber);
    pages.push({
      page: pageNumber,
      text: hasText ? text : "",
      charCount: hasText ? text.length : 0,
      hasText,
      layout: !hasText ? "empty" : raw.columns ? "columns" : "single",
      editedByUser: false,
    });
  });

  const extraWarnings: string[] = [];
  if (garbledPages.length) extraWarnings.push(`Texto possivelmente corrompido (codificação de fonte) nas páginas ${formatPages(garbledPages)}. Confira antes de usar.`);
  if (truncated) extraWarnings.push(`Algumas páginas excederam ${maxCharsPerPage.toLocaleString("pt-BR")} caracteres e foram truncadas.`);
  if (stripped.removed > 0) extraWarnings.push(`${stripped.removed} linha(s) de cabeçalho/rodapé ou numeração de página foram removidas.`);
  return { pages, report: summarizePages(pages, { scannedPages, extraWarnings }) };
}

/**
 * Calcula o relatório de extração a partir das páginas. Usado também pelo servidor para
 * recalcular os números com base no que foi realmente recebido (sem confiar no cliente).
 */
export function summarizePages(
  pages: Pick<MaterialPage, "page" | "hasText" | "charCount" | "layout">[],
  extra: { scannedPages?: number[]; extraWarnings?: string[] } = {},
): ExtractionReport {
  const pagesWithText = pages.filter((p) => p.hasText).length;
  const pagesWithoutText = pages.filter((p) => !p.hasText).map((p) => p.page);
  const multiColumnPages = pages.filter((p) => p.layout === "columns").map((p) => p.page);
  const charCount = pages.reduce((n, p) => n + p.charCount, 0);
  const scanned = extra.scannedPages ?? [];
  const ocrRequired = pages.length > 0 && (pagesWithText === 0 || pagesWithText / pages.length < 0.5 || (charCount < 200 && pagesWithoutText.length > 0));
  const warnings: string[] = [];
  if (ocrRequired) {
    warnings.push(
      pagesWithText === 0
        ? "Nenhum texto extraível foi encontrado. O PDF parece ser digitalizado (imagem) e exige OCR."
        : "Grande parte do documento não possui texto extraível. Ele provavelmente exige OCR.",
    );
  } else if (pagesWithoutText.length) {
    warnings.push(`Páginas sem texto extraível: ${formatPages(pagesWithoutText)}${scanned.length ? " (parecem conter apenas imagens; exigem OCR)" : ""}.`);
  }
  if (multiColumnPages.length) warnings.push(`Layout em colunas detectado nas páginas ${formatPages(multiColumnPages)}. Confira a ordem de leitura.`);
  warnings.push(...(extra.extraWarnings ?? []));
  return { pageCount: pages.length, pagesWithText, pagesWithoutText, multiColumnPages, charCount, warnings, ocrRequired, extractorVersion: EXTRACTOR_VERSION };
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const v of values) {
    const k = Math.round(v * 2) / 2;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [k, n] of counts) if (n > bestCount) [best, bestCount] = [k, n];
  return best;
}

export function formatPages(pages: number[]): string {
  if (pages.length > 12) return `${pages.slice(0, 12).join(", ")} e mais ${pages.length - 12}`;
  return pages.join(", ");
}
