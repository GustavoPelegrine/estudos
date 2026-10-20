import { describe, expect, it } from "vitest";
import { splitBatches } from "../../src/ai/service.js";

describe("divisão da geração em lotes paralelos", () => {
  const chunks = Array.from({ length: 10 }, (_, i) => `T${i + 1}`);

  it("divide 10 questões em 3 lotes que somam 10 e cobrem o material inteiro", () => {
    const b = splitBatches(chunks, 10, 4);
    expect(b).toHaveLength(3);
    expect(b.map((x) => x.count)).toEqual([4, 3, 3]);
    expect(b.flatMap((x) => x.part).sort()).toEqual([...chunks].sort());
    expect(b[0]!.part).toEqual(["T1", "T4", "T7", "T10"]); // intercalado: começo, meio e fim
  });

  it("pedidos pequenos usam um único lote", () => {
    expect(splitBatches(chunks, 3, 4)).toEqual([{ part: chunks, count: 3 }]);
  });

  it("nunca cria mais lotes que trechos nem passa do máximo", () => {
    expect(splitBatches(["T1", "T2"], 20, 4)).toHaveLength(2);
    expect(splitBatches(chunks, 30, 4)).toHaveLength(3);
  });
});
