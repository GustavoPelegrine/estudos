/**
 * Verifica, com a SUA chave, se o modelo configurado existe e responde em JSON.
 * Uso: npm run check:gemini -w server   (com GEMINI_API_KEY em server/.env ou no ambiente)
 * A chave nunca é impressa.
 */
const key = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
if (!key) {
  console.error("Defina GEMINI_API_KEY (em server/.env ou no ambiente).");
  process.exit(1);
}
const base = "https://generativelanguage.googleapis.com/v1beta";
const headers = { "x-goog-api-key": key, "content-type": "application/json" };

const info = await fetch(`${base}/models/${model}`, { headers });
if (!info.ok) {
  console.error(`Modelo "${model}" indisponível para esta chave (HTTP ${info.status}).`);
  const list = await fetch(`${base}/models?pageSize=200`, { headers });
  if (list.ok) {
    const body = (await list.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    const names = (body.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace("models/", ""));
    console.error("Modelos com generateContent disponíveis:\n  " + names.filter((n) => n.includes("flash") || n.includes("pro")).join("\n  "));
  }
  process.exit(1);
}
const meta = (await info.json()) as { displayName?: string; inputTokenLimit?: number; outputTokenLimit?: number };
console.log(`✓ Modelo encontrado: ${model} (${meta.displayName ?? ""}) · entrada ${meta.inputTokenLimit} · saída ${meta.outputTokenLimit} tokens`);

const started = Date.now();
const res = await fetch(`${base}/models/${model}:generateContent`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "Responda em JSON: qual tecido dentário é o mais mineralizado?" }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", properties: { resposta: { type: "STRING" } }, required: ["resposta"] },
      maxOutputTokens: 512,
    },
  }),
});
const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; usageMetadata?: unknown; error?: { message?: string } };
if (!res.ok) {
  console.error(`✗ generateContent falhou (HTTP ${res.status}): ${body.error?.message ?? ""}`);
  process.exit(1);
}
const text = body.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text).join("") ?? "";
JSON.parse(text);
console.log(`✓ Resposta JSON válida em ${Date.now() - started} ms: ${text}`);
console.log("  Uso de tokens:", JSON.stringify(body.usageMetadata));
export {};
