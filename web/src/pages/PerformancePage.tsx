import { Link } from "react-router-dom";
import { Sparkline } from "../components/Sparkline";
import { Delta, StatCard } from "../components/StatCard";
import { Empty, ErrorState, Loading } from "../components/States";
import { useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { formatDateTime, percent } from "../lib/format";
import { accuracyTrend, trendDelta } from "../lib/trend";

export function PerformancePage() {
  const { data, error, loading, reload } = useApi(() => api.stats().then((r) => r.stats));
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? "Erro"} onRetry={() => void reload()} />;
  const trend = accuracyTrend(data.recentQuizzes);

  return (
    <section className="stack">
      <div className="grid stats">
        <StatCard icon="check" label="Questões respondidas" value={data.answered} />
        <StatCard icon="chart" label="Taxa de acerto" value={percent(data.correct, data.answered)} extra={<Delta value={trendDelta(trend)} />} />
        <StatCard icon="timer" label="Simulados finalizados" value={data.quizzesFinished} />
        <StatCard icon="cards" label="Flashcards para revisar" value={data.flashcardsDue} />
      </div>
      <div className="panel hud stack">
        <div className="panel-head">
          <div>
            <div className="kicker">Evolução</div>
            <h2>Aproveitamento por tentativa</h2>
            <div className="muted small">Percentual de acertos das últimas tentativas finalizadas</div>
          </div>
          {trend.length > 0 && <span className="delta flat">Última: {trend[trend.length - 1]}%</span>}
        </div>
        {trend.length < 2 ? (
          <p className="muted small">Finalize ao menos duas tentativas para ver a evolução.</p>
        ) : (
          <div className="chart-wrap">
            <Sparkline values={trend} max={100} height={150} width={600} label={`Aproveitamento nas últimas ${trend.length} tentativas: ${trend.join("%, ")}%`} />
          </div>
        )}
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
