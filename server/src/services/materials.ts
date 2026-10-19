import type { Firestore } from "firebase-admin/firestore";
import type { Material, MaterialPage, Subject } from "@estudos/shared";
import { summarizePages } from "@estudos/shared/pdf";
import type { Config } from "../config.js";
import { AppError, badRequest, conflict, notFound } from "../http/errors.js";
import { log } from "../lib/log.js";
import { nowIso, pageDocId, userPaths } from "../lib/paths.js";
import { chunkMaterial, type Chunk } from "../rag/chunker.js";

export interface MaterialDeps {
  db: Firestore;
  config: Config;
}

/** Material cujo envio de texto não foi concluído neste prazo é exibido como falha. */
const STALE_UPLOAD_MS = 15 * 60_000;
/** Avisos calculados no navegador que o servidor não consegue recalcular (ele só recebe o texto final). */
const CLIENT_ONLY_WARNING = /corrompido|truncadas|cabeçalho\/rodapé/u;

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

/**
 * Versão custo zero: o PDF é lido NO NAVEGADOR e nunca sai do aparelho da estudante.
 * 1) createPdfMaterial registra o material (status "processing" = recebendo texto);
 * 2) addPages recebe as páginas extraídas em lotes;
 * 3) finalizePdfMaterial confere se todas chegaram e recalcula o relatório no servidor.
 */
export async function createPdfMaterial(
  deps: MaterialDeps,
  uid: string,
  input: { subjectId: string; topic?: string; fileName: string; sizeBytes: number; pageCount: number; warnings: string[] },
): Promise<Material> {
  if (input.sizeBytes > deps.config.maxPdfBytes) throw badRequest(`O PDF ultrapassa o limite de ${deps.config.MAX_PDF_MB} MB.`, "file_too_large");
  if (!/\.pdf$/iu.test(input.fileName)) throw badRequest("Envie um arquivo com extensão .pdf.");
  if (input.pageCount > deps.config.MAX_PDF_PAGES) throw badRequest(`O PDF tem ${input.pageCount} páginas; o limite é ${deps.config.MAX_PDF_PAGES}.`, "too_many_pages");
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
    status: "processing",
    pageCount: input.pageCount,
    extraction: null,
    errorMessage: null,
    studied: false,
  };
  const { id: _id, ...data } = material;
  const clientWarnings = input.warnings.filter((w) => CLIENT_ONLY_WARNING.test(w)).map((w) => w.slice(0, 300)).slice(0, 10);
  await ref.set({ ...data, processingStartedAt: now, clientWarnings });
  return material;
}

export async function addPages(deps: MaterialDeps, uid: string, id: string, pages: Pick<MaterialPage, "page" | "text" | "hasText" | "layout">[]): Promise<{ received: number }> {
  const ref = userPaths(deps.db, uid).materials.doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Material");
  if (snap.get("kind") !== "pdf" || snap.get("status") !== "processing") throw conflict("Este material não está recebendo texto.", "not_receiving");
  const pageCount = snap.get("pageCount") as number;
  const writer = deps.db.bulkWriter();
  for (const p of pages) {
    if (p.page < 1 || p.page > pageCount) throw badRequest(`Página ${p.page} fora do intervalo do documento.`);
    const text = p.hasText ? p.text.replace(/\r\n?/gu, "\n").trim() : "";
    const hasText = text.length > 0;
    const page: MaterialPage = { page: p.page, text, charCount: text.length, hasText, layout: hasText ? (p.layout === "empty" ? "single" : p.layout) : "empty", editedByUser: false };
    void writer.set(userPaths(deps.db, uid).pages(id).doc(pageDocId(p.page)), page);
  }
  await writer.close();
  return { received: pages.length };
}

export async function finalizePdfMaterial(deps: MaterialDeps, uid: string, id: string): Promise<Material> {
  const ref = userPaths(deps.db, uid).materials.doc(id);
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Material");
  if (snap.get("status") !== "processing") return getMaterial(deps, uid, id);
  const pageCount = snap.get("pageCount") as number;
  const pagesSnap = await userPaths(deps.db, uid).pages(id).select("page", "hasText", "charCount", "layout").get();
  const pages = pagesSnap.docs.map((d) => d.data() as Pick<MaterialPage, "page" | "hasText" | "charCount" | "layout">).sort((a, b) => a.page - b.page);
  if (pages.length !== pageCount) {
    throw conflict(`Foram recebidas ${pages.length} de ${pageCount} páginas. Tente enviar novamente.`, "pages_missing");
  }
  const report = summarizePages(pages, { extraWarnings: (snap.get("clientWarnings") as string[] | undefined) ?? [] });
  await ref.update({ status: report.ocrRequired ? "needs_ocr" : "needs_review", extraction: report, errorMessage: null, updatedAt: nowIso() });
  invalidateChunks(uid, id);
  log.info("material_received", { materialId: id, pages: report.pageCount, pagesWithText: report.pagesWithText, ocr: report.ocrRequired });
  return getMaterial(deps, uid, id);
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
  const { processingStartedAt, clientWarnings: _cw, ...rest } = data;
  const material = { id, ...(rest as Omit<Material, "id">) };
  if (material.status === "processing" && Date.now() - (Date.parse(String(processingStartedAt ?? "")) || 0) > STALE_UPLOAD_MS) {
    return { ...material, status: "failed", errorMessage: "O envio do texto foi interrompido. Exclua este material e envie o PDF novamente." };
  }
  return material;
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

async function deletePages(deps: MaterialDeps, uid: string, id: string): Promise<void> {
  await deps.db.recursiveDelete(userPaths(deps.db, uid).pages(id));
}

/**
 * Exclusão de material — política (docs/MODELO_DE_DADOS.md):
 * - remove as páginas extraídas e os flashcards gerados a partir dele (o PDF original nunca sai do aparelho);
 * - mantém o histórico de simulados e respostas (dados de desempenho), cujas referências
 *   passam a ser exibidas como "material excluído";
 * - remove o id do material das conversas do tutor (as mensagens permanecem).
 */
export async function deleteMaterial(deps: MaterialDeps, uid: string, id: string): Promise<void> {
  await getMaterial(deps, uid, id);
  const paths = userPaths(deps.db, uid);
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
