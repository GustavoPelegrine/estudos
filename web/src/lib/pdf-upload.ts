import { PAGES_BATCH_MAX_CHARS, PAGES_BATCH_SIZE, type MaterialPage } from "@estudos/shared";
import { api } from "./api";

/** Divide as páginas em lotes pequenos (limite de corpo das funções serverless). */
export function batches(pages: MaterialPage[]): MaterialPage[][] {
  const out: MaterialPage[][] = [];
  let cur: MaterialPage[] = [];
  let chars = 0;
  for (const p of pages) {
    if (cur.length && (cur.length >= PAGES_BATCH_SIZE || chars + p.text.length > PAGES_BATCH_MAX_CHARS)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(p);
    chars += p.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Envia o texto extraído em lotes e finaliza (serve para material novo e para nova versão). */
export async function uploadExtractedPages(materialId: string, pages: MaterialPage[], onProgress: (fraction: number) => void) {
  const parts = batches(pages);
  for (const [i, part] of parts.entries()) {
    await api.uploadPages(materialId, part.map(({ page, text, hasText, layout }) => ({ page, text, hasText, layout })));
    onProgress((i + 1) / parts.length);
  }
  return (await api.finalizeMaterial(materialId)).material;
}
