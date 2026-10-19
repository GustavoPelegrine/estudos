/**
 * Modelo de dados compartilhado entre frontend e backend.
 * Todos os registros privados ficam sob users/{uid} no Firestore — ver docs/MODELO_DE_DADOS.md.
 */

export type ISODate = string;

export interface Preferences {
  theme: "dark" | "light";
  defaultSemester: number;
  defaultQuestionCount: number;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  createdAt: ISODate;
  preferences: Preferences;
}

export interface Subject {
  id: string;
  name: string;
  semester: number;
  createdAt: ISODate;
}

export type MaterialKind = "pdf" | "notes";

/**
 * Ciclo de vida de um material (o PDF é lido no navegador; só o texto é enviado):
 * processing (recebendo texto) → needs_review → ready
 *                              ↘ needs_ocr (PDF digitalizado, sem texto extraível)
 *                              ↘ failed (envio interrompido)
 */
export type MaterialStatus = "processing" | "needs_review" | "needs_ocr" | "ready" | "failed";

export interface ExtractionReport {
  pageCount: number;
  pagesWithText: number;
  /** Páginas sem texto extraível (prováveis imagens digitalizadas). */
  pagesWithoutText: number[];
  /** Páginas em que foi detectado layout de múltiplas colunas. */
  multiColumnPages: number[];
  charCount: number;
  /** Avisos legíveis em português (ex.: "texto possivelmente corrompido na página 3"). */
  warnings: string[];
  ocrRequired: boolean;
  extractorVersion: string;
}

export interface Material {
  id: string;
  ownerUid: string;
  kind: MaterialKind;
  subjectId: string;
  subjectName: string;
  semester: number;
  topic: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: ISODate;
  updatedAt: ISODate;
  status: MaterialStatus;
  pageCount: number;
  extraction: ExtractionReport | null;
  errorMessage: string | null;
  studied: boolean;
}

export interface MaterialPage {
  page: number;
  /** Texto normalizado. Linhas iniciadas por "# " são títulos detectados; parágrafos separados por linha em branco. */
  text: string;
  charCount: number;
  hasText: boolean;
  layout: "single" | "columns" | "empty";
  editedByUser: boolean;
}

/** Referência verificável a um trecho de material. */
export interface SourceRef {
  materialId: string;
  fileName: string;
  subjectName: string;
  page: number;
  /** Trecho curto do material original (não gerado pela IA). */
  excerpt: string;
  materialDeleted?: boolean;
}

export type Difficulty = "facil" | "media" | "dificil";

export interface Flashcard {
  id: string;
  front: string;
  back: string;
  subjectName: string;
  topic: string;
  materialId: string | null;
  source: SourceRef | null;
  createdAt: ISODate;
  /** Sistema de Leitner: caixa 1 (difícil) a 5 (dominado). */
  box: number;
  dueAt: ISODate;
  knownCount: number;
  reviewCount: number;
  lastResult: "known" | "review" | null;
  lastReviewedAt: ISODate | null;
}

export type QuizMode = "practice" | "exam";

export interface Question {
  id: string;
  stem: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  /** Por que cada alternativa está errada (string vazia para a correta ou quando não houver explicação). */
  optionExplanations: [string, string, string, string];
  topic: string;
  skill: string;
  difficulty: Difficulty;
  subjectName: string;
  source: SourceRef | null;
}

/** Questão como enviada ao navegador antes de ser respondida: sem gabarito. */
export type PublicQuestion = Omit<Question, "correctIndex" | "explanation" | "optionExplanations"> & {
  correctIndex?: number;
  explanation?: string;
  optionExplanations?: [string, string, string, string];
};

export interface QuizAnswer {
  questionId: string;
  selectedIndex: number;
  correct: boolean;
  answeredAt: ISODate;
}

export interface Quiz {
  id: string;
  mode: QuizMode;
  title: string;
  materialIds: string[];
  subjectName: string;
  createdAt: ISODate;
  finishedAt: ISODate | null;
  status: "in_progress" | "finished";
  questionCount: number;
  answeredCount: number;
  correctCount: number;
  model: string;
}

export interface QuizWithQuestions extends Quiz {
  questions: PublicQuestion[];
  answers: QuizAnswer[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations: SourceRef[];
  /** false quando o tutor não encontrou evidências suficientes no material. */
  grounded: boolean;
  createdAt: ISODate;
}

export interface Conversation {
  id: string;
  title: string;
  materialIds: string[];
  createdAt: ISODate;
  updatedAt: ISODate;
  messageCount: number;
}

export interface TopicStat {
  key: string;
  topic: string;
  subjectName: string;
  answered: number;
  correct: number;
}

export interface StatsSummary {
  answered: number;
  correct: number;
  quizzesFinished: number;
  flashcardsTotal: number;
  flashcardsDue: number;
  weakTopics: TopicStat[];
  topics: TopicStat[];
  recentQuizzes: Quiz[];
  suggestions: string[];
}

export interface UsageInfo {
  day: string;
  aiCalls: number;
  aiDailyLimit: number;
}

export interface Limits {
  maxPdfBytes: number;
  maxPdfPages: number;
  maxMaterials: number;
  maxQuestionsPerQuiz: number;
  maxFlashcardsPerRequest: number;
  maxMaterialsPerRequest: number;
}
