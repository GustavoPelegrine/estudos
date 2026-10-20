import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");
const csv = z
  .string()
  .default("")
  .transform((v) => v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  FIREBASE_PROJECT_ID: z.string().min(1).default("demo-estudos-odonto"),
  /** JSON (ou base64) da conta de serviço do Firebase — usado na Vercel. Segredo: nunca versionar. */
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
  /** Origens permitidas para CORS (em produção o Firebase Hosting faz proxy de /api, então pode ficar vazio). */
  CORS_ORIGINS: csv,
  /** Se preenchido, apenas estes e-mails podem usar a API (protege a cota de IA de cadastros indesejados). */
  ALLOWED_EMAILS: csv,
  REQUIRE_EMAIL_VERIFIED: bool.default(false),

  AI_PROVIDER: z.enum(["gemini", "fake", "none"]).optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  GEMINI_MAX_RETRIES: z.coerce.number().int().min(0).max(4).default(2),
  /**
   * Nível de raciocínio (thinking) da Gemini. "low" responde bem mais rápido e basta para as tarefas do portal.
   * Valores aceitos pela gemini-3.8-flash: low, medium, high ("minimal" não é aceito por esse modelo). "off" = não enviar.
   */
  /** Modelo reserva para sobrecarga (503) ou limite (429) do principal. "off" desativa. */
  GEMINI_FALLBACK_MODEL: z.string().default("gemini-3.5-flash"),
  GEMINI_THINKING_LEVEL: z.enum(["low", "medium", "high", "minimal", "off"]).default("low"),
  /** Tempo total máximo de uma operação de IA (todas as tentativas). Deve caber no limite da função (Vercel: 60 s). */
  AI_TIME_BUDGET_MS: z.coerce.number().int().positive().default(55_000),

  AI_DAILY_LIMIT_PER_USER: z.coerce.number().int().positive().default(60),
  AI_DAILY_LIMIT_GLOBAL: z.coerce.number().int().positive().default(400),
  AI_CONTEXT_MAX_CHARS: z.coerce.number().int().positive().default(24_000),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(6),

  MAX_PDF_MB: z.coerce.number().positive().max(32).default(20),
  MAX_MATERIALS_PER_USER: z.coerce.number().int().positive().default(60),
  MAX_PDF_PAGES: z.coerce.number().int().positive().default(400),
  MAX_NOTES_CHARS: z.coerce.number().int().positive().default(150_000),
  MAX_QUESTIONS_PER_QUIZ: z.coerce.number().int().positive().max(30).default(20),
  MAX_FLASHCARDS_PER_REQUEST: z.coerce.number().int().positive().max(40).default(20),
  MAX_MATERIALS_PER_REQUEST: z.coerce.number().int().positive().default(5),
});

export type Config = z.infer<typeof schema> & {
  aiProvider: "gemini" | "fake" | "none";
  maxPdfBytes: number;
  emulators: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Na Vercel (VERCEL=1) o ambiente é sempre produção. NODE_ENV não deve ser cadastrado lá:
  // ele também valeria na instalação e impediria o npm de instalar as ferramentas de build.
  const parsed = schema.safeParse(env.VERCEL && !env.NODE_ENV ? { ...env, NODE_ENV: "production" } : env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuração inválida nas variáveis: ${fields}`);
  }
  const c = parsed.data;
  const aiProvider = c.AI_PROVIDER ?? (c.GEMINI_API_KEY ? "gemini" : "none");
  if (aiProvider === "gemini" && !c.GEMINI_API_KEY) throw new Error("AI_PROVIDER=gemini exige GEMINI_API_KEY.");
  if (aiProvider === "fake" && c.NODE_ENV === "production") throw new Error("O provedor de IA simulado não pode ser usado em produção.");
  const emulators = Boolean(env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST);
  if (emulators && c.NODE_ENV === "production") throw new Error("Variáveis de emulador definidas em produção.");
  return { ...c, aiProvider, maxPdfBytes: Math.round(c.MAX_PDF_MB * 1024 * 1024), emulators };
}
