import { Link } from "react-router-dom";
import { ErrorState, Loading, Empty } from "../components/States";
import { useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { percent } from "../lib/format";

export function DashboardPage() {
  const { data, error, loading, reload } = useApi(async () => {
    const [subjects, materials, stats] = await Promise.all([api.subjects(), api.materials(), api.stats()]);
    return { subjects: subjects.subjects, materials: materials.materials, stats: stats.stats };
  });

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? "Erro ao carregar."} onRetry={() => void reload()} />;
  const { subjects, materials, stats } = data;
  const accuracy = stats.answered ? Math.round((stats.correct / stats.answered) * 100) : 0;

  return (
    <section>
      <div className="grid stats">
        <div className="panel stat"><div className="stat-icon" aria-hidden="true">▤</div><div><div className="num">{subjects.length}</div><div className="label">Matérias cadastradas</div></div></div>
        <div className="panel stat"><div className="stat-icon" aria-hidden="true">◉</div><div><div className="num">{materials.length}</div><div className="label">Materiais adicionados</div></div></div>
        <div className="panel stat"><div className="stat-icon" aria-hidden="true">✓</div><div><div className="num">{stats.answered}</div><div className="label">Questões respondidas</div></div></div>
        <div className="panel stat"><div className="stat-icon" aria-hidden="true">↗</div><div><div className="num">{percent(stats.correct, stats.answered)}</div><div className="label">Taxa de acerto</div></div></div>
      </div>
      <div className="grid dash-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
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
                const studied = mats.filter((m) => m.studied).length;
                const pct = mats.length ? Math.round((studied / mats.length) * 100) : 0;
                return (
                  <div className="subject" key={s.id}>
                    <div className="dot" />
                    <div className="subject-info">
                      <strong>{s.name}</strong>
                      <small>
                        {s.semester}º semestre · {mats.length} material(is) · {studied} estudado(s)
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
              <h2>Continuar estudando</h2>
              <div className="muted small">Acesse rapidamente suas ferramentas</div>
            </div>
          </div>
          <div className="quick">
            <Link to="/conteudo"><span className="qico" aria-hidden="true">▣</span><b>Conteúdo</b><span>Consulte seus materiais</span></Link>
            <Link to="/flashcards"><span className="qico" aria-hidden="true">▧</span><b>Flashcards</b><span>{stats.flashcardsDue ? `${stats.flashcardsDue} para revisar` : "Revise conceitos"}</span></Link>
            <Link to="/questoes"><span className="qico" aria-hidden="true">☷</span><b>Questões</b><span>Pratique com o material</span></Link>
            <Link to="/tutor"><span className="qico" aria-hidden="true">✧</span><b>Dúvidas</b><span>Pergunte ao tutor</span></Link>
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
              <Link className="small" to="/desempenho">Ver desempenho completo</Link>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
