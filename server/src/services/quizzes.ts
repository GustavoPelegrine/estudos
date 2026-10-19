import { createHash } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { Difficulty, PublicQuestion, Question, Quiz, QuizAnswer, QuizMode, QuizWithQuestions } from "@estudos/shared";
import type { AiService } from "../ai/service.js";
import { badRequest, conflict, notFound } from "../http/errors.js";
import { nowIso, userPaths } from "../lib/paths.js";
import { normalize } from "../rag/text.js";
import { selectForGeneration } from "../rag/retriever.js";
import { loadChunks, type MaterialDeps } from "./materials.js";

interface QuizKey {
  answers: Record<string, { correctIndex: number; explanation: string; optionExplanations: Question["optionExplanations"] }>;
}

export function topicKey(subjectName: string, topic: string): string {
  return createHash("sha1").update(`${normalize(subjectName)}|${normalize(topic)}`).digest("hex").slice(0, 16);
}

export async function createQuiz(
  deps: MaterialDeps & { ai: AiService },
  uid: string,
  input: { mode: QuizMode; materialIds: string[]; count: number; difficulty: Difficulty | "mista"; focus?: string },
): Promise<{ quiz: QuizWithQuestions; generated: number; requested: number }> {
  if (input.count > deps.config.MAX_QUESTIONS_PER_QUIZ) throw badRequest(`Máximo de ${deps.config.MAX_QUESTIONS_PER_QUIZ} questões por simulado.`);
  const { chunks, materials } = await loadChunks(deps, uid, input.materialIds);
  const context = selectForGeneration(chunks, input.focus, deps.config.AI_CONTEXT_MAX_CHARS);
  const subjectName = [...new Set(materials.map((m) => m.subjectName))].join(", ");
  const result = await deps.ai.generateQuestions(uid, context, { count: input.count, difficulty: input.difficulty, focus: input.focus, subjectName });

  const paths = userPaths(deps.db, uid);
  const ref = paths.quizzes.doc();
  const title = `${input.mode === "exam" ? "Simulado" : "Questões"} — ${materials.map((m) => m.topic || m.fileName).join(", ")}`.slice(0, 160);
  const quiz: Quiz = {
    id: ref.id,
    mode: input.mode,
    title,
    materialIds: materials.map((m) => m.id),
    subjectName,
    createdAt: nowIso(),
    finishedAt: null,
    status: "in_progress",
    questionCount: result.questions.length,
    answeredCount: 0,
    correctCount: 0,
    model: result.model,
  };
  const publicQuestions: PublicQuestion[] = result.questions.map(({ correctIndex: _c, explanation: _e, optionExplanations: _o, ...pub }) => pub);
  const key: QuizKey = { answers: {} };
  for (const q of result.questions) key.answers[q.id] = { correctIndex: q.correctIndex, explanation: q.explanation, optionExplanations: q.optionExplanations };
  const { id: _id, ...data } = quiz;
  const batch = deps.db.batch();
  // Questões e gabarito são gravados juntos e nunca regenerados: o gabarito é consistente durante toda a tentativa.
  batch.set(ref, { ...data, questions: publicQuestions });
  batch.set(paths.quizKeys.doc(ref.id), key);
  await batch.commit();
  return { quiz: { ...quiz, questions: publicQuestions, answers: [] }, generated: result.questions.length, requested: input.count };
}

export async function listQuizzes(deps: MaterialDeps, uid: string, limit = 30): Promise<Quiz[]> {
  const snap = await userPaths(deps.db, uid).quizzes.orderBy("createdAt", "desc").limit(limit).get();
  return snap.docs.map((d) => {
    const { questions: _q, ...rest } = d.data();
    return { id: d.id, ...(rest as Omit<Quiz, "id">) };
  });
}

/**
 * Retorna o simulado sem o gabarito das questões ainda não respondidas.
 * No modo "exam" o gabarito só é revelado depois de finalizar.
 */
export async function getQuiz(deps: MaterialDeps, uid: string, id: string): Promise<QuizWithQuestions> {
  const paths = userPaths(deps.db, uid);
  const [snap, keySnap, answersSnap, materialsSnap] = await Promise.all([
    paths.quizzes.doc(id).get(),
    paths.quizKeys.doc(id).get(),
    paths.answers(id).get(),
    paths.materials.select().get(),
  ]);
  if (!snap.exists || !keySnap.exists) throw notFound("Simulado");
  const { questions, ...rest } = snap.data() as Omit<Quiz, "id"> & { questions: PublicQuestion[] };
  const key = keySnap.data() as QuizKey;
  const answers = answersSnap.docs.map((d) => d.data() as QuizAnswer);
  const answered = new Set(answers.map((a) => a.questionId));
  const existing = new Set(materialsSnap.docs.map((d) => d.id));
  const reveal = (q: PublicQuestion) => rest.status === "finished" || (rest.mode === "practice" && answered.has(q.id));
  return {
    id: snap.id,
    ...rest,
    answers,
    questions: questions.map((q) => {
      const source = q.source ? { ...q.source, materialDeleted: !existing.has(q.source.materialId) } : null;
      return reveal(q) ? { ...q, source, ...key.answers[q.id] } : { ...q, source };
    }),
  };
}

/**
 * Registra a resposta de forma idempotente: o documento da resposta usa o id da questão e é
 * criado dentro de uma transação. Cliques repetidos ou reenvios não contam duas vezes.
 */
export async function answerQuestion(deps: MaterialDeps, uid: string, quizId: string, questionId: string, selectedIndex: number) {
  const paths = userPaths(deps.db, uid);
  const quizRef = paths.quizzes.doc(quizId);
  const answerRef = paths.answers(quizId).doc(questionId);
  return deps.db.runTransaction(async (tx) => {
    const [quizSnap, keySnap, answerSnap] = await Promise.all([tx.get(quizRef), tx.get(paths.quizKeys.doc(quizId)), tx.get(answerRef)]);
    if (!quizSnap.exists || !keySnap.exists) throw notFound("Simulado");
    const quiz = quizSnap.data() as Omit<Quiz, "id"> & { questions: PublicQuestion[] };
    const question = quiz.questions.find((q) => q.id === questionId);
    const key = (keySnap.data() as QuizKey).answers[questionId];
    if (!question || !key) throw notFound("Questão");
    const reveal = quiz.mode === "practice";
    if (answerSnap.exists) {
      // Resposta já registrada: devolve o mesmo resultado, sem alterar contadores.
      const prev = answerSnap.data() as QuizAnswer;
      return { answer: prev, duplicate: true, ...(reveal ? key : {}) };
    }
    if (quiz.status === "finished") throw conflict("Este simulado já foi finalizado.");
    const correct = selectedIndex === key.correctIndex;
    const answer: QuizAnswer = { questionId, selectedIndex, correct, answeredAt: nowIso() };
    tx.create(answerRef, { ...answer, topic: question.topic, subjectName: question.subjectName });
    tx.update(quizRef, { answeredCount: FieldValue.increment(1), correctCount: FieldValue.increment(correct ? 1 : 0) });
    const tk = topicKey(question.subjectName, question.topic);
    tx.set(
      paths.stats,
      {
        answered: FieldValue.increment(1),
        correct: FieldValue.increment(correct ? 1 : 0),
        topics: { [tk]: { topic: question.topic, subjectName: question.subjectName, answered: FieldValue.increment(1), correct: FieldValue.increment(correct ? 1 : 0) } },
      },
      { merge: true },
    );
    return { answer, duplicate: false, ...(reveal ? key : {}) };
  });
}

export async function finishQuiz(deps: MaterialDeps, uid: string, quizId: string): Promise<QuizWithQuestions> {
  const paths = userPaths(deps.db, uid);
  const quizRef = paths.quizzes.doc(quizId);
  await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(quizRef);
    if (!snap.exists) throw notFound("Simulado");
    if (snap.get("status") === "finished") return;
    tx.update(quizRef, { status: "finished", finishedAt: nowIso() });
    tx.set(paths.stats, { quizzesFinished: FieldValue.increment(1) }, { merge: true });
  });
  return getQuiz(deps, uid, quizId);
}

export async function deleteQuiz(deps: MaterialDeps, uid: string, quizId: string): Promise<void> {
  const paths = userPaths(deps.db, uid);
  const snap = await paths.quizzes.doc(quizId).get();
  if (!snap.exists) throw notFound("Simulado");
  // As estatísticas agregadas permanecem (histórico de desempenho); apenas o simulado é removido.
  await deps.db.recursiveDelete(paths.quizzes.doc(quizId));
  await paths.quizKeys.doc(quizId).delete();
}
