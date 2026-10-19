import type { Limits, Preferences, UsageInfo, UserProfile } from "./types.js";

/** Formato padrão de erro devolvido pelo backend. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface MeResponse {
  profile: UserProfile;
  usage: UsageInfo;
  limits: Limits;
  aiAvailable: boolean;
  aiProvider: "gemini" | "fake" | "none";
  model: string | null;
}

/** Registro de um PDF cujo texto foi extraído no navegador (o arquivo em si não é enviado). */
export interface CreatePdfMaterialRequest {
  subjectId: string;
  topic?: string;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  warnings: string[];
}

export interface PagesUpload {
  pages: { page: number; text: string; hasText: boolean; layout: "single" | "columns" | "empty" }[];
}

/** Lotes pequenos para respeitar o limite de corpo das funções serverless. */
export const PAGES_BATCH_SIZE = 25;
export const PAGES_BATCH_MAX_CHARS = 600_000;

export type PreferencesPatch = Partial<Preferences>;
