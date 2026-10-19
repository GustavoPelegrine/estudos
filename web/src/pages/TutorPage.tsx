import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@estudos/shared";
import { useAuth } from "../auth/AuthProvider";
import { MaterialPicker } from "../components/MaterialPicker";
import { SourceRefView } from "../components/SourceRef";
import { Empty, ErrorState, Loading } from "../components/States";
import { useToast } from "../components/Toast";
import { useAction, useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/format";

export function TutorPage() {
  const { me, refreshMe } = useAuth();
  const toast = useToast();
  const { busy, run } = useAction();
  const data = useApi(async () => {
    const [m, c] = await Promise.all([api.materials(), api.conversations()]);
    return { materials: m.materials, conversations: c.conversations };
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [loadingConv, setLoadingConv] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const active = data.data?.conversations.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    if (!activeId) return setMessages([]);
    setLoadingConv(true);
    api
      .conversation(activeId)
      .then((r) => setMessages(r.conversation.messages))
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setLoadingConv(false));
  }, [activeId, toast]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const newConversation = () =>
    run(async () => {
      try {
        const { conversation } = await api.createConversation(selected);
        data.setData((prev) => (prev ? { ...prev, conversations: [conversation, ...prev.conversations] } : prev));
        setActiveId(conversation.id);
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

  const ask = () =>
    run(async () => {
      const text = question.trim();
      if (!activeId || text.length < 2) return;
      const pending: ChatMessage = { id: "pendente", role: "user", text, citations: [], grounded: true, createdAt: new Date().toISOString() };
      setMessages((prev) => [...prev, pending]);
      setQuestion("");
      try {
        const r = await api.ask(activeId, text);
        setMessages((prev) => [...prev.filter((m) => m.id !== "pendente"), r.user, r.assistant]);
        void refreshMe();
        void data.reload();
      } catch (err) {
        setMessages((prev) => prev.filter((m) => m.id !== "pendente"));
        setQuestion(text);
        toast((err as Error).message, "error");
      }
    });

  const removeConversation = (id: string) => {
    if (!confirm("Excluir esta conversa?")) return;
    void run(async () => {
      await api.deleteConversation(id);
      if (activeId === id) setActiveId(null);
      await data.reload();
    });
  };

  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <ErrorState message={data.error ?? "Erro"} onRetry={() => void data.reload()} />;
  const materialNames = (ids: string[]) => ids.map((id) => data.data?.materials.find((m) => m.id === id)?.fileName ?? "material excluído").join(", ");

  return (
    <section className="stack">
      <div className="section-title">
        <div>
          <h2>Tutor de estudos</h2>
          <p>Pergunte sobre os seus materiais. O tutor responde com base nos trechos encontrados e cita a página de origem.</p>
        </div>
      </div>
      <div className="grid dash-grid">
        <div className="panel stack">
          {!active ? (
            <Empty title="Escolha ou crie uma conversa">Selecione os materiais ao lado e clique em “Nova conversa”.</Empty>
          ) : (
            <>
              <div className="panel-head" style={{ marginBottom: 0 }}>
                <div>
                  <h2>{active.title}</h2>
                  <p className="muted small" style={{ margin: "4px 0 0" }}>Materiais: {materialNames(active.materialIds) || "nenhum (todos foram excluídos)"}</p>
                </div>
              </div>
              <div className="chat-log" ref={logRef} aria-live="polite">
                {loadingConv ? (
                  <Loading />
                ) : !messages.length ? (
                  <Empty title="Faça uma pergunta sobre seus materiais">Ex.: “Qual a diferença entre esmalte e dentina?”</Empty>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`bubble ${m.role} ${m.role === "assistant" && !m.grounded ? "ungrounded" : ""}`}>
                      {m.text}
                      {m.citations.length > 0 && (
                        <div className="citations">
                          {m.citations.map((c, i) => <SourceRefView key={`${c.materialId}-${c.page}`} source={c} index={i + 1} />)}
                        </div>
                      )}
                    </div>
                  ))
                )}
                {busy && <div className="bubble assistant"><span className="spinner" aria-hidden="true" /> Consultando seus materiais…</div>}
              </div>
              <div className="chat-compose">
                <label className="sr-only" htmlFor="tutor-question">Sua pergunta</label>
                <textarea
                  id="tutor-question"
                  className="chat-input"
                  rows={2}
                  maxLength={2000}
                  value={question}
                  placeholder="Digite sua dúvida sobre o material…"
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                  disabled={!active.materialIds.length}
                />
                <button className="btn primary" onClick={() => void ask()} disabled={busy || question.trim().length < 2 || !active.materialIds.length}>Perguntar</button>
              </div>
              <p className="footer-note">
                Respostas sem evidência nos materiais são sinalizadas. Informações gerais fora do material aparecem separadas como “Complemento”. {me && `Uso de IA hoje: ${me.usage.aiCalls}/${me.usage.aiDailyLimit}.`}
              </p>
            </>
          )}
        </div>
        <div className="panel stack">
          <h2>Nova conversa</h2>
          <MaterialPicker materials={data.data.materials} selected={selected} onChange={setSelected} max={me?.limits.maxMaterialsPerRequest ?? 5} />
          <div><button className="btn primary" onClick={() => void newConversation()} disabled={busy || !selected.length}>Nova conversa</button></div>
          <h3>Conversas anteriores</h3>
          {!data.data.conversations.length ? (
            <p className="muted small">Nenhuma conversa ainda.</p>
          ) : (
            <div className="stack">
              {data.data.conversations.map((c) => (
                <div key={c.id} className="subject" style={c.id === activeId ? { borderColor: "var(--accent-line)" } : undefined}>
                  <div className="subject-info">
                    <strong>{c.title}</strong>
                    <small>{formatDateTime(c.updatedAt)} · {c.messageCount} mensagem(ns)</small>
                  </div>
                  <div className="actions">
                    <button className="btn sm" onClick={() => setActiveId(c.id)} aria-current={c.id === activeId}>Abrir</button>
                    <button className="btn danger sm" onClick={() => removeConversation(c.id)} aria-label="Excluir conversa">×</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
