/** Normalização e tokenização de texto em português para busca lexical. */

const STOPWORDS = new Set(
  (
    "a ao aos aquela aquelas aquele aqueles aquilo as ate com como da das de dela delas dele deles depois do dos e ela elas ele eles em entre era eram essa essas esse esses esta estas este estes eu foi foram ha isso isto ja la lhe lhes mais mas me mesmo meu minha muito na nas nao nem no nos nossa nosso num numa o os ou para pela pelas pelo pelos por qual quais quando que quem se sem ser seu seus sua suas so tambem te tem ter um uma umas uns voce vos sao pode podem deve devem sobre ainda apos cada outro outra outros outras todo toda todos todas onde porque entao tipo tipos forma parte partes " +
    "explique explica explicar fale diga resuma resumo material apostila conforme segundo exemplo exemplos"
  ).split(/\s+/u),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Radicalização leve (sufixos frequentes do português); suficiente para aproximar plural/derivações. */
export function stem(word: string): string {
  let w = word.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "");
  if (w.length <= 3) return w;
  const rules: [RegExp, string][] = [
    [/(coes|cao)$/u, "c"],
    [/(mente)$/u, ""],
    [/(idades|idade)$/u, ""],
    [/(ais)$/u, "al"],
    [/(eis)$/u, "el"],
    [/(oes|aes)$/u, "ao"],
    [/(ns)$/u, "m"],
    [/(res|zes)$/u, "r"],
    [/(s)$/u, ""],
  ];
  for (const [re, rep] of rules) {
    if (re.test(w) && w.replace(re, rep).length >= 3) {
      w = w.replace(re, rep);
      break;
    }
  }
  // Remove vogal temática final para aproximar masculino/feminino (dentario/dentaria).
  if (w.length > 4) w = w.replace(/[aeo]$/u, "");
  return w;
}

export function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t))
    .map(stem);
}
