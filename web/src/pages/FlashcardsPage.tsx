import { useMemo, useState } from "react";
import type { Flashcard } from "@estudos/shared";
import { useAuth } from "../auth/AuthProvider";
import { MaterialPicker } from "../components/MaterialPicker";
import { SourceRefView } from "../components/SourceRef";
import { Empty, ErrorState, Loading } from "../components/States";
import { useToast } from "../components/Toast";
import { useAction, useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { uuid } from "../lib/format";

interface Session {
  queue: Flashcard[];
  index: number;
  flipped: boolean;
  /** id de revisão do cartão exibido: reenvios do mesmo clique não contam duas vezes. */
  reviewId: string;
  known: number;
  missed: Flashcard[];
}

function startSession(cards: Flashcard[]): Session {
  return { queue: cards, index: 0, flipped: false, reviewId: uuid(), known: 0, missed: [] };
}

export function FlashcardsPage() {
  const { me } = useAuth();
  const toast = useToast();
  const { busy, run } = useAction();
  const data = useApi(async () => {
    const [m, c] = await Promise.all([api.materials(), api.flashcards()]);
    return { materials: m.materials, cards: c.flashcards };
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [count, setCount] = useState(10);
  const [focus, setFocus] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [filter, setFilter] = useState<string>("");

  const cards = useMemo(() => (data.data?.cards ?? []).filter((c) => !filter || c.materialId === filter), [data.data, filter]);
  const now = new Date().toISOString();
  const due = cards.filter((c) => c.dueAt <= now);
  const hard = cards.filter((c) => c.box <= 1 && c.lastResult === "review");

  const generate = () =>
    run(async () => {
      try {
        const r = await api.generateFlashcards({ materialIds: selected, count, focus: focus.trim() || undefined });
        await data.reload();
        toast(`${r.cards.length} cartão(ões) criados${r.cards.length < r.requested ? ` (de ${r.requested} solicitados; os demais não passaram na validação)` : ""}.`);
        setSession(startSession(r.cards));
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

  const answer = (result: "known" | "review") => {
    if (!session) return;
    const card = session.queue[session.index];
    if (!card) return;
    void run(async () => {
      try {
        const { flashcard } = await api.reviewFlashcard(card.id, result, session.reviewId);
        data.setData((prev) => (prev ? { ...prev, cards: prev.cards.map((c) => (c.id === flashcard.id ? flashcard : c)) } : prev));
        setSession({
          ...session,
          index: session.index + 1,
          flipped: false,
          reviewId: uuid(),
          known: session.known + (result === "known" ? 1 : 0),
          missed: result === "review" ? [...session.missed, flashcard] : session.missed,
        });
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });
  };

  const remove = (c: Flashcard) => {
    if (!confirm("Excluir este cartão?")) return;
    void run(async () => {
      await api.deleteFlashcard(c.id);
      data.setData((prev) => (prev ? { ...prev, cards: prev.cards.filter((x) => x.id !== c.id) } : prev));
    });
  };

  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <ErrorState message={data.error ?? "Erro"} onRetry={() => void data.reload()} />;
  const current = session?.queue[session.index];

  return (
    <section className="stack">
      <div className="section-title">
        <div>
          <h2>Flashcards</h2>
          <p>Cartões gerados a partir dos seus materiais, com revisão espaçada que prioriza o que você ainda não domina.</p>
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => setSession(startSession(due))} disabled={!due.length}>Revisar pendentes ({due.length})</button>
          <button className="btn" onClick={() => setSession(startSession(hard))} disabled={!hard.length}>Só os difíceis ({hard.length})</button>
        </div>
      </div>

      {session && (
        <div className="panel stack" aria-live="polite">
          {current ? (
            <>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="muted small">Cartão {session.index + 1} de {session.queue.length} · {current.subjectName}{current.topic ? ` · ${current.topic}` : ""}</span>
                <button className="btn ghost sm" onClick={() => setSession(null)}>Encerrar sessão</button>
              </div>
              <button className="flashcard" onClick={() => setSession({ ...session, flipped: !session.flipped })} aria-label={session.flipped ? "Mostrar pergunta" : "Mostrar resposta"}>
                <div>
                  <small>{session.flipped ? "RESPOSTA" : "PERGUNTA · CLIQUE PARA VIRAR"}</small>
                  {session.flipped ? <span className="back-text">{current.back}</span> : current.front}
                </div>
              </button>
              {session.flipped && (
                <>
                  {current.source && <SourceRefView source={current.source} />}
                  <div className="row">
                    <button className="btn primary" onClick={() => answer("known")} disabled={busy}>Sei</button>
                    <button className="btn" onClick={() => answer("review")} disabled={busy}>Revisar</button>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <h2>Sessão concluída</h2>
              <p className="muted">{session.known} cartão(ões) marcados como conhecidos · {session.missed.length} para revisar.</p>
              {session.missed.length > 0 ? (
                <>
                  <h3>Cartões que você marcou para revisar</h3>
                  {session.missed.map((c, i) => (
                    <div className="subject" key={c.id}>
                      <div className="dot warn" />
                      <div className="subject-info"><strong>{i + 1}. {c.front}</strong><small>{c.back}</small></div>
                    </div>
                  ))}
                  <div className="row">
                    <button className="btn primary" onClick={() => setSession(startSession(session.missed))}>Revisar estes cartões agora</button>
                    <button className="btn" onClick={() => setSession(null)}>Fechar</button>
                  </div>
                </>
              ) : (
                <div className="row"><button className="btn" onClick={() => setSession(null)}>Fechar</button></div>
              )}
            </>
          )}
        </div>
      )}

      <div className="grid two-col">
        <div className="panel stack">
          <h2>Gerar novos cartões</h2>
          <MaterialPicker materials={data.data.materials} selected={selected} onChange={setSelected} max={me?.limits.maxMaterialsPerRequest ?? 5} />
          <div className="form-grid">
            <div className="field">
              <label htmlFor="fc-count">Quantidade</label>
              <select id="fc-count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[5, 10, 15, 20].filter((n) => n <= (me?.limits.maxFlashcardsPerRequest ?? 20)).map((n) => <option key={n} value={n}>{n} cartões</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="fc-focus">Foco (opcional)</label>
              <input id="fc-focus" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Ex.: amelogênese" maxLength={200} />
            </div>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => void generate()} disabled={busy || !selected.length || !me?.aiAvailable}>
              {busy ? "Gerando…" : "Criar cartões com IA"}
            </button>
            {!me?.aiAvailable && <span className="small muted">IA indisponível no servidor.</span>}
          </div>
          <p className="footer-note">Apenas trechos relevantes dos materiais selecionados são enviados à IA. Cada cartão traz a página de origem para conferência.</p>
        </div>

        <div className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <h2>Seus cartões ({cards.length})</h2>
            <select className="inline" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar por material">
              <option value="">Todos os materiais</option>
              {data.data.materials.filter((m) => m.status === "ready").map((m) => <option key={m.id} value={m.id}>{m.fileName}</option>)}
            </select>
          </div>
          {!cards.length ? (
            <Empty title="Nenhum baralho criado">Selecione materiais e use “Criar cartões com IA”.</Empty>
          ) : (
            <div className="stack" style={{ maxHeight: 520, overflow: "auto" }}>
              {cards.map((c) => (
                <div className="subject" key={c.id}>
                  <div className={`dot ${c.box <= 1 && c.lastResult === "review" ? "bad" : c.box >= 4 ? "good" : ""}`} />
                  <div className="subject-info">
                    <strong>{c.front}</strong>
                    <small>Nível {c.box}/5 · {c.knownCount} acerto(s) · {c.reviewCount} revisão(ões){c.source ? ` · ${c.source.fileName} p. ${c.source.page}` : ""}</small>
                  </div>
                  <div className="actions">
                    <button className="btn sm" onClick={() => setSession(startSession([c]))}>Estudar</button>
                    <button className="btn danger sm" onClick={() => remove(c)} disabled={busy} aria-label="Excluir cartão">×</button>
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
