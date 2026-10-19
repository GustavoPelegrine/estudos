import type { Firestore } from "firebase-admin/firestore";
import { materialStoragePath, PDF_CONTENT_TYPE, type Material, type MaterialPage, type Subject } from "@estudos/shared";
import type { Config } from "../config.js";
import type { FirebaseServices } from "../firebase.js";
import { AppError, badRequest, conflict, notFound } from "../http/errors.js";
import { log } from "../lib/log.js";
import { nowIso, pageDocId, userPaths } from "../lib/paths.js";
import { extractPdf, PdfExtractionError } from "../pdf/extract.js";
import { chunkMaterial, type Chunk } from "../rag/chunker.js";

type Bucket = FirebaseServices["bucket"];

export interface MaterialDeps {
  db: Firestore;
  bucket: Bucket;
  config: Config;
}

const STALE_PROCESSING_MS = 5 * 60_000;

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 140);
  return cleaned || "documento.pdf";
}

async function getSubject(deps: MaterialDeps, uid: string, subjectId: string): Promise<Subject> {
  const snap = await userPaths(deps.db, uid).subjects.doc(subjectId).get();
  if (!snap.exists) throw badRequest("Disciplina não encontrada. Cadastre a disciplina antes de enviar o material.");
  return { id: snap.id, ...(snap.data() as Omit<Subject, "id">) };
}

async function assertQuota(deps: MaterialDeps, uid: string): Promise<void> {
  const count = (await userPaths(deps.db, uid).materials.count().get()).data().count;
  if (count >= deps.config.MAX_MATERIALS_PER_USER) {
    throw new AppError(409, "materials_limit", `Limite de ${deps.config.MAX_MATERIALS_PER_USER} materiais atingido. Exclua materiais antigos para enviar novos.`);
  }
}

/** Reserva um "slot" para o upload. As regras do Storage só aceitam o PDF se o slot existir e estiver aguardando. */
export async function createPdfMaterial(deps: MaterialDeps, uid: string, input: { subjectId: string; topic?: string; fileName: string; sizeBytes: number }) {
  if (input.sizeBytes > deps.config.maxPdfBytes) throw badRequest(`O PDF ultrapassa o limite de ${deps.config.MAX_PDF_MB} MB.`, "file_too_large");
  if (!/\.pdf$/iu.test(input.fileName)) throw badRequest("Envie um arquivo com extensão .pdf.");
  await assertQuota(deps, uid);
  const subject = await getSubject(deps, uid, input.subjectId);
  const ref = userPaths(deps.db, uid).materials.doc();
  const now = nowIso();
  const material: Material = {
    id: ref.id,
    ownerUid: uid,
    kind: "pdf",
    subjectId: subject.id,
    subjectName: subject.name,
    semester: subject.semester,
    topic: (input.topic ?? "").trim().slice(0, 140),
    fileName: sanitizeFileName(input.fileName),
    sizeBytes: input.sizeBytes,
    uploadedAt: now,
    updatedAt: now,
    status: "awaiting_upload",
    pageCount: 0,
    extraction: null,
    errorMessage: null,
    studied: false,
  };
  const { id: _id, ...data } = material;
  await ref.set({ ...data, storagePath: materialStoragePath(uid, ref.id), maxBytes: deps.config.maxPdfBytes });
  return { material, uploadPath: materialStoragePath(uid, ref.id) };
}

/** Material de texto colado (anotações), preservando a funcionalidade da versão original. */
export async function createNotesMaterial(deps: MaterialDeps, uid: string, input: { subjectId: string; topic?: string; title: string; text: string }) {
  await assertQuota(deps, uid);
  const subject = await getSubject(deps, uid, input.subjectId);
  const text = input.text.replace(/\r\n?/gu, "\n").trim();
  if (text.length < 20) throw badRequest("O texto é muito curto.");
  if (text.length > deps.config.MAX_NOTES_CHARS) throw badRequest(`O texto excede ${deps.config.MAX_NOTES_CHARS.toLocaleString("pt-BR")} caracteres.`);
  const sections = splitNotes(text);
  const ref = userPaths(deps.db, uid).materials.doc();
  const now = nowIso();
  const material: Material = {
    id: ref.id,
    ownerUid: uid,
    kind: "notes",
    subjectId: subject.id,
    subjectName: subject.name,
    semester: subject.semester,
    topic: (input.topic ?? "").trim().slice(0, 140),
    fileName: sanitizeFileName(input.title),
    sizeBytes: Buffer.byteLength(text),
    uploadedAt: now,
    updatedAt: now,
    status: "ready",
    pageCount: sections.length,
    extraction: {
      pageCount: sections.length,
      pagesWithText: sections.length,
      pagesWithoutText: [],
      multiColumnPages: [],
      charCount: text.length,
      warnings: [],
      ocrRequired: false,
      extractorVersion: "notes-v1",
    },
    errorMessage: null,
    studied: false,
  };
  const { id: _id, ...data } = material;
  const batch = deps.db.batch();
  batch.set(ref, data);
  sections.forEach((s, i) => {
    const page: MaterialPage = { page: i + 1, text: s, charCount: s.length, hasText: true, layout: "single", editedByUser: false };
    batch.set(userPaths(deps.db, uid).pages(ref.id).doc(pageDocId(i + 1)), page);
  });
  await batch.commit();
  return material;
}

/** Divide anotações longas em seções (~3.000 caracteres) nos limites de parágrafo. */
export function splitNotes(text: string, target = 3000): string[] {
  // Converte marcadores do backup antigo "[Página N]" em quebras naturais.
  const paragraphs = text.replace(/\[Página \d+\]/gu, "\n\n").split(/\n{2,}/u).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of paragraphs) {
    if (cur && cur.length + p.length > target) {
      out.push(cur);
      cur = "";
    }
    cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out.length ? out : [text];
}

export async function listMaterials(deps: MaterialDeps, uid: string): Promise<Material[]> {
  const snap = await userPaths(deps.db, uid).materials.orderBy("uploadedAt", "desc").limit(500).get();
  return snap.docs.map((d) => toMaterial(d.id, d.data()));
}

export async function getMaterial(deps: MaterialDeps, uid: string, id: string): Promise<Material> {
  const snap = await userPaths(deps.db, uid).materials.doc(id).get();
  if (!snap.exists) throw notFound("Material");
  return toMaterial(snap.id, snap.data() as Record<string, unknown>);
}

function toMaterial(id: string, data: Record<string, unknown>): Material {
  const { storagePath: _sp, maxBytes: _mb, processingStartedAt: _ps, ...rest } = data;
  return { id, ...(rest as Omit<Material, "id">) };
}

export async function getPages(deps: MaterialDeps, uid: string, id: string, from = 1, to = 9999): Promise<MaterialPage[]> {
  await getMaterial(deps, uid, id);
  const snap = await userPaths(deps.db, uid)
    .pages(id)
    .where("page", ">=", from)
    .where("page", "<=", to)
    .orderBy("page")
    .limit(100)
    .get();
  return snap.docs.map((d) => d.data() as MaterialPage);
}

export async function updatePageText(deps: MaterialDeps, uid: string, id: string, page: number, text: string): Promise<MaterialPage> {
  const material = await getMaterial(deps, uid, id);
  if (!["needs_review", "ready", "needs_ocr"].includes(material.status)) throw conflict("O material ainda não foi processado.");
  const ref = userPaths(deps.db, uid).pages(id).doc(pageDocId(page));
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Página");
  const clean = text.replace(/\r\n?/gu, "\n").trim();
  const updated: MaterialPage = { page, text: clean, charCount: clean.length, hasText: clean.length > 0, layout: clean ? (snap.get("layout") === "empty" ? "single" : snap.get("layout")) : "empty", editedByUser: true };
  await ref.set(updated);
  await userPaths(deps.db, uid).materials.doc(id).update({ updatedAt: nowIso() });
  invalidateChunks(uid, id);
  return updated;
}

/** A estudante confere o texto e libera o material para uso pela IA. */
export async function approveMaterial(deps: MaterialDeps, uid: string, id: string): Promise<Material> {
  const material = await getMaterial(deps, uid, id);
  if (material.status === "ready") return material;
  if (material.status !== "needs_review" && material.status !== "needs_ocr") throw conflict("Este material ainda não pode ser aprovado.");
  const withText = await userPaths(deps.db, uid).pages(id).where("hasText", "==", true).count().get();
  if (withText.data().count === 0) throw conflict("Não há texto para aprovar. Este PDF exige OCR ou correção manual.", "no_text");
  await userPaths(deps.db, uid).materials.doc(id).update({ status: "ready", updatedAt: nowIso() });
  invalidateChunks(uid, id);
  return { ...material, status: "ready" };
}

export async function updateMaterialMeta(deps: MaterialDeps, uid: string, id: string, patch: { topic?: string; studied?: boolean; subjectId?: string }): Promise<Material> {
  const material = await getMaterial(deps, uid, id);
  const update: Record<string, unknown> = { updatedAt: nowIso() };
  if (patch.topic !== undefined) update.topic = patch.topic.trim().slice(0, 140);
  if (patch.studied !== undefined) update.studied = patch.studied;
  if (patch.subjectId !== undefined) {
    const subject = await getSubject(deps, uid, patch.subjectId);
    Object.assign(update, { subjectId: subject.id, subjectName: subject.name, semester: subject.semester });
  }
  await userPaths(deps.db, uid).materials.doc(id).update(update);
  invalidateChunks(uid, id);
  return { ...material, ...(update as Partial<Material>) };
}

/**
 * Processa o PDF já enviado ao Storage: valida, extrai o texto por página e grava as páginas.
 * Uso de transação para impedir processamento duplicado por cliques repetidos.
 */
export async function processMaterial(deps: MaterialDeps, uid: string, id: string): Promise<Material> {
  const ref = userPaths(deps.db, uid).materials.doc(id);
  await deps.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound("Material");
    const status = snap.get("status") as string;
    const started = Date.parse((snap.get("processingStartedAt") as string | undefined) ?? "") || 0;
    const stale = status === "processing" && Date.now() - started > STALE_PROCESSING_MS;
    if (snap.get("kind") !== "pdf") throw conflict("Somente PDFs podem ser processados.");
    if (status !== "awaiting_upload" && status !== "failed" && !stale) throw conflict("Este material já foi processado ou está em processamento.", "already_processed");
    tx.update(ref, { status: "processing", processingStartedAt: nowIso(), errorMessage: null });
  });

  const fail = async (message: string) => {
    await ref.update({ status: "failed", errorMessage: message, updatedAt: nowIso() });
    return getMaterial(deps, uid, id);
  };

  const file = deps.bucket.file(materialStoragePath(uid, id));
  let bytes: Buffer;
  try {
    const [exists] = await file.exists();
    if (!exists) return await fail("O arquivo não foi encontrado no armazenamento. Envie o PDF novamente.");
    const [meta] = await file.getMetadata();
    const size = Number(meta.size ?? 0);
    if (size > deps.config.maxPdfBytes) {
      await file.delete({ ignoreNotFound: true });
      return await fail(`O PDF ultrapassa o limite de ${deps.config.MAX_PDF_MB} MB.`);
    }
    if (meta.contentType !== PDF_CONTENT_TYPE) return await fail("O arquivo enviado não é um PDF.");
    [bytes] = await file.download();
  } catch (err) {
    log.error("material_download_failed", { materialId: id, name: (err as Error).name });
    return fail("Não foi possível ler o arquivo enviado. Tente novamente.");
  }

  try {
    const { pages, report } = await extractPdf(bytes, {
      maxPages: deps.config.MAX_PDF_PAGES,
      maxCharsPerPage: 100_000,
      timeoutMs: deps.config.PDF_PROCESS_TIMEOUT_MS,
    });
    await deletePages(deps, uid, id);
    const writer = deps.db.bulkWriter();
    for (const page of pages) void writer.set(userPaths(deps.db, uid).pages(id).doc(pageDocId(page.page)), page);
    await writer.close();
    await ref.update({
      status: report.ocrRequired ? "needs_ocr" : "needs_review",
      pageCount: report.pageCount,
      extraction: report,
      errorMessage: null,
      updatedAt: nowIso(),
    });
    invalidateChunks(uid, id);
    log.info("material_processed", { materialId: id, pages: report.pageCount, pagesWithText: report.pagesWithText, ocr: report.ocrRequired });
    return getMaterial(deps, uid, id);
  } catch (err) {
    if (err instanceof PdfExtractionError) return fail(err.message);
    log.error("material_extract_failed", { materialId: id, name: (err as Error).name });
    return fail("Falha inesperada ao ler o PDF.");
  }
}

async function deletePages(deps: MaterialDeps, uid: string, id: string): Promise<void> {
  await deps.db.recursiveDelete(userPaths(deps.db, uid).pages(id));
}

/**
 * Exclusão de material — política (docs/MODELO_DE_DADOS.md):
 * - remove o PDF do Storage, as páginas extraídas e os flashcards gerados a partir dele;
 * - mantém o histórico de simulados e respostas (dados de desempenho), cujas referências
 *   passam a ser exibidas como "material excluído";
 * - remove o id do material das conversas do tutor (as mensagens permanecem).
 */
export async function deleteMaterial(deps: MaterialDeps, uid: string, id: string): Promise<void> {
  await getMaterial(deps, uid, id);
  const paths = userPaths(deps.db, uid);
  await deps.bucket.file(materialStoragePath(uid, id)).delete({ ignoreNotFound: true });
  await deletePages(deps, uid, id);
  const cards = await paths.flashcards.where("materialId", "==", id).get();
  const writer = deps.db.bulkWriter();
  for (const d of cards.docs) void writer.delete(d.ref);
  const convs = await paths.conversations.where("materialIds", "array-contains", id).get();
  for (const c of convs.docs) {
    void writer.update(c.ref, { materialIds: (c.get("materialIds") as string[]).filter((m) => m !== id) });
  }
  void writer.delete(paths.materials.doc(id));
  await writer.close();
  invalidateChunks(uid, id);
}

export async function openPdfStream(deps: MaterialDeps, uid: string, id: string) {
  const material = await getMaterial(deps, uid, id);
  if (material.kind !== "pdf" || material.status === "awaiting_upload") throw notFound("Arquivo");
  const file = deps.bucket.file(materialStoragePath(uid, id));
  const [exists] = await file.exists();
  if (!exists) throw notFound("Arquivo");
  return { material, stream: file.createReadStream() };
}

// ---------- Trechos para busca (derivados das páginas, com cache em memória) ----------

const chunkCache = new Map<string, { updatedAt: string; chunks: Chunk[] }>();
const CACHE_LIMIT = 80;

function invalidateChunks(uid: string, id: string): void {
  chunkCache.delete(`${uid}/${id}`);
}

/** Carrega os trechos dos materiais selecionados (somente do próprio usuário e já aprovados). */
export async function loadChunks(deps: MaterialDeps, uid: string, materialIds: string[]): Promise<{ chunks: Chunk[]; materials: Material[] }> {
  const unique = [...new Set(materialIds)];
  if (!unique.length) throw badRequest("Selecione pelo menos um material.");
  if (unique.length > deps.config.MAX_MATERIALS_PER_REQUEST) throw badRequest(`Selecione no máximo ${deps.config.MAX_MATERIALS_PER_REQUEST} materiais por vez.`);
  const materials = await Promise.all(unique.map((id) => getMaterial(deps, uid, id)));
  const notReady = materials.filter((m) => m.status !== "ready");
  if (notReady.length) {
    throw conflict(`Confira e aprove o texto extraído antes de usar: ${notReady.map((m) => m.fileName).join(", ")}.`, "material_not_ready");
  }
  const chunks: Chunk[] = [];
  for (const m of materials) {
    const key = `${uid}/${m.id}`;
    const cached = chunkCache.get(key);
    if (cached && cached.updatedAt === m.updatedAt) {
      chunks.push(...cached.chunks);
      continue;
    }
    const snap = await userPaths(deps.db, uid).pages(m.id).orderBy("page").get();
    const pages = snap.docs.map((d) => d.data() as MaterialPage);
    const materialChunks = chunkMaterial({ materialId: m.id, fileName: m.fileName, subjectName: m.subjectName, topic: m.topic, pages });
    if (chunkCache.size >= CACHE_LIMIT) chunkCache.delete(chunkCache.keys().next().value as string);
    chunkCache.set(key, { updatedAt: m.updatedAt, chunks: materialChunks });
    chunks.push(...materialChunks);
  }
  if (!chunks.length) throw conflict("Os materiais selecionados não têm texto utilizável.", "no_text");
  return { chunks, materials };
}
