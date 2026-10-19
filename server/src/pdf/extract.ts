import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtractionReport, MaterialPage } from "@estudos/shared";
import { blocksToText, garbageRatio, layoutPage, linesToBlocks, stripRunningHeaders, type Line, type RawTextItem } from "./layout.js";

export const EXTRACTOR_VERSION = "layout-v1";

export interface ExtractOptions {
  maxPages: number;
  /** Limite de caracteres armazenados por página (documentos do Firestore têm 1 MiB). */
  maxCharsPerPage: number;
  timeoutMs: number;
}

export interface ExtractResult {
  pages: MaterialPage[];
  report: ExtractionReport;
}

export class PdfExtractionError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_pdf" | "encrypted" | "too_many_pages" | "timeout",
  ) {
    super(message);
  }
}

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
// O PDF.js em Node aceita caminhos de arquivo terminados em "/".
const standardFontDataUrl = join(pdfjsRoot, "standard_fonts") + "/";
const cMapUrl = join(pdfjsRoot, "cmaps") + "/";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import(pathToFileURL(join(pdfjsRoot, "legacy/build/pdf.mjs")).href) as Promise<PdfJs>;
  return pdfjsPromise;
}

export function looksLikePdf(bytes: Uint8Array): boolean {
  // "%PDF-" pode aparecer após alguns bytes de lixo; a especificação tolera até 1024.
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  return head.includes("%PDF-");
}

const MIN_PAGE_CHARS = 15;

export async function extractPdf(bytes: Uint8Array, options: ExtractOptions): Promise<ExtractResult> {
  if (!looksLikePdf(bytes)) throw new PdfExtractionError("O arquivo enviado não é um PDF válido.", "invalid_pdf");
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), // cópia: o PDF.js transfere o buffer
    // pdfjs-dist ≥ 4.2.67 não usa eval (correção do CVE-2024-4367); mantenha a dependência atualizada.
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl,
    cMapUrl,
    cMapPacked: true,
    verbosity: 0,
  });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void task.destroy();
      reject(new PdfExtractionError("A leitura do PDF excedeu o tempo limite.", "timeout"));
    }, options.timeoutMs);
  });

  try {
    return await Promise.race([readDocument(pdfjs, task, options), timeout]);
  } catch (err) {
    if (err instanceof PdfExtractionError) throw err;
    const name = (err as { name?: string }).name;
    if (name === "PasswordException") throw new PdfExtractionError("O PDF está protegido por senha. Remova a proteção e envie novamente.", "encrypted");
    throw new PdfExtractionError("Não foi possível abrir o PDF. O arquivo pode estar corrompido.", "invalid_pdf");
  } finally {
    clearTimeout(timer);
    void task.destroy();
  }
}

async function readDocument(pdfjs: PdfJs, task: ReturnType<PdfJs["getDocument"]>, options: ExtractOptions): Promise<ExtractResult> {
  const doc = await task.promise;
  if (doc.numPages > options.maxPages) {
    throw new PdfExtractionError(`O PDF tem ${doc.numPages} páginas; o limite é ${options.maxPages}.`, "too_many_pages");
  }
  const imageOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintImageMaskXObject]);

  const rawPages: { lines: Line[]; columns: boolean; hasImages: boolean }[] = [];
  const fontSizes: number[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter((it): it is RawTextItem & typeof it => "str" in it) as RawTextItem[];
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

  const body = mode(fontSizes) || 11;
  const stripped = stripRunningHeaders(rawPages.map((p) => p.lines));
  const warnings: string[] = [];
  const pages: MaterialPage[] = [];
  const pagesWithoutText: number[] = [];
  const multiColumnPages: number[] = [];
  const garbledPages: number[] = [];
  const scannedPages: number[] = [];
  let truncated = false;

  stripped.pages.forEach((lines, i) => {
    const pageNumber = i + 1;
    const raw = rawPages[i] as (typeof rawPages)[number];
    let text = blocksToText(linesToBlocks(lines, body));
    if (text.length > options.maxCharsPerPage) {
      text = text.slice(0, options.maxCharsPerPage);
      truncated = true;
    }
    const hasText = text.replace(/\s/gu, "").length >= MIN_PAGE_CHARS || (text.trim().length > 0 && lines.length > 0 && !raw.hasImages);
    if (!hasText) {
      pagesWithoutText.push(pageNumber);
      if (raw.hasImages) scannedPages.push(pageNumber);
    }
    if (raw.columns) multiColumnPages.push(pageNumber);
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

  const pagesWithText = pages.filter((p) => p.hasText).length;
  const charCount = pages.reduce((n, p) => n + p.charCount, 0);
  const ocrRequired = pagesWithText === 0 || pagesWithText / pages.length < 0.5 || (charCount < 200 && scannedPages.length > 0);

  if (ocrRequired) {
    warnings.push(
      pagesWithText === 0
        ? "Nenhum texto extraível foi encontrado. O PDF parece ser digitalizado (imagem) e exige OCR."
        : "Grande parte do documento não possui texto extraível. Ele provavelmente exige OCR.",
    );
  } else if (pagesWithoutText.length) {
    warnings.push(`Páginas sem texto extraível: ${formatPages(pagesWithoutText)}${scannedPages.length ? " (parecem conter apenas imagens; exigem OCR)" : ""}.`);
  }
  if (multiColumnPages.length) warnings.push(`Layout em colunas detectado nas páginas ${formatPages(multiColumnPages)}. Confira a ordem de leitura.`);
  if (garbledPages.length) warnings.push(`Texto possivelmente corrompido (codificação de fonte) nas páginas ${formatPages(garbledPages)}. Confira antes de usar.`);
  if (truncated) warnings.push(`Algumas páginas excederam ${options.maxCharsPerPage.toLocaleString("pt-BR")} caracteres e foram truncadas.`);
  if (stripped.removed > 0) warnings.push(`${stripped.removed} linha(s) de cabeçalho/rodapé ou numeração de página foram removidas.`);

  return {
    pages,
    report: {
      pageCount: pages.length,
      pagesWithText,
      pagesWithoutText,
      multiColumnPages,
      charCount,
      warnings,
      ocrRequired,
      extractorVersion: EXTRACTOR_VERSION,
    },
  };
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
