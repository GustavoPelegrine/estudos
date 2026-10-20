import { Link } from "react-router-dom";
import { Icon } from "../components/Icons";
import { StatCard, Delta } from "../components/StatCard";
import { ErrorState, Loading, Empty } from "../components/States";
import { useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { percent } from "../lib/format";
import { accuracyTrend, trendDelta } from "../lib/trend";

export function DashboardPage() {
  const { data, error, loading, reload } = useApi(async () => {
    const [subjects, materials, stats] = await Promise.all([api.subjects(), api.materials(), api.stats()]);
    return { subjects: subjects.subjects, materials: materials.materials, stats: stats.stats };
  });

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? "Erro ao carregar."} onRetry={() => void reload()} />;
  const { subjects, materials, stats } = data;
  const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;
  const trend = accuracyTrend(stats.recentQuizzes);
  const studied = materials.filter((m) => m.studied).length;

  return (
    <section>
      <div className="grid stats">
        <StatCard icon="book" label="Matérias cadastradas" value={subjects.length} />
        <StatCard icon="files" label="Materiais adicionados" value={materials.length} extra={materials.length ? <span className="delta flat">{studied} estudado(s)</span> : null} />
        <StatCard icon="check" label="Questões respondidas" value={stats.answered} />
        <StatCard icon="chart" label="Taxa de acerto" value={percent(stats.correct, stats.answered)} extra={<Delta value={trendDelta(trend)} />} trend={trend} trendMax={100} />
      </div>
      <div className="grid dash-grid">
        <div className="panel hud">
          <div className="panel-head">
            <div>
              <div className="kicker">Estudo</div>
              <h2>Suas matérias</h2>
              <div className="muted small">Organize seus estudos por semestre</div>
            </div>
            <Link className="btn" to="/materiais">Gerenciar</Link>
          </div>
          {!subjects.length ? (
            <Empty title="Nenhuma matéria cadastrada">Adicione sua primeira matéria em “Meu material”.</Empty>
          ) : (
            <div className="subject-list">
              {subjects.slice(0, 8).map((s) => {
                const mats = materials.filter((m) => m.subjectId === s.id);
                const done = mats.filter((m) => m.studied).length;
                const pct = mats.length ? Math.round((done / mats.length) * 100) : 0;
                return (
                  <div className="subject" key={s.id}>
                    <div className="dot" />
                    <div className="subject-info">
                      <strong>{s.name}</strong>
                      <small>
                        {s.semester}º semestre · {mats.length} material(is) · {done} estudado(s)
                      </small>
                      <div className="progress" aria-label={`${pct}% estudado`}><span style={{ width: `${pct}%` }} /></div>
                    </div>
                    <Link className="btn" to={`/conteudo?disciplina=${s.id}`}>Abrir</Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="panel">
          <div className="panel-head">
            <div>
              <div className="kicker">Atalhos</div>
              <h2>Continuar estudando</h2>
              <div className="muted small">Acesse rapidamente suas ferramentas</div>
            </div>
          </div>
          <div className="quick">
            <Link to="/conteudo"><span className="glow-icon" aria-hidden="true"><Icon name="book" /></span><b>Conteúdo</b><span>Consulte seus materiais</span></Link>
            <Link to="/flashcards"><span className="glow-icon" aria-hidden="true"><Icon name="cards" /></span><b>Flashcards</b><span>{stats.flashcardsDue ? `${stats.flashcardsDue} para revisar` : "Revise conceitos"}</span></Link>
            <Link to="/questoes"><span className="glow-icon" aria-hidden="true"><Icon name="list" /></span><b>Questões</b><span>Pratique com o material</span></Link>
            <Link to="/tutor"><span className="glow-icon" aria-hidden="true"><Icon name="sparkle" /></span><b>Dúvidas</b><span>Pergunte ao tutor</span></Link>
          </div>
          <h3>Progresso geral</h3>
          <div className="progress"><span style={{ width: `${accuracy}%` }} /></div>
          <p className="muted small">
            {stats.answered ? `${stats.correct} acertos em ${stats.answered} respostas registradas.` : "Adicione uma matéria e comece a revisar."}
          </p>
          {stats.suggestions.length > 0 && (
            <>
              <h3>Sugestões de revisão</h3>
              <ul className="small" style={{ paddingLeft: 18, margin: 0, color: "var(--text-soft)" }}>
                {stats.suggestions.slice(0, 3).map((s) => (
                  <li key={s} style={{ marginBottom: 6 }}>{s}</li>
                ))}
              </ul>
              <Link className="small row" style={{ gap: 4, marginTop: 8 }} to="/desempenho">Ver desempenho completo <Icon name="arrowUpRight" size={14} /></Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
