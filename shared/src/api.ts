import type { Limits, Material, Preferences, UsageInfo, UserProfile } from "./types.js";

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

export interface CreateMaterialRequest {
  subjectId: string;
  topic?: string;
  fileName: string;
  sizeBytes: number;
}

export interface CreateMaterialResponse {
  material: Material;
  /** Caminho privado no Firebase Storage onde o PDF deve ser enviado. */
  uploadPath: string;
}

export type PreferencesPatch = Partial<Preferences>;

export const PDF_CONTENT_TYPE = "application/pdf";
export const STORAGE_PDF_NAME = "original.pdf";

export function materialStoragePath(uid: string, materialId: string): string {
  return `users/${uid}/materials/${materialId}/${STORAGE_PDF_NAME}`;
}
