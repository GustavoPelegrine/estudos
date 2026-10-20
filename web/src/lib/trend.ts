import type { Quiz } from "@estudos/shared";

/** Aproveitamento (%) das tentativas finalizadas, da mais antiga para a mais recente. */
export function accuracyTrend(quizzes: Quiz[]): number[] {
  return quizzes
    .filter((q) => q.status === "finished" && q.questionCount > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((q) => Math.round((q.correctCount / q.questionCount) * 100));
}

/** Diferença entre a última tentativa e a média das anteriores, em pontos percentuais. */
export function trendDelta(series: number[]): number | null {
  if (series.length < 2) return null;
  const prev = series.slice(0, -1);
  const avg = prev.reduce((s, v) => s + v, 0) / prev.length;
  return Math.round(series[series.length - 1]! - avg);
}
