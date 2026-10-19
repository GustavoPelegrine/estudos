import type { Chunk } from "./chunker.js";
import { tokenize } from "./text.js";

export interface ScoredChunk {
  chunk: Chunk;
  score: number;
}

/**
 * Índice BM25 em memória. Para o volume de material de um estudante (dezenas de PDFs),
 * a busca lexical é rápida, barata e transparente; embeddings podem ser adicionados depois
 * se a avaliação mostrar ganho real (ver docs/ARQUITETURA.md).
 */
export class Bm25Index {
  private readonly docs: { chunk: Chunk; tf: Map<string, number>; len: number }[] = [];
  private readonly df = new Map<string, number>();
  private avgLen = 0;

  constructor(
    chunks: Chunk[],
    private readonly k1 = 1.4,
    private readonly b = 0.7,
  ) {
    let total = 0;
    for (const chunk of chunks) {
      const tokens = tokenize(`${chunk.heading ?? ""} ${chunk.text}`);
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      this.docs.push({ chunk, tf, len: tokens.length });
      total += tokens.length;
    }
    this.avgLen = this.docs.length ? total / this.docs.length : 0;
  }

  get size(): number {
    return this.docs.length;
  }

  search(query: string, limit: number): ScoredChunk[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length || !this.docs.length) return [];
    const n = this.docs.length;
    const results: ScoredChunk[] = [];
    for (const doc of this.docs) {
      let score = 0;
      let matched = 0;
      for (const term of terms) {
        const f = doc.tf.get(term);
        if (!f) continue;
        matched++;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * doc.len) / (this.avgLen || 1)));
      }
      // Favorece trechos que cobrem mais termos distintos da pergunta.
      if (score > 0) results.push({ chunk: doc.chunk, score: score * (1 + matched / terms.length) });
    }
    return results.sort((p, q) => q.score - p.score).slice(0, limit);
  }
}

/** Fração dos termos da pergunta presentes nos trechos recuperados (evidência mínima). */
export function queryCoverage(query: string, chunks: Chunk[]): number {
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return 0;
  const present = new Set(chunks.flatMap((c) => tokenize(`${c.heading ?? ""} ${c.text}`)));
  return terms.filter((t) => present.has(t)).length / terms.length;
}

/**
 * Seleciona trechos representativos para gerar questões/flashcards quando não há pergunta:
 * se houver foco, usa a busca; caso contrário distribui a amostra ao longo do material
 * para não concentrar tudo nas primeiras páginas.
 */
export function selectForGeneration(chunks: Chunk[], focus: string | undefined, maxChars: number): Chunk[] {
  let ordered: Chunk[];
  if (focus && focus.trim()) {
    const hits = new Bm25Index(chunks).search(focus, 40).map((s) => s.chunk);
    ordered = hits.length ? hits : spread(chunks);
  } else {
    ordered = spread(chunks);
  }
  const out: Chunk[] = [];
  let used = 0;
  for (const c of ordered) {
    if (used + c.text.length > maxChars) continue;
    out.push(c);
    used += c.text.length;
  }
  // Mantém a ordem original do material para que o modelo veja o conteúdo encadeado.
  const pos = new Map(chunks.map((c, i) => [c.id, i]));
  return out.sort((p, q) => (pos.get(p.id) ?? 0) - (pos.get(q.id) ?? 0));
}

function spread(chunks: Chunk[]): Chunk[] {
  // Intercala posições (0, n/2, n/4, 3n/4, …) para cobrir o documento inteiro.
  const n = chunks.length;
  const order: number[] = [];
  const seen = new Set<number>();
  for (let step = n; step >= 1; step = Math.floor(step / 2)) {
    for (let i = 0; i < n; i += step) {
      if (!seen.has(i)) {
        seen.add(i);
        order.push(i);
      }
    }
    if (step === 1) break;
  }
  return order.map((i) => chunks[i] as Chunk);
}
