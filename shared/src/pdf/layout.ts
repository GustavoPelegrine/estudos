/**
 * Reconstrução da ordem de leitura de uma página a partir dos fragmentos de texto do PDF.js.
 *
 * Funções puras (sem dependência do PDF.js) para que possam ser testadas com dados sintéticos.
 * Estratégia:
 *  1. Normaliza fragmentos (posição da linha de base, tamanho da fonte, largura).
 *  2. Detecta, de forma conservadora, um "corredor" vertical vazio que separe duas colunas.
 *  3. Lê a página em faixas: linhas de largura total quebram as faixas; dentro de cada faixa,
 *     a coluna esquerda é lida antes da direita.
 *  4. Agrupa fragmentos em linhas pela linha de base e insere espaços somente quando há
 *     separação visual proporcional ao tamanho da fonte.
 *  5. Reconstrói parágrafos (espaçamento vertical), títulos (fonte maior) e hifenização.
 */

export interface RawTextItem {
  str: string;
  /** Matriz de transformação [a, b, c, d, e, f] do PDF.js. */
  transform: number[];
  width: number;
  height?: number;
  hasEOL?: boolean;
}

export interface Frag {
  str: string;
  x: number;
  y: number;
  w: number;
  fs: number;
}

export interface Line {
  text: string;
  x: number;
  y: number;
  right: number;
  fs: number;
  /** Índice do grupo de leitura (mudança de coluna/faixa sempre inicia novo parágrafo). */
  group: number;
}

export interface PageLayout {
  lines: Line[];
  columns: boolean;
}

export interface Block {
  kind: "heading" | "paragraph";
  text: string;
}

const WHITESPACE_ONLY = /^\s+$/u;

/** "D E N T I N A" → "DENTINA" apenas quando o fragmento inteiro é composto por letras isoladas. */
export function collapseLetterSpaced(str: string): string {
  const trimmed = str.trim();
  if (trimmed.length < 5) return str;
  const segments = trimmed.split(/\s{2,}/u);
  const isSpacedWord = (seg: string) => /^\p{L}(?: \p{L})+$/u.test(seg) || /^\p{L}$/u.test(seg);
  if (!segments.every(isSpacedWord)) return str;
  const letters = segments.reduce((n, seg) => n + seg.replace(/ /g, "").length, 0);
  // Exige pelo menos uma sequência longa (≥ 4 letras) para não unir artigos como "a e o".
  if (letters < 4 || !segments.some((seg) => seg.replace(/ /g, "").length >= 4)) return str;
  return segments.map((seg) => seg.replace(/ /g, "")).join(" ");
}

export function toFrags(items: RawTextItem[]): Frag[] {
  const frags: Frag[] = [];
  for (const item of items) {
    if (typeof item.str !== "string" || item.str.length === 0) continue;
    const t = item.transform;
    if (!Array.isArray(t) || t.length < 6) continue;
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = t;
    const fs = Math.max(Math.hypot(c, d), Math.hypot(a, b), 1);
    const str = item.str.normalize("NFC");
    const w = item.width > 0 ? item.width : WHITESPACE_ONLY.test(str) ? fs * 0.25 * str.length : fs * 0.5 * str.length;
    frags.push({ str, x: e, y: f, w, fs });
  }
  return frags;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((p, q) => p - q);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Procura um corredor vertical que separe duas colunas. Retorna a coordenada x do corredor ou null. */
export function findColumnGutter(frags: Frag[]): number | null {
  const textFrags = frags.filter((f) => !WHITESPACE_ONLY.test(f.str));
  if (textFrags.length < 6) return null;
  const minX = Math.min(...textFrags.map((f) => f.x));
  const maxX = Math.max(...textFrags.map((f) => f.x + f.w));
  const span = maxX - minX;
  if (span < 200) return null;

  let best: { x: number; crossings: number; run: number } | null = null;
  let runStart: number | null = null;
  const candidates: { x: number; crossings: number }[] = [];
  for (let x = minX + span * 0.25; x <= minX + span * 0.75; x += 2) {
    const crossings = textFrags.filter((f) => f.x < x - 1 && f.x + f.w > x + 1).length;
    candidates.push({ x, crossings });
  }
  const minCrossings = Math.min(...candidates.map((c) => c.crossings));
  if (minCrossings > Math.max(2, textFrags.length * 0.15)) return null;
  // Centro da maior sequência contínua de candidatos com o mínimo de cruzamentos.
  for (let i = 0; i <= candidates.length; i++) {
    const c = candidates[i];
    if (c && c.crossings === minCrossings) {
      if (runStart === null) runStart = i;
      continue;
    }
    if (runStart !== null) {
      const run = i - runStart;
      const centre = candidates[runStart + Math.floor(run / 2)] as { x: number; crossings: number };
      if (!best || run > best.run) best = { x: centre.x, crossings: minCrossings, run };
      runStart = null;
    }
  }
  if (!best || best.run * 2 < 8) return null; // corredor de pelo menos ~8 pt

  const gutter = best.x;
  const left = textFrags.filter((f) => f.x + f.w <= gutter);
  const right = textFrags.filter((f) => f.x >= gutter);
  const distinctLines = (fs: Frag[]) => new Set(fs.map((f) => Math.round(f.y))).size;
  if (distinctLines(left) < 3 || distinctLines(right) < 3) return null;
  // As duas colunas precisam ocupar a mesma faixa vertical (senão é apenas texto deslocado).
  const range = (fs: Frag[]) => [Math.min(...fs.map((f) => f.y)), Math.max(...fs.map((f) => f.y))] as const;
  const [l0, l1] = range(left);
  const [r0, r1] = range(right);
  const overlap = Math.min(l1, r1) - Math.max(l0, r0);
  const smaller = Math.min(l1 - l0, r1 - r0);
  if (smaller <= 0 || overlap < smaller * 0.5) return null;
  return gutter;
}

function buildLines(frags: Frag[], group: number): Line[] {
  const sorted = [...frags].sort((p, q) => q.y - p.y || p.x - q.x);
  const rows: Frag[][] = [];
  for (const frag of sorted) {
    const row = rows[rows.length - 1];
    const ref = row?.[0];
    if (row && ref && Math.abs(ref.y - frag.y) <= Math.min(ref.fs, frag.fs) * 0.5) row.push(frag);
    else rows.push([frag]);
  }
  const lines: Line[] = [];
  for (const row of rows) {
    row.sort((p, q) => p.x - q.x);
    let text = "";
    let prevEnd: number | null = null;
    let fs = 0;
    for (const frag of row) {
      fs = Math.max(fs, WHITESPACE_ONLY.test(frag.str) ? 0 : frag.fs);
      if (WHITESPACE_ONLY.test(frag.str)) {
        if (text && !text.endsWith(" ")) text += " ";
        prevEnd = frag.x + frag.w;
        continue;
      }
      const piece = collapseLetterSpaced(frag.str);
      if (prevEnd !== null) {
        const gap = frag.x - prevEnd;
        // Espaço apenas quando há separação visual (~15% do corpo da fonte ≈ meio espaço típico).
        if (gap > frag.fs * 0.15 && !text.endsWith(" ") && !piece.startsWith(" ")) text += " ";
      }
      text += piece;
      prevEnd = frag.x + frag.w;
    }
    text = text.replace(/[ \t ]+/gu, " ").trim();
    if (!text) continue;
    const first = row.find((f) => !WHITESPACE_ONLY.test(f.str)) ?? row[0];
    const last = row[row.length - 1] as Frag;
    lines.push({ text, x: first?.x ?? 0, y: median(row.map((f) => f.y)), right: last.x + last.w, fs: fs || (first?.fs ?? 10), group });
  }
  return lines;
}

/** Ordena os fragmentos em linhas na ordem natural de leitura. */
export function layoutPage(items: RawTextItem[]): PageLayout {
  const frags = toFrags(items);
  if (!frags.length) return { lines: [], columns: false };
  const gutter = findColumnGutter(frags);
  if (gutter === null) return { lines: buildLines(frags, 0), columns: false };

  const full = frags.filter((f) => !WHITESPACE_ONLY.test(f.str) && f.x < gutter - 1 && f.x + f.w > gutter + 1);
  const fullYs = [...new Set(full.map((f) => f.y))].sort((p, q) => q - p);
  const fullSet = new Set(full);
  const columnFrags = frags.filter((f) => !fullSet.has(f));

  // Faixas delimitadas pelas linhas de largura total (de cima para baixo).
  const lines: Line[] = [];
  let group = 0;
  let upper = Infinity;
  const boundaries = [...fullYs, -Infinity];
  for (const boundary of boundaries) {
    const inBand = columnFrags.filter((f) => f.y < upper && f.y > boundary + 0.01);
    const left = inBand.filter((f) => f.x + f.w / 2 < gutter);
    const right = inBand.filter((f) => f.x + f.w / 2 >= gutter);
    if (left.length) lines.push(...buildLines(left, group++));
    if (right.length) lines.push(...buildLines(right, group++));
    if (boundary !== -Infinity) {
      const fullHere = full.filter((f) => Math.abs(f.y - boundary) < 0.01);
      lines.push(...buildLines(fullHere, group++));
    }
    upper = boundary;
  }
  return { lines, columns: true };
}

const KEEP_HYPHEN_PREFIXES = new Set(["anti", "micro", "macro", "super", "inter", "hiper", "sub", "semi", "auto", "contra", "extra", "infra", "intra", "ultra", "supra", "neo", "proto", "pseudo"]);

/** Une duas linhas consecutivas de um parágrafo, tratando hifenização de fim de linha. */
export function joinLines(prev: string, next: string): string {
  const m = /(\p{L}+)-$/u.exec(prev);
  if (m && /^\p{Ll}/u.test(next)) {
    const prefix = (m[1] as string).toLowerCase();
    const nextFirst = next[0]?.toLowerCase() ?? "";
    // Prefixos que exigem hífen em português (anti-inflamatório, micro-ondas, super-homem, sub-base…).
    const keep = KEEP_HYPHEN_PREFIXES.has(prefix) && (nextFirst === "h" || nextFirst === prefix.slice(-1) || (prefix === "sub" && /^[br]/u.test(next)));
    return keep ? prev + next : prev.slice(0, -1) + next;
  }
  return `${prev} ${next}`;
}

/** Agrupa linhas em títulos e parágrafos. bodyFontSize: tamanho de fonte predominante no documento. */
export function linesToBlocks(lines: Line[], bodyFontSize: number): Block[] {
  const blocks: Block[] = [];
  const leadings: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1] as Line;
    const b = lines[i] as Line;
    if (a.group === b.group) {
      const d = a.y - b.y;
      if (d > 0) leadings.push(d);
    }
  }
  const leading = median(leadings) || bodyFontSize * 1.3;
  const groupWidth = new Map<number, number>();
  for (const l of lines) groupWidth.set(l.group, Math.max(groupWidth.get(l.group) ?? 0, l.right - l.x));

  const isHeading = (l: Line) => {
    if (l.text.length > 160 || /[.;,]$/u.test(l.text)) return false;
    if (l.fs >= bodyFontSize * 1.2) return true;
    const letters = l.text.replace(/[^\p{L}]/gu, "");
    return letters.length >= 4 && letters.length <= 80 && letters === letters.toUpperCase() && l.fs >= bodyFontSize * 0.95 && l.text.split(" ").length <= 10;
  };

  let current: Block | null = null;
  let prev: Line | null = null;
  for (const line of lines) {
    const heading = isHeading(line);
    let newBlock = !current || !prev || current.kind !== (heading ? "heading" : "paragraph") || prev.group !== line.group;
    if (!newBlock && prev && current) {
      const gap = prev.y - line.y;
      if (gap > leading * 1.45 || gap < 0) newBlock = true;
      if (heading && Math.abs(prev.fs - line.fs) > 0.5) newBlock = true;
      if (!heading) {
        const width = groupWidth.get(line.group) ?? 0;
        const prevShort = width > 0 && prev.right - prev.x < width * 0.6;
        if (prevShort && /[.:!?]$/u.test(prev.text) && /^[\p{Lu}\d•\-–]/u.test(line.text)) newBlock = true;
        if (/^([•▪●◦\-–]|\d{1,2}[.)]\s|[a-z][)]\s)/u.test(line.text)) newBlock = true; // itens de lista
      }
    }
    if (newBlock || !current) {
      current = { kind: heading ? "heading" : "paragraph", text: line.text };
      blocks.push(current);
    } else {
      current.text = current.kind === "heading" ? `${current.text} ${line.text}` : joinLines(current.text, line.text);
    }
    prev = line;
  }
  return blocks;
}

export function blocksToText(blocks: Block[]): string {
  return blocks.map((b) => (b.kind === "heading" ? `# ${b.text}` : b.text)).join("\n\n");
}

/** Proporção de caracteres suspeitos (área de uso privado, U+FFFD, controles) — indica codificação de fonte quebrada. */
export function garbageRatio(text: string): number {
  const chars = [...text.replace(/\s/gu, "")];
  if (!chars.length) return 0;
  const bad = chars.filter((ch) => /[-�\u0000-\u0008\u000E-\u001F]/u.test(ch)).length;
  return bad / chars.length;
}

/**
 * Remove cabeçalhos/rodapés repetidos e números de página isolados.
 * Uma linha é considerada repetida quando, com dígitos normalizados, aparece como primeira
 * ou última linha em pelo menos 60% das páginas (mínimo de 3 páginas).
 */
export function stripRunningHeaders(pages: Line[][]): { pages: Line[][]; removed: number } {
  const norm = (s: string) => s.toLowerCase().replace(/\d+/gu, "#").replace(/\s+/gu, " ").trim();
  const isPageNumber = (s: string) => /^(p[áa]g(ina)?\.?\s*)?\d{1,4}(\s*(\/|de)\s*\d{1,4})?$/iu.test(s.trim());
  const edges = (lines: Line[]) => {
    if (!lines.length) return [] as Line[];
    const top = lines.reduce((m, l) => (l.y > m.y ? l : m));
    const bottom = lines.reduce((m, l) => (l.y < m.y ? l : m));
    return top === bottom ? [top] : [top, bottom];
  };
  const counts = new Map<string, number>();
  for (const lines of pages) for (const k of new Set(edges(lines).map((l) => norm(l.text)))) counts.set(k, (counts.get(k) ?? 0) + 1);
  const pagesWithText = pages.filter((p) => p.length > 0).length;
  const repeated = new Set([...counts].filter(([, n]) => pagesWithText >= 3 && n >= pagesWithText * 0.6).map(([k]) => k));
  let removed = 0;
  const out = pages.map((lines) => {
    const edge = new Set(edges(lines));
    return lines.filter((l) => {
      const drop = edge.has(l) && (repeated.has(norm(l.text)) || isPageNumber(l.text));
      if (drop) removed++;
      return !drop;
    });
  });
  return { pages: out, removed };
}
