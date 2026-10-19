import type { ChatMessage, Conversation, SourceRef } from "@estudos/shared";
import type { AiService } from "../ai/service.js";
import { toSourceRef } from "../ai/validate.js";
import { notFound } from "../http/errors.js";
import { nowIso, userPaths } from "../lib/paths.js";
import { Bm25Index, queryCoverage } from "../rag/retriever.js";
import { getMaterial, loadChunks, type MaterialDeps } from "./materials.js";

const MAX_CONTEXT_CHUNKS = 8;

export async function createConversation(deps: MaterialDeps, uid: string, materialIds: string[], title?: string): Promise<Conversation> {
  // Valida que os materiais existem e pertencem ao usuário.
  await Promise.all(materialIds.map((id) => getMaterial(deps, uid, id)));
  const ref = userPaths(deps.db, uid).conversations.doc();
  const now = nowIso();
  const conv: Conversation = { id: ref.id, title: (title ?? "Nova conversa").slice(0, 120), materialIds, createdAt: now, updatedAt: now, messageCount: 0 };
  const { id: _id, ...data } = conv;
  await ref.set(data);
  return conv;
}

export async function listConversations(deps: MaterialDeps, uid: string): Promise<Conversation[]> {
  const snap = await userPaths(deps.db, uid).conversations.orderBy("updatedAt", "desc").limit(50).get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Conversation, "id">) }));
}

export async function getConversation(deps: MaterialDeps, uid: string, id: string): Promise<Conversation & { messages: ChatMessage[] }> {
  const paths = userPaths(deps.db, uid);
  const snap = await paths.conversations.doc(id).get();
  if (!snap.exists) throw notFound("Conversa");
  const msgs = await paths.messages(id).orderBy("createdAt").limit(200).get();
  return { id, ...(snap.data() as Omit<Conversation, "id">), messages: msgs.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, "id">) })) };
}

export async function deleteConversation(deps: MaterialDeps, uid: string, id: string): Promise<void> {
  const ref = userPaths(deps.db, uid).conversations.doc(id);
  if (!(await ref.get()).exists) throw notFound("Conversa");
  await deps.db.recursiveDelete(ref);
}

/**
 * Fluxo RAG do tutor:
 * 1) recupera os trechos mais relevantes (BM25) apenas dos materiais da conversa;
 * 2) sem evidência mínima, responde sem chamar a IA (economia e honestidade);
 * 3) com IA: envia somente os trechos recuperados e valida citações;
 * 4) sem IA configurada: devolve os trechos encontrados (modo busca, como na versão original).
 */
export async function ask(deps: MaterialDeps & { ai: AiService }, uid: string, conversationId: string, question: string): Promise<{ user: ChatMessage; assistant: ChatMessage }> {
  const paths = userPaths(deps.db, uid);
  const convRef = paths.conversations.doc(conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) throw notFound("Conversa");
  const conv = convSnap.data() as Omit<Conversation, "id">;
  const { chunks } = await loadChunks(deps, uid, conv.materialIds);

  const historySnap = await paths.messages(conversationId).orderBy("createdAt", "desc").limit(4).get();
  const history = historySnap.docs.reverse().map((d) => ({ role: d.get("role") as "user" | "assistant", text: d.get("text") as string }));

  const index = new Bm25Index(chunks);
  const hits = index.search(question, MAX_CONTEXT_CHUNKS);
  const retrieved = hits.map((h) => h.chunk);
  const coverage = queryCoverage(question, retrieved);

  let answer: { text: string; citations: SourceRef[]; grounded: boolean };
  if (!retrieved.length || coverage < 0.25) {
    answer = {
      text: "Não encontrei trechos nos materiais selecionados que tratem dessa pergunta. Para não inventar conteúdo, não vou responder com base em suposições.\n\nSugestões: reformule usando termos que aparecem no material, selecione outros materiais nesta conversa ou confira se o texto extraído do PDF está correto.",
      citations: [],
      grounded: false,
    };
  } else if (!deps.ai.available) {
    const top = retrieved.slice(0, 3);
    answer = {
      text: `A IA não está configurada; abaixo estão os trechos mais relevantes encontrados nos seus materiais:\n\n${top.map((c, i) => `[${i + 1}] ${c.text.replace(/\s+/gu, " ").slice(0, 600)}`).join("\n\n")}`,
      citations: top.map(toSourceRef),
      grounded: true,
    };
  } else {
    answer = await deps.ai.tutor(uid, retrieved, question, history);
  }

  const now = Date.now();
  const userMsg: Omit<ChatMessage, "id"> = { role: "user", text: question, citations: [], grounded: true, createdAt: new Date(now).toISOString() };
  const botMsg: Omit<ChatMessage, "id"> = { role: "assistant", text: answer.text, citations: answer.citations, grounded: answer.grounded, createdAt: new Date(now + 1).toISOString() };
  const userRef = paths.messages(conversationId).doc();
  const botRef = paths.messages(conversationId).doc();
  const batch = deps.db.batch();
  batch.set(userRef, userMsg);
  batch.set(botRef, botMsg);
  const update: Record<string, unknown> = { updatedAt: nowIso(), messageCount: (conv.messageCount ?? 0) + 2 };
  if ((conv.messageCount ?? 0) === 0) update.title = question.slice(0, 80);
  batch.update(convRef, update);
  await batch.commit();
  return { user: { id: userRef.id, ...userMsg }, assistant: { id: botRef.id, ...botMsg } };
}
