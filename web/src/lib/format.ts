import type { MaterialStatus } from "@estudos/shared";

export const STATUS_LABEL: Record<MaterialStatus, { text: string; tone: "good" | "warn" | "bad" | "info" }> = {
  processing: { text: "Recebendo texto…", tone: "info" },
  needs_review: { text: "Conferir texto", tone: "warn" },
  needs_ocr: { text: "Exige OCR", tone: "bad" },
  ready: { text: "Pronto", tone: "good" },
  failed: { text: "Falhou", tone: "bad" },
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function percent(correct: number, total: number): string {
  return total ? `${Math.round((correct / total) * 100)}%` : "—";
}

export const DIFFICULTY_LABEL: Record<string, string> = { facil: "Fácil", media: "Média", dificil: "Difícil", mista: "Mista" };
export const SKILL_LABEL: Record<string, string> = {
  conceito: "Conceito",
  estrutura_funcao: "Estrutura e função",
  comparacao: "Comparação",
  causa_consequencia: "Causa e consequência",
  aplicacao: "Aplicação",
  caso_clinico: "Situação clínica",
  analise: "Análise",
};

export function uuid(): string {
  return crypto.randomUUID();
}
