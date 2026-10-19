/** Erro de aplicação com status HTTP e mensagem segura para o usuário (português). */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "Registro") => new AppError(404, "not_found", `${what} não encontrado.`);
export const badRequest = (message: string, code = "bad_request") => new AppError(400, code, message);
export const conflict = (message: string, code = "conflict") => new AppError(409, code, message);
