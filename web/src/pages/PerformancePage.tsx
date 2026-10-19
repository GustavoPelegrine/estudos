import { Link } from "react-router-dom";
import { Empty, ErrorState, Loading } from "../components/States";
import { useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { formatDateTime, percent } from "../lib/format";

export function PerformancePage() {
  const { data, error, loading, reload } = useApi(() => api.stats().then((r) => r.stats));
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? "Erro"} onRetry={() => void reload()} />;

  return (
    <section className="stack">
      <div className="grid stats">
        <div className="panel stat"><div className="stat-icon" aria-hidden="true">✓</div><div><div className="num">{data.answered}</div><div className="label">Questões respondidas</div></div></div>
        <div className="panel stat"><div className="stat-icon" aria-hidden="true">↗</div><div><div className="num">{percent(data.correct, data.answered)}</div><div className="label">Taxa de acerto</div></div></div>
        <div className="panel stat"><div className="stat-icon" aria-hidden="true">◷</div><div><div className="num">{data.quizzesFinished}</div><div className="label">Simulados finalizados</div></div></div>
        <div className="panel stat"><div className="stat-icon" aria-hidden="true">▧</div><div><div className="num">{data.flashcardsDue}</div><div className="label">Flashcards para revisar</div></div></div>
      </div>
      <div className="grid two-col">
        <div className="panel stack">
          <h2>Sugestões de revisão</h2>
          {data.suggestions.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.suggestions.map((s) => <li key={s} style={{ marginBottom: 8 }}>{s}</li>)}
            </ul>
          ) : (
            <p className="muted">Sem pendências no momento.</p>
          )}
          <h3>Assuntos com mais erros</h3>
          {!data.weakTopics.length ? (
            <p className="muted small">Ainda não há dados suficientes (são necessárias ao menos 2 respostas por assunto).</p>
          ) : (
            <div className="bar-list">
              {data.weakTopics.map((t) => (
                <div key={t.key} className="bar-item">
                  <div className="row"><strong>{t.topic}</strong><span className="small muted">{t.subjectName} · {t.correct}/{t.answered} ({percent(t.correct, t.answered)})</span></div>
                  <div className="progress"><span style={{ width: `${Math.round((t.correct / t.answered) * 100)}%` }} /></div>
                </div>
              ))}
            </div>
          )}
          <div className="row"><Link className="btn" to="/questoes">Praticar agora</Link><Link className="btn" to="/flashcards">Revisar flashcards</Link></div>
        </div>
        <div className="panel stack">
          <h2>Desempenho por assunto</h2>
          {!data.topics.length ? (
            <Empty title="Sem respostas registradas">Resolva questões para acompanhar seu desempenho por assunto.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Assunto</th><th className="hide-sm">Disciplina</th><th>Acertos</th></tr></thead>
              <tbody>
                {data.topics.map((t) => (
                  <tr key={t.key}><td>{t.topic}</td><td className="hide-sm">{t.subjectName}</td><td>{t.correct}/{t.answered} ({percent(t.correct, t.answered)})</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="panel stack">
        <h2>Tentativas recentes</h2>
        {!data.recentQuizzes.length ? (
          <p className="muted">Nenhuma tentativa registrada.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Data</th><th>Tipo</th><th className="hide-sm">Título</th><th>Resultado</th><th /></tr></thead>
            <tbody>
              {data.recentQuizzes.map((q) => (
                <tr key={q.id}>
                  <td>{formatDateTime(q.createdAt)}</td>
                  <td>{q.mode === "exam" ? "Simulado" : "Prática"}</td>
                  <td className="hide-sm" style={{ overflowWrap: "anywhere" }}>{q.title}</td>
                  <td>{q.correctCount}/{q.questionCount}</td>
                  <td><Link className="btn sm" to={`/quiz/${q.id}`}>Abrir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
