import type {
  ChatMessage,
  Conversation,
  CreatePdfMaterialRequest,
  PagesUpload,
  Flashcard,
  Material,
  MaterialPage,
  MeResponse,
  Preferences,
  Quiz,
  QuizAnswer,
  QuizWithQuestions,
  StatsSummary,
  Subject,
  Difficulty,
  QuizMode,
} from "@estudos/shared";
import { auth } from "./firebase";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 120_000;

async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new ApiError(401, "unauthenticated", "Faça login para continuar.");
  return { authorization: `Bearer ${await user.getIdToken()}` };
}

/** Requisição autenticada ao backend. O token é obtido do Firebase Auth a cada chamada (renovado automaticamente). */
export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { ...(await authHeader()), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (controller.signal.aborted) throw new ApiError(0, "timeout", "O servidor demorou demais para responder. Tente novamente.");
    throw new ApiError(0, "network", "Sem conexão com o servidor. Verifique sua internet.");
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? "http_error", data?.error?.message ?? `Erro ${res.status}. Tente novamente.`);
  }
  return data as T;
}

export const api = {
  me: () => request<MeResponse>("GET", "/me"),
  updatePreferences: (p: Partial<Preferences>) => request<{ preferences: Preferences }>("PATCH", "/me/preferences", p),
  exportData: () => request<Record<string, unknown>>("GET", "/me/export"),
  deleteAccountData: () => request<{ ok: true }>("DELETE", "/me", { confirm: "EXCLUIR" }),
  importLegacy: (backup: unknown) => request<{ imported: number; skipped: string[] }>("POST", "/import/legacy", backup),

  subjects: () => request<{ subjects: Subject[] }>("GET", "/subjects"),
  createSubject: (name: string, semester: number) => request<{ subject: Subject }>("POST", "/subjects", { name, semester }),
  updateSubject: (id: string, patch: { name?: string; semester?: number }) => request<{ subject: Subject }>("PATCH", `/subjects/${id}`, patch),
  deleteSubject: (id: string) => request<{ ok: true }>("DELETE", `/subjects/${id}`),

  materials: () => request<{ materials: Material[] }>("GET", "/materials"),
  material: (id: string) => request<{ material: Material }>("GET", `/materials/${id}`),
  createPdfMaterial: (b: CreatePdfMaterialRequest) => request<{ material: Material }>("POST", "/materials", b),
  uploadPages: (id: string, pages: PagesUpload["pages"]) => request<{ received: number }>("POST", `/materials/${id}/pages`, { pages }),
  finalizeMaterial: (id: string) => request<{ material: Material }>("POST", `/materials/${id}/finalize`),
  createNotes: (b: { subjectId: string; topic?: string; title: string; text: string }) => request<{ material: Material }>("POST", "/materials/notes", b),
  approveMaterial: (id: string) => request<{ material: Material }>("POST", `/materials/${id}/approve`),
  updateMaterial: (id: string, patch: { topic?: string; studied?: boolean; subjectId?: string }) => request<{ material: Material }>("PATCH", `/materials/${id}`, patch),
  deleteMaterial: (id: string) => request<{ ok: true }>("DELETE", `/materials/${id}`),
  pages: (id: string, from: number, to: number) => request<{ pages: MaterialPage[] }>("GET", `/materials/${id}/pages?from=${from}&to=${to}`),
  updatePage: (id: string, page: number, text: string) => request<{ page: MaterialPage }>("PATCH", `/materials/${id}/pages/${page}`, { text }),

  flashcards: (q: { materialId?: string; due?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (q.materialId) params.set("materialId", q.materialId);
    if (q.due) params.set("due", "1");
    return request<{ flashcards: Flashcard[] }>("GET", `/flashcards?${params}`);
  },
  generateFlashcards: (b: { materialIds: string[]; count: number; focus?: string }) => request<{ cards: Flashcard[]; requested: number; rejected: number }>("POST", "/flashcards/generate", b),
  reviewFlashcard: (id: string, result: "known" | "review", clientReviewId: string) => request<{ flashcard: Flashcard }>("POST", `/flashcards/${id}/review`, { result, clientReviewId }),
  deleteFlashcard: (id: string) => request<{ ok: true }>("DELETE", `/flashcards/${id}`),

  quizzes: () => request<{ quizzes: Quiz[] }>("GET", "/quizzes"),
  quiz: (id: string) => request<{ quiz: QuizWithQuestions }>("GET", `/quizzes/${id}`),
  createQuiz: (b: { mode: QuizMode; materialIds: string[]; count: number; difficulty: Difficulty | "mista"; focus?: string }) =>
    request<{ quiz: QuizWithQuestions; generated: number; requested: number }>("POST", "/quizzes", b),
  answer: (quizId: string, questionId: string, selectedIndex: number) =>
    request<{ answer: QuizAnswer; duplicate: boolean; correctIndex?: number; explanation?: string; optionExplanations?: [string, string, string, string] }>(
      "POST",
      `/quizzes/${quizId}/answers`,
      { questionId, selectedIndex },
    ),
  finishQuiz: (id: string) => request<{ quiz: QuizWithQuestions }>("POST", `/quizzes/${id}/finish`),
  deleteQuiz: (id: string) => request<{ ok: true }>("DELETE", `/quizzes/${id}`),

  conversations: () => request<{ conversations: Conversation[] }>("GET", "/conversations"),
  conversation: (id: string) => request<{ conversation: Conversation & { messages: ChatMessage[] } }>("GET", `/conversations/${id}`),
  createConversation: (materialIds: string[]) => request<{ conversation: Conversation }>("POST", "/conversations", { materialIds }),
  deleteConversation: (id: string) => request<{ ok: true }>("DELETE", `/conversations/${id}`),
  ask: (id: string, text: string) => request<{ user: ChatMessage; assistant: ChatMessage }>("POST", `/conversations/${id}/messages`, { text }),

  stats: () => request<{ stats: StatsSummary }>("GET", "/stats"),
};
