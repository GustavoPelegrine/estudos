import type { Request } from "express";
import rateLimit from "express-rate-limit";

/**
 * Limites por usuário autenticado (não por IP), aplicados após a autenticação.
 * Armazenamento em memória: suficiente para uma instância do Cloud Run (max-instances baixo).
 * Para várias instâncias, troque por um store compartilhado (ex.: Redis/Memorystore).
 */
export function userRateLimit(perMinute: number, message: string) {
  return rateLimit({
    windowMs: 60_000,
    limit: perMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.user?.uid ?? "anon",
    handler: (_req, res) => {
      res.status(429).json({ error: { code: "rate_limited", message } });
    },
  });
}
