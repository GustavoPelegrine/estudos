import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { z } from "zod";
import { PAGES_BATCH_MAX_CHARS, PAGES_BATCH_SIZE, type MeResponse } from "@estudos/shared";
import type { AiService } from "./ai/service.js";
import type { Config } from "./config.js";
import type { FirebaseServices } from "./firebase.js";
import { currentUser, requireAuth } from "./http/auth.js";
import { AppError } from "./http/errors.js";
import { userRateLimit } from "./http/rate-limit.js";
import { parse } from "./http/validate.js";
import { log } from "./lib/log.js";
import * as flashcards from "./services/flashcards.js";
import * as materials from "./services/materials.js";
import * as quizzes from "./services/quizzes.js";
import * as tutor from "./services/tutor.js";
import { getUsage } from "./services/usage.js";
import * as users from "./services/users.js";

export interface AppDeps {
  config: Config;
  firebase: FirebaseServices;
  ai: AiService;
}

// IDs do Firestore gerados pelo servidor: 20 caracteres alfanuméricos. Rejeita qualquer outra coisa (inclusive "/" e "..").
const docId = z.string().regex(/^[A-Za-z0-9]{1,40}$/u);
const uuidLike = z.string().regex(/^[A-Za-z0-9-]{8,64}$/u);
const materialIds = z.array(docId).min(1).max(10);
const shortText = (max: number) => z.string().trim().max(max);

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).then((body) => {
    if (!res.headersSent) res.json(body ?? { ok: true });
  }, next);
};

export function createApp(deps: AppDeps) {
  const { config, firebase, ai } = deps;
  const ctx = { db: firebase.db, config, ai };
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'self'"] } }, crossOriginResourcePolicy: { policy: "same-origin" } }));

  // CORS restrito: em produção o Hosting faz proxy de /api (mesma origem) e a lista fica vazia.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.CORS_ORIGINS.includes(origin.toLowerCase())) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE");
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  });
  app.use(express.json({ limit: "512kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  const api = express.Router();
  api.use(requireAuth(firebase.auth, config));
  api.use(userRateLimit(config.RATE_LIMIT_PER_MINUTE, "Muitas requisições em pouco tempo. Aguarde um minuto."));
  const aiLimit = userRateLimit(config.AI_RATE_LIMIT_PER_MINUTE, "Muitas solicitações de IA em pouco tempo. Aguarde um minuto.");
  // Corpo maior apenas para importação de backup.
  const bigJson = express.json({ limit: "6mb" });

  // ---------- Perfil ----------
  api.get(
    "/me",
    h(async (req) => {
      const u = currentUser(req);
      const [profile, usage] = await Promise.all([users.ensureProfile(ctx, u.uid, u.email, u.name), getUsage(ctx.db, u.uid)]);
      const body: MeResponse = {
        profile,
        usage: { ...usage, aiDailyLimit: config.AI_DAILY_LIMIT_PER_USER },
        limits: {
          maxPdfBytes: config.maxPdfBytes,
          maxPdfPages: config.MAX_PDF_PAGES,
          maxMaterials: config.MAX_MATERIALS_PER_USER,
          maxQuestionsPerQuiz: config.MAX_QUESTIONS_PER_QUIZ,
          maxFlashcardsPerRequest: config.MAX_FLASHCARDS_PER_REQUEST,
          maxMaterialsPerRequest: config.MAX_MATERIALS_PER_REQUEST,
        },
        aiAvailable: ai.available,
        aiProvider: ai.providerName,
        model: ai.modelName,
      };
      return body;
    }),
  );
  api.patch(
    "/me/preferences",
    h(async (req) => {
      const body = parse(
        z.object({ theme: z.enum(["dark", "light"]).optional(), defaultSemester: z.number().int().min(1).max(12).optional(), defaultQuestionCount: z.number().int().min(1).max(30).optional() }).strict(),
        req.body,
      );
      return { preferences: await users.updatePreferences(ctx, currentUser(req).uid, body) };
    }),
  );
  api.get(
    "/me/export",
    h(async (req, res) => {
      const data = await users.exportUserData(ctx, currentUser(req).uid);
      res.setHeader("Content-Disposition", 'attachment; filename="estudos-odonto-dados.json"');
      return data;
    }),
  );
  api.delete(
    "/me",
    h(async (req) => {
      parse(z.object({ confirm: z.literal("EXCLUIR") }), req.body);
      await users.deleteAllUserData(ctx, currentUser(req).uid);
      return { ok: true };
    }),
  );
  api.post(
    "/import/legacy",
    bigJson,
    h(async (req) => {
      const body = parse(
        z.object({
          materials: z
            .array(z.object({ subject: shortText(120).min(1), semester: z.coerce.number().optional(), topic: shortText(140).optional(), text: z.string().max(200_000) }).passthrough())
            .max(50),
        }).passthrough(),
        req.body,
      );
      return users.importLegacyBackup(ctx, currentUser(req).uid, body);
    }),
  );

  // ---------- Disciplinas ----------
  const subjectBody = z.object({ name: shortText(80).min(2), semester: z.number().int().min(1).max(12) });
  api.get("/subjects", h(async (req) => ({ subjects: await users.listSubjects(ctx, currentUser(req).uid) })));
  api.post("/subjects", h(async (req) => ({ subject: await users.createSubject(ctx, currentUser(req).uid, parse(subjectBody, req.body)) })));
  api.patch(
    "/subjects/:id",
    h(async (req) => ({ subject: await users.updateSubject(ctx, currentUser(req).uid, parse(docId, req.params.id), parse(subjectBody.partial().strict(), req.body)) })),
  );
  api.delete("/subjects/:id", h(async (req) => users.deleteSubject(ctx, currentUser(req).uid, parse(docId, req.params.id))));

  // ---------- Materiais ----------
  api.get("/materials", h(async (req) => ({ materials: await materials.listMaterials(ctx, currentUser(req).uid) })));
  // PDF lido no navegador: registro + texto em lotes + finalização (o arquivo não é enviado).
  api.post(
    "/materials",
    h(async (req) => {
      const body = parse(
        z
          .object({
            subjectId: docId,
            topic: shortText(140).optional(),
            fileName: shortText(200).min(1),
            sizeBytes: z.number().int().positive(),
            pageCount: z.number().int().min(1).max(5000),
            warnings: z.array(z.string().max(500)).max(20).default([]),
          })
          .strict(),
        req.body,
      );
      return { material: await materials.createPdfMaterial(ctx, currentUser(req).uid, body) };
    }),
  );
  api.post(
    "/materials/:id/pages",
    bigJson,
    h(async (req) => {
      const body = parse(
        z
          .object({
            pages: z
              .array(z.object({ page: z.number().int().min(1).max(5000), text: z.string().max(100_000), hasText: z.boolean(), layout: z.enum(["single", "columns", "empty"]) }).strict())
              .min(1)
              .max(PAGES_BATCH_SIZE)
              .refine((pages) => pages.reduce((n, p) => n + p.text.length, 0) <= PAGES_BATCH_MAX_CHARS, "lote grande demais"),
          })
          .strict(),
        req.body,
      );
      return materials.addPages(ctx, currentUser(req).uid, parse(docId, req.params.id), body.pages);
    }),
  );
  api.post("/materials/:id/finalize", h(async (req) => ({ material: await materials.finalizePdfMaterial(ctx, currentUser(req).uid, parse(docId, req.params.id)) })));
  api.post(
    "/materials/notes",
    bigJson,
    h(async (req) => {
      const body = parse(z.object({ subjectId: docId, topic: shortText(140).optional(), title: shortText(140).min(1), text: z.string().max(config.MAX_NOTES_CHARS + 1000) }).strict(), req.body);
      return { material: await materials.createNotesMaterial(ctx, currentUser(req).uid, body) };
    }),
  );
  api.get("/materials/:id", h(async (req) => ({ material: await materials.getMaterial(ctx, currentUser(req).uid, parse(docId, req.params.id)) })));
  api.patch(
    "/materials/:id",
    h(async (req) => {
      const body = parse(z.object({ topic: shortText(140).optional(), studied: z.boolean().optional(), subjectId: docId.optional() }).strict(), req.body);
      return { material: await materials.updateMaterialMeta(ctx, currentUser(req).uid, parse(docId, req.params.id), body) };
    }),
  );
  api.delete(
    "/materials/:id",
    h(async (req) => {
      await materials.deleteMaterial(ctx, currentUser(req).uid, parse(docId, req.params.id));
      return { ok: true };
    }),
  );
  api.post("/materials/:id/approve", h(async (req) => ({ material: await materials.approveMaterial(ctx, currentUser(req).uid, parse(docId, req.params.id)) })));
  api.get(
    "/materials/:id/pages",
    h(async (req) => {
      const q = parse(z.object({ from: z.coerce.number().int().min(1).default(1), to: z.coerce.number().int().min(1).default(20) }), req.query);
      return { pages: await materials.getPages(ctx, currentUser(req).uid, parse(docId, req.params.id), q.from, Math.min(q.to, q.from + 99)) };
    }),
  );
  api.patch(
    "/materials/:id/pages/:page",
    h(async (req) => {
      const page = parse(z.coerce.number().int().min(1).max(5000), req.params.page);
      const body = parse(z.object({ text: z.string().max(100_000) }).strict(), req.body);
      return { page: await materials.updatePageText(ctx, currentUser(req).uid, parse(docId, req.params.id), page, body.text) };
    }),
  );

  // ---------- Flashcards ----------
  api.get(
    "/flashcards",
    h(async (req) => {
      const q = parse(z.object({ materialId: docId.optional(), due: z.enum(["1", "0"]).optional() }), req.query);
      return { flashcards: await flashcards.listFlashcards(ctx, currentUser(req).uid, { materialId: q.materialId, dueOnly: q.due === "1" }) };
    }),
  );
  api.post(
    "/flashcards/generate",
    aiLimit,
    h(async (req) => {
      const body = parse(z.object({ materialIds, count: z.number().int().min(1).max(40), focus: shortText(200).optional() }).strict(), req.body);
      return flashcards.generateFlashcards(ctx, currentUser(req).uid, body);
    }),
  );
  api.post(
    "/flashcards/:id/review",
    h(async (req) => {
      const body = parse(z.object({ result: z.enum(["known", "review"]), clientReviewId: uuidLike }).strict(), req.body);
      return { flashcard: await flashcards.reviewFlashcard(ctx, currentUser(req).uid, parse(docId, req.params.id), body.result, body.clientReviewId) };
    }),
  );
  api.delete(
    "/flashcards/:id",
    h(async (req) => {
      await flashcards.deleteFlashcard(ctx, currentUser(req).uid, parse(docId, req.params.id));
      return { ok: true };
    }),
  );

  // ---------- Questões e simulados ----------
  api.get("/quizzes", h(async (req) => ({ quizzes: await quizzes.listQuizzes(ctx, currentUser(req).uid) })));
  api.post(
    "/quizzes",
    aiLimit,
    h(async (req) => {
      const body = parse(
        z.object({ mode: z.enum(["practice", "exam"]), materialIds, count: z.number().int().min(1).max(30), difficulty: z.enum(["facil", "media", "dificil", "mista"]), focus: shortText(200).optional() }).strict(),
        req.body,
      );
      return quizzes.createQuiz(ctx, currentUser(req).uid, body);
    }),
  );
  api.get("/quizzes/:id", h(async (req) => ({ quiz: await quizzes.getQuiz(ctx, currentUser(req).uid, parse(docId, req.params.id)) })));
  api.post(
    "/quizzes/:id/answers",
    h(async (req) => {
      const body = parse(z.object({ questionId: uuidLike, selectedIndex: z.number().int().min(0).max(3) }).strict(), req.body);
      return quizzes.answerQuestion(ctx, currentUser(req).uid, parse(docId, req.params.id), body.questionId, body.selectedIndex);
    }),
  );
  api.post("/quizzes/:id/finish", h(async (req) => ({ quiz: await quizzes.finishQuiz(ctx, currentUser(req).uid, parse(docId, req.params.id)) })));
  api.delete(
    "/quizzes/:id",
    h(async (req) => {
      await quizzes.deleteQuiz(ctx, currentUser(req).uid, parse(docId, req.params.id));
      return { ok: true };
    }),
  );

  // ---------- Tutor ----------
  api.get("/conversations", h(async (req) => ({ conversations: await tutor.listConversations(ctx, currentUser(req).uid) })));
  api.post(
    "/conversations",
    h(async (req) => {
      const body = parse(z.object({ materialIds, title: shortText(120).optional() }).strict(), req.body);
      return { conversation: await tutor.createConversation(ctx, currentUser(req).uid, body.materialIds, body.title) };
    }),
  );
  api.get("/conversations/:id", h(async (req) => ({ conversation: await tutor.getConversation(ctx, currentUser(req).uid, parse(docId, req.params.id)) })));
  api.delete(
    "/conversations/:id",
    h(async (req) => {
      await tutor.deleteConversation(ctx, currentUser(req).uid, parse(docId, req.params.id));
      return { ok: true };
    }),
  );
  api.post(
    "/conversations/:id/messages",
    aiLimit,
    h(async (req) => {
      const body = parse(z.object({ text: shortText(2000).min(2) }).strict(), req.body);
      return tutor.ask(ctx, currentUser(req).uid, parse(docId, req.params.id), body.text);
    }),
  );

  // ---------- Desempenho ----------
  api.get("/stats", h(async (req) => ({ stats: await users.getStats(ctx, currentUser(req).uid) })));

  app.use("/api", api);
  app.use("/api", (_req, _res, next) => next(new AppError(404, "not_found", "Rota não encontrada.")));

  // Tratamento central de erros: mensagens seguras, sem stack trace nem dados internos.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const e = err as { type?: string; status?: number; name?: string };
    if (e.type === "entity.too.large") {
      res.status(413).json({ error: { code: "payload_too_large", message: "A requisição é grande demais." } });
      return;
    }
    if (e.type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "invalid_json", message: "JSON inválido." } });
      return;
    }
    log.error("unhandled_error", { path: req.path, method: req.method, name: e.name });
    res.status(500).json({ error: { code: "internal", message: "Erro interno. Tente novamente." } });
  });

  return app;
}
