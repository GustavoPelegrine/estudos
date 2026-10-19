import type { z } from "zod";
import { AppError } from "./errors.js";

/** Valida dados de entrada; nunca devolve detalhes internos, apenas os campos inválidos. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join(".") || "corpo"))].join(", ");
    throw new AppError(400, "invalid_input", `Dados inválidos: ${fields}.`);
  }
  return result.data;
}
