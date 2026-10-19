/**
 * Log estruturado (JSON, compatível com Cloud Logging).
 * Nunca registre: tokens, chaves de API, texto de materiais, perguntas ou respostas completas.
 * Os campos são filtrados por uma lista de bloqueio como proteção adicional.
 */
const BLOCKED = /key|token|secret|password|authorization|text|prompt|content/i;

type Fields = Record<string, unknown>;

function scrub(fields: Fields): Fields {
  const out: Fields = {};
  for (const [k, v] of Object.entries(fields)) out[k] = BLOCKED.test(k) ? "[omitido]" : v;
  return out;
}

function write(severity: string, message: string, fields: Fields = {}): void {
  if (process.env.NODE_ENV === "test" && severity !== "ERROR") return;
  const line = JSON.stringify({ severity, message, ...scrub(fields), time: new Date().toISOString() });
  (severity === "ERROR" || severity === "WARNING" ? console.error : console.log)(line);
}

export const log = {
  info: (m: string, f?: Fields) => write("INFO", m, f),
  warn: (m: string, f?: Fields) => write("WARNING", m, f),
  error: (m: string, f?: Fields) => write("ERROR", m, f),
};
