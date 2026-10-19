import type { MaterialPage } from "@estudos/shared";

/**
 * Trecho recuperável de um material. Os trechos NÃO são armazenados no banco:
 * são derivados deterministicamente do texto das páginas (fonte única da verdade),
 * evitando duplicação de texto. O id é estável enquanto o texto da página não mudar.
 */
export interface Chunk {
  id: string;
  materialId: string;
  fileName: string;
  subjectName: string;
  topic: string;
  page: number;
  /** Título mais recente acima do trecho, se houver (ajuda o contexto). */
  heading: string | null;
  text: string;
}

export interface ChunkSource {
  materialId: string;
  fileName: string;
  subjectName: string;
  topic: string;
  pages: Pick<MaterialPage, "page" | "text" | "hasText">[];
}

const TARGET = 900;
const MAX = 1400;

function splitSentences(paragraph: string): string[] {
  return paragraph.split(/(?<=[.!?;])\s+(?=[\p{Lu}\d"“(])/u).filter(Boolean);
}

/** Divide cada página em trechos coerentes (~900 caracteres), sem atravessar páginas. */
export function chunkMaterial(source: ChunkSource): Chunk[] {
  const chunks: Chunk[] = [];
  let heading: string | null = null;
  for (const page of source.pages) {
    if (!page.hasText || !page.text.trim()) continue;
    const blocks = page.text.split(/\n{2,}/u).map((b) => b.trim()).filter(Boolean);
    let buffer = "";
    let bufferHeading = heading;
    let index = 0;
    const flush = () => {
      const text = buffer.trim();
      if (text.length >= 40 || (text.length > 0 && chunks.every((c) => c.page !== page.page))) {
        chunks.push({
          id: `${source.materialId}:${page.page}:${index++}`,
          materialId: source.materialId,
          fileName: source.fileName,
          subjectName: source.subjectName,
          topic: source.topic,
          page: page.page,
          heading: bufferHeading,
          text,
        });
      } else if (text && chunks.length && chunks[chunks.length - 1]?.page === page.page) {
        // Trecho muito curto: anexa ao anterior da mesma página.
        const last = chunks[chunks.length - 1] as Chunk;
        last.text = `${last.text}\n${text}`;
      }
      buffer = "";
      bufferHeading = heading;
    };
    for (const block of blocks) {
      if (block.startsWith("# ")) {
        if (buffer) flush();
        heading = block.slice(2).trim();
        bufferHeading = heading;
        buffer = `${heading}\n`;
        continue;
      }
      const pieces = block.length > MAX ? splitSentences(block) : [block];
      for (const piece of pieces) {
        if (buffer.length + piece.length > TARGET && buffer.replace(heading ?? "", "").trim().length > 0) flush();
        if (piece.length > MAX) {
          // Frase gigantesca (texto sem pontuação): corta em janelas.
          for (let i = 0; i < piece.length; i += TARGET) {
            buffer += piece.slice(i, i + TARGET);
            flush();
          }
          continue;
        }
        buffer += (buffer && !buffer.endsWith("\n") ? "\n" : "") + piece;
      }
    }
    if (buffer.trim()) flush();
  }
  return chunks;
}
