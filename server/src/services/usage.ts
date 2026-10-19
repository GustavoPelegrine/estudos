import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Config } from "../config.js";
import { AppError } from "../http/errors.js";
import { globalUsage, today, userPaths } from "../lib/paths.js";

/**
 * Reserva uma chamada de IA na cota diária (por usuário e global) dentro de uma transação.
 * Retorna uma função para devolver a reserva caso a chamada falhe por erro do provedor.
 */
export async function reserveAiCall(db: Firestore, config: Config, uid: string): Promise<{ refund: () => Promise<void> }> {
  const day = today();
  const userRef = userPaths(db, uid).usage(day);
  const globalRef = globalUsage(db, day);
  await db.runTransaction(async (tx) => {
    const [u, g] = await Promise.all([tx.get(userRef), tx.get(globalRef)]);
    const userCalls = (u.get("aiCalls") as number | undefined) ?? 0;
    const globalCalls = (g.get("aiCalls") as number | undefined) ?? 0;
    if (userCalls >= config.AI_DAILY_LIMIT_PER_USER) {
      throw new AppError(429, "ai_quota_user", `Você atingiu o limite diário de ${config.AI_DAILY_LIMIT_PER_USER} gerações com IA. O limite é renovado à meia-noite.`);
    }
    if (globalCalls >= config.AI_DAILY_LIMIT_GLOBAL) {
      throw new AppError(429, "ai_quota_global", "O limite diário de uso de IA da plataforma foi atingido. Tente novamente amanhã.");
    }
    tx.set(userRef, { day, aiCalls: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(globalRef, { day, aiCalls: FieldValue.increment(1) }, { merge: true });
  });
  let refunded = false;
  return {
    refund: async () => {
      if (refunded) return;
      refunded = true;
      await Promise.all([
        userRef.set({ aiCalls: FieldValue.increment(-1) }, { merge: true }),
        globalRef.set({ aiCalls: FieldValue.increment(-1) }, { merge: true }),
      ]);
    },
  };
}

export async function recordTokens(db: Firestore, uid: string, promptTokens: number, outputTokens: number): Promise<void> {
  if (!promptTokens && !outputTokens) return;
  await userPaths(db, uid)
    .usage(today())
    .set({ promptTokens: FieldValue.increment(promptTokens), outputTokens: FieldValue.increment(outputTokens) }, { merge: true });
}

export async function getUsage(db: Firestore, uid: string): Promise<{ day: string; aiCalls: number }> {
  const day = today();
  const snap = await userPaths(db, uid).usage(day).get();
  return { day, aiCalls: (snap.get("aiCalls") as number | undefined) ?? 0 };
}
