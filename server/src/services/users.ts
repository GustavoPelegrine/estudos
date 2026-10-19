import type { Query } from "firebase-admin/firestore";
import type { Flashcard, Preferences, StatsSummary, Subject, TopicStat, UserProfile } from "@estudos/shared";
import { badRequest, conflict, notFound } from "../http/errors.js";
import { nowIso, userPaths } from "../lib/paths.js";
import { createNotesMaterial, type MaterialDeps } from "./materials.js";
import { listQuizzes } from "./quizzes.js";

export const DEFAULT_PREFERENCES: Preferences = { theme: "dark", defaultSemester: 1, defaultQuestionCount: 10 };

/** Cria o perfil no primeiro acesso. O uid e o e-mail vêm do token verificado. */
export async function ensureProfile(deps: MaterialDeps, uid: string, email: string | null, displayName: string | null): Promise<UserProfile> {
  const ref = userPaths(deps.db, uid).user;
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data() as Omit<UserProfile, "uid">;
    return { uid, ...data, preferences: { ...DEFAULT_PREFERENCES, ...data.preferences } };
  }
  const profile: UserProfile = { uid, email, displayName, createdAt: nowIso(), preferences: DEFAULT_PREFERENCES };
  const { uid: _u, ...data } = profile;
  await ref.create(data).catch(async (err: { code?: number }) => {
    if (err.code !== 6) throw err; // ALREADY_EXISTS: requisição concorrente criou o perfil
  });
  return profile;
}

export async function updatePreferences(deps: MaterialDeps, uid: string, patch: Partial<Preferences>): Promise<Preferences> {
  const ref = userPaths(deps.db, uid).user;
  const snap = await ref.get();
  const prefs = { ...DEFAULT_PREFERENCES, ...((snap.get("preferences") as Preferences | undefined) ?? {}), ...patch };
  await ref.set({ preferences: prefs }, { merge: true });
  return prefs;
}

// ---------- Disciplinas ----------

export async function listSubjects(deps: MaterialDeps, uid: string): Promise<Subject[]> {
  const snap = await userPaths(deps.db, uid).subjects.orderBy("semester").limit(200).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subject, "id">) })).sort((a, b) => a.semester - b.semester || a.name.localeCompare(b.name, "pt-BR"));
}

export async function createSubject(deps: MaterialDeps, uid: string, input: { name: string; semester: number }): Promise<Subject> {
  const name = input.name.trim().replace(/\s+/gu, " ");
  const existing = await listSubjects(deps, uid);
  if (existing.length >= 100) throw conflict("Limite de 100 disciplinas atingido.");
  const dup = existing.find((s) => s.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR") && s.semester === input.semester);
  if (dup) return dup;
  const ref = userPaths(deps.db, uid).subjects.doc();
  const subject: Subject = { id: ref.id, name, semester: input.semester, createdAt: nowIso() };
  const { id: _id, ...data } = subject;
  await ref.set(data);
  return subject;
}

export async function updateSubject(deps: MaterialDeps, uid: string, id: string, input: { name?: string; semester?: number }): Promise<Subject> {
  const paths = userPaths(deps.db, uid);
  const ref = paths.subjects.doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Disciplina");
  const update: Partial<Subject> = {};
  if (input.name !== undefined) update.name = input.name.trim().replace(/\s+/gu, " ");
  if (input.semester !== undefined) update.semester = input.semester;
  await ref.update(update);
  // Mantém os dados desnormalizados dos materiais consistentes.
  const mats = await paths.materials.where("subjectId", "==", id).get();
  const writer = deps.db.bulkWriter();
  for (const m of mats.docs) void writer.update(m.ref, { ...(update.name ? { subjectName: update.name } : {}), ...(update.semester ? { semester: update.semester } : {}) });
  await writer.close();
  return { id, ...(snap.data() as Omit<Subject, "id">), ...update };
}

export async function deleteSubject(deps: MaterialDeps, uid: string, id: string): Promise<void> {
  const paths = userPaths(deps.db, uid);
  const ref = paths.subjects.doc(id);
  if (!(await ref.get()).exists) throw notFound("Disciplina");
  const used = await paths.materials.where("subjectId", "==", id).limit(1).get();
  if (!used.empty) throw conflict("Exclua ou mova os materiais desta disciplina antes de removê-la.", "subject_in_use");
  await ref.delete();
}

// ---------- Desempenho ----------

export async function getStats(deps: MaterialDeps, uid: string): Promise<StatsSummary> {
  const paths = userPaths(deps.db, uid);
  const [statsSnap, recentQuizzes, cardsSnap] = await Promise.all([paths.stats.get(), listQuizzes(deps, uid, 10), paths.flashcards.select("dueAt", "box", "topic", "subjectName").get()]);
  const data = (statsSnap.data() ?? {}) as { answered?: number; correct?: number; quizzesFinished?: number; topics?: Record<string, Omit<TopicStat, "key">> };
  const topics: TopicStat[] = Object.entries(data.topics ?? {}).map(([key, t]) => ({ key, ...t }));
  // Assuntos mais fracos: pelo menos 2 respostas, menor taxa de acerto, depois mais erros absolutos.
  const weakTopics = topics
    .filter((t) => t.answered >= 2 && t.correct / t.answered < 0.7)
    .sort((a, b) => a.correct / a.answered - b.correct / b.answered || b.answered - b.correct - (a.answered - a.correct))
    .slice(0, 6);
  const now = nowIso();
  const cards = cardsSnap.docs.map((d) => d.data() as Pick<Flashcard, "dueAt" | "box" | "topic" | "subjectName">);
  const due = cards.filter((c) => c.dueAt <= now);
  const hardCards = cards.filter((c) => c.box <= 1 && c.dueAt <= now);

  const suggestions: string[] = [];
  for (const t of weakTopics.slice(0, 3)) {
    suggestions.push(`Revise "${t.topic}" (${t.subjectName}): ${t.correct} acerto(s) em ${t.answered} resposta(s). Releia as páginas citadas nos gabaritos e refaça questões sobre o tema.`);
  }
  if (hardCards.length) suggestions.push(`Você tem ${hardCards.length} flashcard(s) marcados como difíceis aguardando revisão.`);
  else if (due.length) suggestions.push(`${due.length} flashcard(s) estão prontos para revisão hoje.`);
  const unfinished = recentQuizzes.filter((q) => q.status === "in_progress" && q.answeredCount > 0);
  if (unfinished.length) suggestions.push(`Há ${unfinished.length} simulado(s) em andamento. Finalize-os para consultar o gabarito comentado.`);
  if (!topics.length && !cards.length) suggestions.push("Envie um material, confira o texto extraído e gere suas primeiras questões ou flashcards.");

  return {
    answered: data.answered ?? 0,
    correct: data.correct ?? 0,
    quizzesFinished: data.quizzesFinished ?? 0,
    flashcardsTotal: cards.length,
    flashcardsDue: due.length,
    weakTopics,
    topics: topics.sort((a, b) => b.answered - a.answered).slice(0, 50),
    recentQuizzes,
    suggestions,
  };
}

// ---------- Portabilidade (LGPD) ----------

/** Exporta todos os dados textuais do usuário (os PDFs originais podem ser baixados individualmente). */
export async function exportUserData(deps: MaterialDeps, uid: string): Promise<Record<string, unknown>> {
  const paths = userPaths(deps.db, uid);
  const all = async (q: Query) => (await q.get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const materials = await all(paths.materials);
  const pages: Record<string, unknown[]> = {};
  for (const m of materials) pages[m.id] = (await all(paths.pages(m.id).orderBy("page"))).map(({ id: _id, ...p }) => p);
  const quizzes = await all(paths.quizzes);
  const answers: Record<string, unknown[]> = {};
  for (const q of quizzes) answers[q.id] = await all(paths.answers(q.id));
  const conversations = await all(paths.conversations);
  const messages: Record<string, unknown[]> = {};
  for (const c of conversations) messages[c.id] = await all(paths.messages(c.id).orderBy("createdAt"));
  return {
    exportedAt: nowIso(),
    format: "estudos-odonto-export-v1",
    profile: (await paths.user.get()).data() ?? null,
    subjects: await all(paths.subjects),
    materials,
    pages,
    flashcards: await all(paths.flashcards),
    quizzes,
    answers,
    conversations,
    messages,
    stats: (await paths.stats.get()).data() ?? null,
  };
}

/** Exclui definitivamente todos os dados do usuário no Firestore. A conta de login é removida pelo cliente. */
export async function deleteAllUserData(deps: MaterialDeps, uid: string): Promise<void> {
  await deps.db.recursiveDelete(userPaths(deps.db, uid).user);
}

/**
 * Importa o backup JSON da versão HTML original (localStorage), convertendo cada material de texto
 * em uma disciplina + material de anotações.
 */
export async function importLegacyBackup(deps: MaterialDeps, uid: string, backup: { materials: { subject: string; semester?: number; topic?: string; text: string }[] }) {
  if (backup.materials.length > 50) throw badRequest("O backup tem materiais demais para importar de uma vez (máximo 50).");
  let imported = 0;
  const skipped: string[] = [];
  for (const m of backup.materials) {
    const text = m.text.trim();
    if (text.length < 20) {
      skipped.push(m.subject);
      continue;
    }
    const subject = await createSubject(deps, uid, { name: m.subject.slice(0, 80) || "Sem disciplina", semester: Math.min(12, Math.max(1, Math.round(m.semester ?? 1))) });
    await createNotesMaterial(deps, uid, { subjectId: subject.id, topic: m.topic, title: `${m.subject}${m.topic ? ` — ${m.topic}` : ""} (importado)`, text: text.slice(0, deps.config.MAX_NOTES_CHARS) });
    imported++;
  }
  return { imported, skipped };
}
