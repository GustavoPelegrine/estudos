import type { NextFunction, Request, Response } from "express";
import type { Auth } from "firebase-admin/auth";
import type { Config } from "../config.js";
import { log } from "../lib/log.js";
import { AppError } from "./errors.js";

export interface AuthUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Exige um ID token válido do Firebase Authentication em "Authorization: Bearer <token>".
 * O uid usado em TODAS as operações vem exclusivamente deste token.
 */
export function requireAuth(auth: Auth, config: Config) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const match = /^Bearer\s+([A-Za-z0-9._-]+)$/u.exec(header);
    if (!match) return next(new AppError(401, "unauthenticated", "Faça login para continuar."));
    try {
      const decoded = await auth.verifyIdToken(match[1] as string, true);
      if (decoded.firebase?.sign_in_provider === "anonymous") throw new AppError(403, "anonymous_forbidden", "Contas anônimas não podem usar a plataforma.");
      const email = decoded.email?.toLowerCase() ?? null;
      if (config.ALLOWED_EMAILS.length && (!email || !config.ALLOWED_EMAILS.includes(email))) {
        throw new AppError(403, "not_allowed", "Esta conta ainda não tem acesso à plataforma. Fale com a administração.");
      }
      if (config.REQUIRE_EMAIL_VERIFIED && !decoded.email_verified) {
        throw new AppError(403, "email_not_verified", "Confirme seu e-mail pelo link enviado antes de continuar.");
      }
      req.user = { uid: decoded.uid, email, emailVerified: Boolean(decoded.email_verified), name: (decoded.name as string | undefined) ?? null };
      next();
    } catch (err) {
      if (err instanceof AppError) return next(err);
      const code = (err as { code?: string }).code ?? "unknown";
      log.warn("auth_rejected", { code });
      next(new AppError(401, "invalid_token", code === "auth/id-token-revoked" ? "Sua sessão foi encerrada. Entre novamente." : "Sessão inválida ou expirada. Entre novamente."));
    }
  };
}

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw new AppError(401, "unauthenticated", "Faça login para continuar.");
  return req.user;
}
