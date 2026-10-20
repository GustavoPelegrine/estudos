import { describe, expect, it } from "vitest";
import { extractPdf, looksLikePdf, PdfExtractionError } from "../../src/pdf/extract.js";
import { collapseLetterSpaced, extractPdf as sharedExtract, joinLines, layoutPage, type RawTextItem } from "@estudos/shared/pdf";
import { makeMixedPdf, makeScannedPdf, makeTextPdf, makeTwoColumnPdf } from "../fixtures/pdfs.js";

const opts = { maxPages: 50, maxCharsPerPage: 100_000, timeoutMs: 20_000 };

describe("extração de PDF com texto", () => {
  it("preserva páginas, títulos, parágrafos e reconstrói palavras", async () => {
    const { pages, report } = await extractPdf(await makeTextPdf(), opts);
    expect(report.pageCount).toBe(3);
    expect(report.ocrRequired).toBe(false);
    const p1 = pages[0]!.text;
    expect(p1.startsWith("# ESMALTE DENTÁRIO\n\n")).toBe(true);
    // hifenização de fim de linha
    expect(p1).toContain("a mineralização continua");
    // fragmentos encostados viram uma palavra; fragmentos separados continuam separados
    expect(p1).toContain("Palavras fragmentadas devem ser reconstruídas corretamente.");
    // letras isoladas legítimas não são unidas
    expect(p1).toContain("a e o são artigos");
    // título com letras espaçadas
    expect(p1).toContain("# DENTINA E POLPA");
    expect(p1).toContain("A dentina é produzida pelos odontoblastos e forma a maior parte do dente.");
    // ordem de leitura: esmalte antes de dentina
    expect(p1.indexOf("ESMALTE")).toBeLessThan(p1.indexOf("DENTINA"));
    expect(pages[1]!.text).toBe("# Cemento\n\nO cemento recobre a raiz e ancora as fibras do ligamento periodontal. Diferentemente do esmalte, o cemento é capaz de se remodelar.");
  });

  it("remove cabeçalhos repetidos e números de página", async () => {
    const { pages, report } = await extractPdf(await makeTextPdf(), opts);
    for (const p of pages) {
      expect(p.text).not.toContain("Apostila de Histologia Bucal");
      expect(p.text).not.toMatch(/\n\d+$/);
    }
    expect(report.warnings.join(" ")).toMatch(/cabeçalho\/rodapé/);
  });
});

describe("extração de PDF com duas colunas", () => {
  for (const interleaved of [false, true]) {
    it(`lê a coluna esquerda antes da direita (fluxo ${interleaved ? "intercalado" : "sequencial"})`, async () => {
      const { pages, report } = await extractPdf(await makeTwoColumnPdf(interleaved), opts);
      const text = pages[0]!.text;
      expect(report.multiColumnPages).toEqual([1]);
      expect(pages[0]!.layout).toBe("columns");
      const order = [
        "# Periodontia: estrutura do periodonto",
        "A gengiva é a parte da mucosa mastigatória que recobre o processo alveolar.",
        "O sulco gengival é o espaço raso ao redor do dente, delimitado pelo epitélio do sulco.",
        "O ligamento periodontal é um tecido conjuntivo denso que circunda a raiz e a liga ao osso alveolar.",
        "O osso alveolar forma e sustenta os alvéolos dentários, sendo remodelado continuamente.",
        "Texto final em largura total",
      ].map((s) => text.indexOf(s));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });
  }
});

describe("PDFs digitalizados", () => {
  it("identifica documento sem texto e exige OCR", async () => {
    const { pages, report } = await extractPdf(await makeScannedPdf(2), opts);
    expect(report.ocrRequired).toBe(true);
    expect(report.pagesWithText).toBe(0);
    expect(report.pagesWithoutText).toEqual([1, 2]);
    expect(pages.every((p) => p.layout === "empty" && p.text === "")).toBe(true);
    expect(report.warnings[0]).toMatch(/OCR/);
  });

  it("informa as páginas sem texto em documentos mistos", async () => {
    const { report } = await extractPdf(await makeMixedPdf(), opts);
    expect(report.pagesWithoutText).toEqual([2]);
    expect(report.warnings.join(" ")).toMatch(/OCR/);
  });
});

describe("validação de entrada", () => {
  it("rejeita arquivos que não são PDF", async () => {
    const bytes = new TextEncoder().encode("<html>não é pdf</html>");
    expect(looksLikePdf(bytes)).toBe(false);
    await expect(extractPdf(bytes, opts)).rejects.toBeInstanceOf(PdfExtractionError);
  });

  it("rejeita PDF corrompido com erro amigável", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n lixo lixo lixo");
    await expect(extractPdf(bytes, opts)).rejects.toMatchObject({ code: "invalid_pdf" });
  });

  it("respeita o limite de páginas", async () => {
    await expect(extractPdf(await makeTextPdf(), { ...opts, maxPages: 2 })).rejects.toMatchObject({ code: "too_many_pages" });
  });
});

describe("heurísticas de layout", () => {
  it("collapseLetterSpaced só une sequências longas de letras isoladas", () => {
    expect(collapseLetterSpaced("D E N T I N A")).toBe("DENTINA");
    expect(collapseLetterSpaced("a e o")).toBe("a e o");
    expect(collapseLetterSpaced("P O L P A  E  D E N T E")).toBe("POLPA E DENTE");
    expect(collapseLetterSpaced("o dente e a polpa")).toBe("o dente e a polpa");
  });

  it("joinLines trata hifenização e preserva prefixos hifenizados", () => {
    expect(joinLines("minerali-", "zação")).toBe("mineralização");
    expect(joinLines("uso de anti-", "inflamatório")).toBe("uso de anti-inflamatório");
    expect(joinLines("forno de micro-", "ondas")).toBe("forno de micro-ondas");
    expect(joinLines("Classe II-", "B")).toBe("Classe II- B");
    expect(joinLines("dente", "molar")).toBe("dente molar");
  });

  it("insere espaço apenas quando há separação visual entre fragmentos", () => {
    const item = (str: string, x: number, width: number, y = 700): RawTextItem => ({ str, transform: [10, 0, 0, 10, x, y], width });
    const { lines } = layoutPage([item("hidroxi", 50, 35), item("apatita", 85, 35), item("cristal", 123, 30)]);
    expect(lines.map((l) => l.text)).toEqual(["hidroxiapatita cristal"]);
  });

  it("ordena linhas pela posição, mesmo com fluxo fora de ordem", () => {
    const item = (str: string, y: number): RawTextItem => ({ str, transform: [10, 0, 0, 10, 50, y], width: 60 });
    const { lines } = layoutPage([item("terceira", 600), item("primeira", 700), item("segunda", 650)]);
    expect(lines.map((l) => l.text)).toEqual(["primeira", "segunda", "terceira"]);
  });
});

describe("páginas que o leitor não consegue processar", () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.7 teste");
  const fakePdfJs = (failing: Set<number>, total: number) => ({
    OPS: { paintImageXObject: 1, paintInlineImageXObject: 2, paintImageMaskXObject: 3 },
    getDocument: () => ({
      destroy: async () => undefined,
      promise: Promise.resolve({
        numPages: total,
        getPage: async (n: number) => ({
          getTextContent: async () => {
            if (failing.has(n)) throw new Error("falha simulada na fonte");
            return { items: [{ str: `Texto suficiente da página ${n} sobre o esmalte dentário.`, transform: [10, 0, 0, 10, 50, 700], width: 300 }] };
          },
          getOperatorList: async () => ({ fnArray: [] }),
          cleanup: () => undefined,
        }),
      }),
    }),
  });

  it("mantém as demais páginas e aponta a página com falha", async () => {
    const { pages, report } = await sharedExtract(fakePdfJs(new Set([2]), 3), pdfBytes, opts);
    expect(pages.map((p) => p.hasText)).toEqual([true, false, true]);
    expect(report.warnings.join(" ")).toMatch(/Não foi possível ler as páginas 2/);
  });

  it("falha com mensagem clara quando nenhuma página pode ser lida", async () => {
    await expect(sharedExtract(fakePdfJs(new Set([1, 2]), 2), pdfBytes, opts)).rejects.toMatchObject({ code: "invalid_pdf", cause: expect.objectContaining({ message: "falha simulada na fonte" }) });
  });
});
