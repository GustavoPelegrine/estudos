import type { Query } from "firebase-admin/firestore";
import type { Flashcard } from "@estudos/shared";
import type { AiService } from "../ai/service.js";
import { badRequest, notFound } from "../http/errors.js";
import { nowIso, userPaths } from "../lib/paths.js";
import { selectForGeneration } from "../rag/retriever.js";
import { loadChunks, type MaterialDeps } from "./materials.js";

/** Intervalos (dias) do sistema de Leitner por caixa. Caixa 1 = revisar logo. */
const BOX_INTERVAL_DAYS = [0, 0, 1, 3, 7, 16];

export function nextReview(card: Pick<Flashcard, "box">, result: "known" | "review", now = new Date()) {
  const box = result === "known" ? Math.min(5, card.box + 1) : 1;
  const due = new Date(now.getTime() + (BOX_INTERVAL_DAYS[box] ?? 0) * 86_400_000);
  if (result === "review") due.setTime(now.getTime() + 10 * 60_000); // volta em 10 minutos
  return { box, dueAt: due.toISOString() };
}

export async function generateFlashcards(deps: MaterialDeps & { ai: AiService }, uid: string, input: { materialIds: string[]; count: number; focus?: string }) {
  if (input.count > deps.config.MAX_FLASHCARDS_PER_REQUEST) throw badRequest(`Máximo de ${deps.config.MAX_FLASHCARDS_PER_REQUEST} cartões por vez.`);
  const { chunks, materials } = await loadChunks(deps, uid, input.materialIds);
  const context = selectForGeneration(chunks, input.focus, Math.min(deps.config.AI_CONTEXT_MAX_CHARS, 18_000));
  const result = await deps.ai.generateFlashcards(uid, context, { count: input.count, focus: input.focus });
  const topicByMaterial = new Map(materials.map((m) => [m.id, m.topic]));
  const now = nowIso();
  const batch = deps.db.batch();
  const cards: Flashcard[] = result.cards.map((c) => {
    const ref = userPaths(deps.db, uid).flashcards.doc();
    const card: Flashcard = {
      id: ref.id,
      front: c.front,
      back: c.back,
      subjectName: c.subjectName,
      topic: c.topic || topicByMaterial.get(c.materialId) || "",
      materialId: c.materialId,
      source: c.source,
      createdAt: now,
      box: 1,
      dueAt: now,
      knownCount: 0,
      reviewCount: 0,
      lastResult: null,
      lastReviewedAt: null,
    };
    const { id: _id, ...data } = card;
    batch.set(ref, data);
    return card;
  });
  await batch.commit();
  return { cards, requested: input.count, rejected: result.rejected };
}

/**
 * Lista cartões. Com dueOnly, retorna os que vencem agora, priorizando caixas baixas
 * (dificuldade) e os marcados para revisar.
 */
export async function listFlashcards(deps: MaterialDeps, uid: string, opts: { materialId?: string; dueOnly?: boolean }): Promise<Flashcard[]> {
  let query: Query = userPaths(deps.db, uid).flashcards.limit(1000);
  if (opts.materialId) query = query.where("materialId", "==", opts.materialId);
  const snap = await query.get();
  let cards = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Flashcard, "id">) }));
  const now = new Date().toISOString();
  if (opts.dueOnly) cards = cards.filter((c) => c.dueAt <= now);
  return cards.sort((a, b) => a.box - b.box || a.dueAt.localeCompare(b.dueAt) || a.createdAt.localeCompare(b.createdAt));
}

/**
 * Registra a revisão de um cartão. clientReviewId (gerado no navegador por clique) torna a operação
 * idempotente: o mesmo clique reenviado não altera o cartão duas vezes.
 */
export async function reviewFlashcard(deps: MaterialDeps, uid: string, cardId: string, result: "known" | "review", clientReviewId: string): Promise<Flashcard> {
  const paths = userPaths(deps.db, uid);
  const cardRef = paths.flashcards.doc(cardId);
  const reviewRef = paths.flashcardReviews.doc(clientReviewId);
  return deps.db.runTransaction(async (tx) => {
    const [cardSnap, reviewSnap] = await Promise.all([tx.get(cardRef), tx.get(reviewRef)]);
    if (!cardSnap.exists) throw notFound("Cartão");
    const card = { id: cardSnap.id, ...(cardSnap.data() as Omit<Flashcard, "id">) };
    if (reviewSnap.exists) return card;
    const { box, dueAt } = nextReview(card, result);
    const now = nowIso();
    const update = {
      box,
      dueAt,
      lastResult: result,
      lastReviewedAt: now,
      knownCount: card.knownCount + (result === "known" ? 1 : 0),
      reviewCount: card.reviewCount + (result === "review" ? 1 : 0),
    };
    tx.create(reviewRef, { cardId, result, at: now, boxBefore: card.box, boxAfter: box });
    tx.update(cardRef, update);
    return { ...card, ...update };
  });
}

export async function deleteFlashcard(deps: MaterialDeps, uid: string, cardId: string): Promise<void> {
  const ref = userPaths(deps.db, uid).flashcards.doc(cardId);
  if (!(await ref.get()).exists) throw notFound("Cartão");
  await ref.delete();
}
