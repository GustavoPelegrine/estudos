import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Difficulty, PublicQuestion, Quiz, QuizMode, QuizWithQuestions } from "@estudos/shared";
import { useAuth } from "../auth/AuthProvider";
import { MaterialPicker } from "../components/MaterialPicker";
import { SourceRefView } from "../components/SourceRef";
import { Empty, ErrorState, Loading } from "../components/States";
import { useToast } from "../components/Toast";
import { useAction, useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { DIFFICULTY_LABEL, formatDateTime, percent, SKILL_LABEL } from "../lib/format";

const LETTERS = ["A", "B", "C", "D"];

function QuizHistory({ quizzes, mode }: { quizzes: Quiz[]; mode: QuizMode }) {
  const list = quizzes.filter((q) => q.mode === mode);
  if (!list.length) return <Empty title="Nenhuma tentativa ainda">Gere suas primeiras questões ao lado.</Empty>;
  return (
    <table className="table">
      <thead>
        <tr><th>Data</th><th>Material</th><th>Resultado</th><th className="hide-sm">Situação</th><th /></tr>
      </thead>
      <tbody>
        {list.map((q) => (
          <tr key={q.id}>
            <td>{formatDateTime(q.createdAt)}</td>
            <td style={{ overflowWrap: "anywhere" }}>{q.title.replace(/^(Simulado|Questões) — /u, "")}</td>
            <td>{q.correctCount}/{q.questionCount} ({percent(q.correctCount, q.answeredCount)})</td>
            <td className="hide-sm">{q.status === "finished" ? "Finalizado" : `${q.answeredCount}/${q.questionCount} respondidas`}</td>
            <td><Link className="btn sm" to={`/quiz/${q.id}`}>{q.status === "finished" || q.answeredCount === q.questionCount ? "Revisar" : "Continuar"}</Link></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuizSetupPage({ mode }: { mode: QuizMode }) {
  const { me, refreshMe } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const data = useApi(async () => {
    const [m, q] = await Promise.all([api.materials(), api.quizzes()]);
    return { materials: m.materials, quizzes: q.quizzes };
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [count, setCount] = useState(mode === "exam" ? 10 : me?.profile.preferences.defaultQuestionCount ?? 5);
  const [difficulty, setDifficulty] = useState<Difficulty | "mista">(mode === "exam" ? "mista" : "media");
  const [focus, setFocus] = useState("");
  const max = me?.limits.maxQuestionsPerQuiz ?? 20;

  const create = () =>
    run(async () => {
      try {
        const r = await api.createQuiz({ mode, materialIds: selected, count, difficulty, focus: focus.trim() || undefined });
        if (r.generated < r.requested) toast(`${r.generated} de ${r.requested} questões passaram na validação de qualidade.`);
        void refreshMe();
        navigate(`/quiz/${r.quiz.id}`);
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

  if (data.loading && !data.data) return <Loading />;
  if (data.error || !data.data) return <ErrorState message={data.error ?? "Erro"} onRetry={() => void data.reload()} />;

  return (
    <section className="stack">
      <div className="section-title">
        <div>
          <h2>{mode === "exam" ? "Simulados" : "Questões de revisão"}</h2>
          <p>
            {mode === "exam"
              ? "Faça uma prova completa e consulte o gabarito comentado ao finalizar."
              : "Pratique com correção imediata e explicação de cada alternativa."}
          </p>
        </div>
      </div>
      <div className="grid two-col">
        <div className="panel stack">
          <h2>{mode === "exam" ? "Novo simulado" : "Gerar questões"}</h2>
          <MaterialPicker materials={data.data.materials} selected={selected} onChange={setSelected} max={me?.limits.maxMaterialsPerRequest ?? 5} />
          <div className="form-grid">
            <div className="field">
              <label htmlFor="q-count">Número de questões</label>
              <select id="q-count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[3, 5, 10, 15, 20, 25, 30].filter((n) => n <= max).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="q-diff">Dificuldade</label>
              <select id="q-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty | "mista")}>
                {(["facil", "media", "dificil", "mista"] as const).map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
              </select>
            </div>
            <div className="field full">
              <label htmlFor="q-focus">Assunto em foco (opcional)</label>
              <input id="q-focus" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Ex.: ligamento periodontal" maxLength={200} />
            </div>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => void create()} disabled={busy || !selected.length || !me?.aiAvailable}>
              {busy ? "Elaborando questões…" : mode === "exam" ? "Iniciar simulado" : "Criar questões"}
            </button>
            {me && <span className="small muted">Uso de IA hoje: {me.usage.aiCalls}/{me.usage.aiDailyLimit}</span>}
          </div>
          {busy && <p className="small muted">A IA está elaborando e o servidor está validando cada questão. Isso pode levar até um minuto.</p>}
        </div>
        <div className="panel stack">
          <h2>Histórico</h2>
          <QuizHistory quizzes={data.data.quizzes} mode={mode} />
        </div>
      </div>
    </section>
  );
}

export const QuestionsPage = () => <QuizSetupPage mode="practice" />;
export const ExamPage = () => <QuizSetupPage mode="exam" />;

function QuestionMeta({ q }: { q: PublicQuestion }) {
  return (
    <div className="row">
      <span className="pill">{q.subjectName}</span>
      <span className="pill info">{q.topic}</span>
      <span className="pill">{DIFFICULTY_LABEL[q.difficulty] ?? q.difficulty}</span>
      <span className="pill">{SKILL_LABEL[q.skill] ?? q.skill}</span>
    </div>
  );
}

function ReviewQuestion({ q, index, selected }: { q: PublicQuestion; index: number; selected: number | undefined }) {
  return (
    <article className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 14 }}>
      <div className="muted small">Questão {index + 1} · {selected === undefined ? "não respondida" : selected === q.correctIndex ? "✓ acertou" : "✗ errou"}</div>
      <h3 style={{ margin: 0 }}>{q.stem}</h3>
      <QuestionMeta q={q} />
      <div>
        {q.options.map((opt, i) => (
          <div key={i} className={`choice ${i === q.correctIndex ? "correct" : i === selected ? "wrong" : ""}`}>
            {LETTERS[i]}) {opt}
            {i === selected && <strong> — sua resposta</strong>}
            {q.optionExplanations?.[i] ? <span className="why">{q.optionExplanations[i]}</span> : null}
          </div>
        ))}
      </div>
      {q.explanation && <div className="answer"><strong>Gabarito comentado: </strong>{q.explanation}</div>}
      {q.source && <SourceRefView source={q.source} />}
    </article>
  );
}

export function QuizRunnerPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const { busy, run } = useAction();
  const quizState = useApi(() => api.quiz(id).then((r) => r.quiz), [id]);
  const quiz = quizState.data;
  const answered = useMemo(() => new Map((quiz?.answers ?? []).map((a) => [a.questionId, a])), [quiz]);
  const firstOpen = quiz ? quiz.questions.findIndex((q) => !answered.has(q.id)) : 0;
  const [index, setIndex] = useState<number | null>(null);
  const [choice, setChoice] = useState<number | null>(null);

  if (quizState.loading && !quiz) return <Loading />;
  if (quizState.error || !quiz) return <ErrorState message={quizState.error ?? "Simulado não encontrado."} onRetry={() => void quizState.reload()} />;

  const finished = quiz.status === "finished";
  const allAnswered = quiz.answers.length === quiz.questions.length;
  const pos = index ?? (firstOpen === -1 ? quiz.questions.length - 1 : firstOpen);
  const q = quiz.questions[pos];

  const updateQuiz = (fn: (prev: QuizWithQuestions) => QuizWithQuestions) => quizState.setData((prev) => fn(prev as QuizWithQuestions));

  const submit = (selectedIndex: number) =>
    run(async () => {
      if (!q) return;
      // Fixa a questão atual: sem isso, a tela pularia para a próxima não respondida e esconderia o feedback.
      setIndex(pos);
      try {
        const r = await api.answer(quiz.id, q.id, selectedIndex);
        updateQuiz((prev) => ({
          ...prev,
          answers: prev.answers.some((a) => a.questionId === q.id) ? prev.answers : [...prev.answers, r.answer],
          answeredCount: prev.answers.some((a) => a.questionId === q.id) ? prev.answeredCount : prev.answeredCount + 1,
          correctCount: prev.correctCount + (!r.duplicate && r.answer.correct ? 1 : 0),
          questions: prev.questions.map((x) =>
            x.id === q.id && r.correctIndex !== undefined ? { ...x, correctIndex: r.correctIndex, explanation: r.explanation, optionExplanations: r.optionExplanations } : x,
          ),
        }));
        setChoice(null);
        if (quiz.mode === "exam" && pos < quiz.questions.length - 1) setIndex(pos + 1);
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

  const finish = () =>
    run(async () => {
      if (!allAnswered && !confirm("Ainda há questões sem resposta. Finalizar mesmo assim?")) return;
      try {
        const r = await api.finishQuiz(quiz.id);
        quizState.setData(r.quiz);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

  // Resultado final / gabarito comentado
  if (finished || (quiz.mode === "practice" && allAnswered && index === null)) {
    const wrongTopics = new Map<string, number>();
    for (const question of quiz.questions) {
      const a = answered.get(question.id);
      if (a && !a.correct) wrongTopics.set(question.topic, (wrongTopics.get(question.topic) ?? 0) + 1);
    }
    return (
      <section className="stack">
        <div className="section-title">
          <div>
            <p style={{ margin: 0 }}><Link to={quiz.mode === "exam" ? "/simulados" : "/questoes"}>← Voltar</Link></p>
            <h2>Resultado: {quiz.correctCount} de {quiz.questionCount}</h2>
            <p>{percent(quiz.correctCount, quiz.questionCount)} de acerto · {quiz.title}</p>
          </div>
          {!finished && <button className="btn primary" onClick={() => void finish()} disabled={busy}>Finalizar e salvar</button>}
        </div>
        <div className="panel stack">
          <h2>{wrongTopics.size ? "Principais pontos para revisar" : "Ótimo trabalho — você acertou todas!"}</h2>
          {wrongTopics.size > 0 && (
            <ul>
              {[...wrongTopics].sort((a, b) => b[1] - a[1]).map(([topic, n]) => <li key={topic}>{topic} — {n} erro(s)</li>)}
            </ul>
          )}
          <p className="small muted">Questões geradas por IA ({quiz.model}) a partir dos seus materiais e validadas pelo servidor. Confira as páginas citadas em caso de dúvida.</p>
        </div>
        <div className="panel stack">
          <h2>Gabarito comentado</h2>
          {quiz.questions.map((question, i) => <ReviewQuestion key={question.id} q={question} index={i} selected={answered.get(question.id)?.selectedIndex} />)}
        </div>
      </section>
    );
  }

  if (!q) return <Empty title="Simulado vazio" />;
  const answer = answered.get(q.id);
  const revealed = answer && q.correctIndex !== undefined;

  return (
    <section className="stack">
      <div className="section-title">
        <div>
          <p style={{ margin: 0 }}><Link to={quiz.mode === "exam" ? "/simulados" : "/questoes"}>← Voltar</Link></p>
          <h2>{quiz.mode === "exam" ? "Simulado em andamento" : "Questões"}</h2>
          <p>{quiz.answers.length} de {quiz.questions.length} respondidas</p>
        </div>
        {quiz.mode === "exam" && <button className="btn primary" onClick={() => void finish()} disabled={busy}>Finalizar simulado</button>}
      </div>
      <div className="progress" aria-hidden="true"><span style={{ width: `${(quiz.answers.length / quiz.questions.length) * 100}%` }} /></div>
      <div className="panel stack">
        <div className="muted small">Questão {pos + 1} de {quiz.questions.length}</div>
        <h3 style={{ margin: 0, fontSize: 17 }}>{q.stem}</h3>
        <QuestionMeta q={q} />
        <div role="group" aria-label="Alternativas">
          {q.options.map((opt, i) => {
            const cls = revealed
              ? i === q.correctIndex ? "correct" : i === answer.selectedIndex ? "wrong" : ""
              : (answer?.selectedIndex ?? choice) === i ? "selected" : "";
            return (
              <button
                key={i}
                className={`choice ${cls}`}
                disabled={Boolean(answer) || busy}
                aria-pressed={(answer?.selectedIndex ?? choice) === i}
                onClick={() => (quiz.mode === "practice" ? void submit(i) : setChoice(i))}
              >
                {LETTERS[i]}) {opt}
                {revealed && q.optionExplanations?.[i] ? <span className="why">{q.optionExplanations[i]}</span> : null}
              </button>
            );
          })}
        </div>
        {quiz.mode === "exam" && !answer && (
          <div><button className="btn primary" onClick={() => choice !== null && void submit(choice)} disabled={choice === null || busy}>Confirmar resposta</button></div>
        )}
        {quiz.mode === "exam" && answer && <div className="notice">Resposta registrada. O gabarito será exibido ao finalizar o simulado.</div>}
        {revealed && (
          <>
            <div className={`notice ${answer.correct ? "good" : "bad"}`}>{answer.correct ? "Resposta correta!" : `Resposta incorreta. A correta é a alternativa ${LETTERS[q.correctIndex as number]}.`}</div>
            {q.explanation && <div className="answer">{q.explanation}</div>}
            {q.source && <SourceRefView source={q.source} />}
          </>
        )}
        <div className="row">
          <button className="btn" onClick={() => { setIndex(Math.max(0, pos - 1)); setChoice(null); }} disabled={pos === 0}>← Anterior</button>
          {pos < quiz.questions.length - 1 ? (
            <button className={`btn ${answer ? "primary" : ""}`} onClick={() => { setIndex(pos + 1); setChoice(null); }}>Próxima →</button>
          ) : quiz.mode === "practice" && allAnswered ? (
            <button className="btn primary" onClick={() => void finish()} disabled={busy}>Ver resultado</button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
