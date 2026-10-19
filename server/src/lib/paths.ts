import type { Firestore } from "firebase-admin/firestore";

/**
 * Único ponto onde caminhos do Firestore são montados.
 * O uid SEMPRE vem do token verificado (req.user.uid), nunca do corpo/parâmetros da requisição.
 */
export function userPaths(db: Firestore, uid: string) {
  const user = db.collection("users").doc(uid);
  return {
    user,
    subjects: user.collection("subjects"),
    materials: user.collection("materials"),
    pages: (materialId: string) => user.collection("materials").doc(materialId).collection("pages"),
    flashcards: user.collection("flashcards"),
    flashcardReviews: user.collection("flashcardReviews"),
    quizzes: user.collection("quizzes"),
    /** Gabaritos ficam separados e não são legíveis pelo cliente (ver firestore.rules). */
    quizKeys: user.collection("quizKeys"),
    answers: (quizId: string) => user.collection("quizzes").doc(quizId).collection("answers"),
    conversations: user.collection("conversations"),
    messages: (conversationId: string) => user.collection("conversations").doc(conversationId).collection("messages"),
    stats: user.collection("stats").doc("summary"),
    usage: (day: string) => user.collection("usage").doc(day),
  };
}

export const globalUsage = (db: Firestore, day: string) => db.collection("usageGlobal").doc(day);

export function pageDocId(page: number): string {
  return String(page).padStart(4, "0");
}

export function today(now = new Date()): string {
  // Dia no fuso de Brasília, para que a cota "vire" à meia-noite local.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export const nowIso = () => new Date().toISOString();
