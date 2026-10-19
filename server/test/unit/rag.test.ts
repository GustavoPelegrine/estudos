import { describe, expect, it } from "vitest";
import { chunkMaterial } from "../../src/rag/chunker.js";
import { Bm25Index, queryCoverage, selectForGeneration } from "../../src/rag/retriever.js";
import { normalize, stem, tokenize } from "../../src/rag/text.js";

const source = {
  materialId: "m1",
  fileName: "perio.pdf",
  subjectName: "Periodontia",
  topic: "Periodonto",
  pages: [
    { page: 1, hasText: true, text: "# Gengiva\n\nA gengiva recobre o processo alveolar e circunda o colo dos dentes.\n\nA gengiva inserida é firme e resiliente." },
    { page: 2, hasText: false, text: "" },
    { page: 3, hasText: true, text: "# Ligamento periodontal\n\nO ligamento periodontal é um tecido conjuntivo que une o cemento ao osso alveolar e absorve forças mastigatórias." },
    { page: 4, hasText: true, text: "# Cemento\n\n" + "O cemento recobre a raiz. ".repeat(80) },
  ],
};

describe("normalização e tokenização", () => {
  it("remove acentos e aproxima plurais/gêneros", () => {
    expect(normalize("Inflamação GENGIVAL!")).toBe("inflamacao gengival");
    expect(stem("dentárias")).toBe(stem("dentário"));
    expect(stem("inflamações")).toBe(stem("inflamação"));
    expect(tokenize("O que é o ligamento periodontal?")).toEqual(["ligament", "periodontal"]);
  });
});

describe("divisão em trechos", () => {
  it("preserva página e título de origem e não atravessa páginas", () => {
    const chunks = chunkMaterial(source);
    expect(chunks.every((c) => [1, 3, 4].includes(c.page))).toBe(true);
    const lig = chunks.find((c) => c.text.includes("ligamento periodontal é"))!;
    expect(lig.page).toBe(3);
    expect(lig.heading).toBe("Ligamento periodontal");
    expect(chunks.filter((c) => c.page === 4).length).toBeGreaterThan(1); // página longa dividida
    expect(chunks.every((c) => c.text.length <= 1500)).toBe(true);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });
});

describe("recuperação BM25", () => {
  const chunks = chunkMaterial(source);
  const index = new Bm25Index(chunks);

  it("recupera o trecho mais relevante com variações de acento e plural", () => {
    const hits = index.search("qual a função dos ligamentos periodontais?", 3);
    expect(hits[0]!.chunk.page).toBe(3);
  });

  it("não retorna nada para perguntas sem relação", () => {
    expect(index.search("receita de bolo de chocolate", 3)).toEqual([]);
    expect(queryCoverage("receita de bolo", chunks)).toBe(0);
  });

  it("seleção para geração respeita o orçamento de caracteres e cobre o documento", () => {
    const sel = selectForGeneration(chunks, undefined, 1200);
    expect(sel.reduce((n, c) => n + c.text.length, 0)).toBeLessThanOrEqual(1200);
    const focused = selectForGeneration(chunks, "gengiva inserida", 5000);
    expect(focused.some((c) => c.page === 1)).toBe(true);
  });
});
