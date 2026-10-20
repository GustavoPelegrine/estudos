import { useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Material, Subject } from "@estudos/shared";
import { useAuth } from "../auth/AuthProvider";
import { Empty, ErrorState, Loading } from "../components/States";
import { useToast } from "../components/Toast";
import { useAction, useApi } from "../hooks/useApi";
import { api, ApiError } from "../lib/api";
import { formatBytes, formatDate, STATUS_LABEL } from "../lib/format";
import { extractPdfInBrowser, rememberLocalPdf } from "../lib/pdf";
import { uploadExtractedPages } from "../lib/pdf-upload";

const SEMESTERS = Array.from({ length: 12 }, (_, i) => i + 1);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Erro inesperado.");

function SubjectsPanel({ subjects, onChange }: { subjects: Subject[]; onChange: () => Promise<void> }) {
  const { me } = useAuth();
  const toast = useToast();
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [semester, setSemester] = useState(me?.profile.preferences.defaultSemester ?? 1);

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      try {
        await api.createSubject(name.trim(), semester);
        setName("");
        await onChange();
        toast("Disciplina cadastrada.");
      } catch (err) {
        toast(errMsg(err), "error");
      }
    });
  };

  const remove = (s: Subject) => {
    if (!confirm(`Excluir a disciplina “${s.name}”?`)) return;
    void run(async () => {
      try {
        await api.deleteSubject(s.id);
        await onChange();
        toast("Disciplina excluída.");
      } catch (err) {
        toast(errMsg(err), "error");
      }
    });
  };

  return (
    <div className="panel stack">
      <h2>Disciplinas</h2>
      <form className="form-grid" onSubmit={add}>
        <div className="field">
          <label htmlFor="subject-name">Disciplina</label>
          <input id="subject-name" placeholder="Ex.: Anatomia Humana" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
        </div>
        <div className="field">
          <label htmlFor="subject-semester">Semestre</label>
          <select id="subject-semester" value={semester} onChange={(e) => setSemester(Number(e.target.value))}>
            {SEMESTERS.map((s) => <option key={s} value={s}>{s}º semestre</option>)}
          </select>
        </div>
        <div className="field full">
          <div><button className="btn primary" type="submit" disabled={busy || name.trim().length < 2}>Adicionar disciplina</button></div>
        </div>
      </form>
      {subjects.length > 0 && (
        <div className="row">
          {subjects.map((s) => (
            <span key={s.id} className="pill">
              {s.name} · {s.semester}º
              <button className="btn ghost sm" style={{ padding: "0 4px", border: 0 }} onClick={() => remove(s)} aria-label={`Excluir disciplina ${s.name}`} disabled={busy}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function UploadPanel({ subjects, onDone }: { subjects: Subject[]; onDone: () => Promise<void> }) {
  const { me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"pdf" | "notes">("pdf");
  const [subjectId, setSubjectId] = useState("");
  const [topic, setTopic] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { busy, run } = useAction();
  const maxBytes = me?.limits.maxPdfBytes ?? 20 * 1024 * 1024;
  const effectiveSubject = subjectId || subjects[0]?.id || "";

  const pickFile = (f: File | null) => {
    setError(null);
    if (!f) return setFile(null);
    if (f.type !== "application/pdf" && !/\.pdf$/i.test(f.name)) {
      setError("Selecione um arquivo PDF.");
      return setFile(null);
    }
    if (f.size > maxBytes) {
      setError(`O PDF tem ${formatBytes(f.size)}; o limite é ${formatBytes(maxBytes)}.`);
      return setFile(null);
    }
    setFile(f);
  };

  const sendPdf = () =>
    run(async () => {
      if (!file || !effectiveSubject) return;
      setError(null);
      let createdId: string | null = null;
      try {
        // 1) Leitura no próprio navegador: o arquivo não sai do aparelho.
        setStage("Lendo o PDF neste dispositivo…");
        const { pages, report } = await extractPdfInBrowser(file, {
          maxPages: me?.limits.maxPdfPages ?? 400,
          onProgress: (page, total) => {
            setStage(`Lendo a página ${page} de ${total} neste dispositivo…`);
            setProgress(page / total);
          },
        });
        // 2) Registro do material e envio apenas do texto, em lotes.
        setStage("Salvando o texto extraído…");
        setProgress(0);
        const { material } = await api.createPdfMaterial({
          subjectId: effectiveSubject,
          topic: topic.trim() || undefined,
          fileName: file.name,
          sizeBytes: file.size,
          pageCount: report.pageCount,
          warnings: report.warnings,
        });
        createdId = material.id;
        const saved = await uploadExtractedPages(material.id, pages, setProgress);
        createdId = null;
        rememberLocalPdf(saved.id, file);
        await onDone();
        setFile(null);
        setTopic("");
        if (fileRef.current) fileRef.current.value = "";
        toast(saved.status === "needs_ocr" ? "PDF sem texto extraível: confira os detalhes." : "Texto extraído. Confira antes de usar.");
        navigate(`/materiais/${saved.id}`);
      } catch (err) {
        setError(errMsg(err));
        // Remove o registro incompleto se o envio falhou no meio.
        if (createdId) await api.deleteMaterial(createdId).catch(() => undefined);
        await onDone();
      } finally {
        setStage(null);
        setProgress(0);
      }
    });

  const sendNotes = () =>
    run(async () => {
      setError(null);
      try {
        const { material } = await api.createNotes({ subjectId: effectiveSubject, topic: topic.trim() || undefined, title: title.trim(), text });
        setText("");
        setTitle("");
        await onDone();
        toast("Anotações salvas.");
        navigate(`/materiais/${material.id}`);
      } catch (err) {
        setError(errMsg(err));
      }
    });

  if (!subjects.length) {
    return (
      <div className="panel">
        <Empty title="Cadastre uma disciplina primeiro">Depois você poderá enviar PDFs e anotações vinculados a ela.</Empty>
      </div>
    );
  }

  return (
    <div className="panel stack">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "pdf"} className={tab === "pdf" ? "active" : ""} onClick={() => setTab("pdf")}>Enviar PDF</button>
        <button role="tab" aria-selected={tab === "notes"} className={tab === "notes" ? "active" : ""} onClick={() => setTab("notes")}>Colar anotações</button>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="mat-subject">Disciplina</label>
          <select id="mat-subject" value={effectiveSubject} onChange={(e) => setSubjectId(e.target.value)}>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.semester}º sem.</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="mat-topic">Tema (opcional)</label>
          <input id="mat-topic" placeholder="Ex.: ossos do crânio" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={140} />
        </div>
        {tab === "pdf" ? (
          <div className="field full">
            <label htmlFor="mat-file">Arquivo PDF</label>
            <input ref={fileRef} id="mat-file" type="file" accept="application/pdf,.pdf" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} disabled={busy} />
            <span className="hint">
              Até {formatBytes(maxBytes)}. O PDF é lido neste dispositivo e <strong>não é enviado</strong>: só o texto extraído é salvo na sua conta. PDFs digitalizados (imagem) são identificados e exigem OCR.
            </span>
          </div>
        ) : (
          <>
            <div className="field full">
              <label htmlFor="notes-title">Título</label>
              <input id="notes-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Resumo de esmalte dentário" maxLength={140} />
            </div>
            <div className="field full">
              <label htmlFor="notes-text">Cole seu resumo ou anotações</label>
              <textarea id="notes-text" rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Cole aqui o conteúdo das suas anotações." />
            </div>
          </>
        )}
      </div>
      {error && <div className="notice bad" role="alert">{error}</div>}
      {stage && (
        <div className="upload-progress" role="status">
          <span className="small muted"><span className="spinner" aria-hidden="true" /> {stage}</span>
          <div className="progress"><span style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        </div>
      )}
      <div className="row">
        {tab === "pdf" ? (
          <button className="btn primary" onClick={() => void sendPdf()} disabled={busy || !file}>Extrair e salvar texto</button>
        ) : (
          <button className="btn primary" onClick={() => void sendNotes()} disabled={busy || !title.trim() || text.trim().length < 20}>Salvar anotações</button>
        )}
      </div>
    </div>
  );
}

function MaterialRow({ m, onDelete, busy }: { m: Material; onDelete: (m: Material) => void; busy: boolean }) {
  const st = STATUS_LABEL[m.status];
  return (
    <div className="subject">
      <div className={`dot ${st.tone === "good" ? "good" : st.tone === "bad" ? "bad" : st.tone === "warn" ? "warn" : ""}`} />
      <div className="subject-info">
        <strong>{m.fileName}</strong>
        <small>
          {m.subjectName} · {m.semester}º semestre{m.topic ? ` · ${m.topic}` : ""} · {m.kind === "pdf" ? `${m.pageCount} pág. · ${formatBytes(m.sizeBytes)}` : `${m.pageCount} seção(ões)`} · {formatDate(m.uploadedAt)}
        </small>
        <div className="row" style={{ marginTop: 6 }}>
          <span className={`pill ${st.tone}`}>{st.text}</span>
          {m.studied && <span className="pill good">Estudado ✓</span>}
          {m.kind === "notes" && <span className="pill">Anotações</span>}
          {(m.version ?? 1) > 1 && <span className="pill info">versão {m.version}</span>}
          {m.updating && <span className="pill info">recebendo nova versão…</span>}
        </div>
      </div>
      <div className="actions">
        <Link className="btn" to={`/materiais/${m.id}`}>{m.status === "needs_review" ? "Conferir texto" : "Detalhes"}</Link>
        <button className="btn danger" onClick={() => onDelete(m)} disabled={busy} aria-label={`Excluir ${m.fileName}`}>Excluir</button>
      </div>
    </div>
  );
}

export function MaterialsPage() {
  const { me } = useAuth();
  const toast = useToast();
  const { busy, run } = useAction();
  const { data, error, loading, reload } = useApi(async () => {
    const [s, m] = await Promise.all([api.subjects(), api.materials()]);
    return { subjects: s.subjects, materials: m.materials };
  });

  const remove = (m: Material) => {
    if (!confirm(`Excluir “${m.fileName}”?\n\nO texto extraído e os flashcards gerados a partir dele serão apagados. O histórico de simulados é mantido.`)) return;
    void run(async () => {
      try {
        await api.deleteMaterial(m.id);
        await reload();
        toast("Material excluído.");
      } catch (err) {
        toast(err instanceof ApiError ? err.message : "Falha ao excluir.", "error");
      }
    });
  };

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorState message={error ?? "Erro"} onRetry={() => void reload()} />;
  const max = me?.limits.maxMaterials ?? 0;

  return (
    <section className="stack">
      <div className="section-title">
        <div>
          <h2>Meu material</h2>
          <p>Cadastre as disciplinas, extraia o texto dos seus PDFs (lidos no próprio aparelho) e confira antes de estudar.</p>
        </div>
      </div>
      <div className="grid two-col">
        <SubjectsPanel subjects={data.subjects} onChange={reload} />
        <UploadPanel subjects={data.subjects} onDone={reload} />
      </div>
      <div className="panel">
        <div className="panel-head">
          <div>
            <h2>Materiais salvos</h2>
            <p className="muted small">Visíveis apenas para você, em qualquer dispositivo.</p>
          </div>
          <span className="pill">{data.materials.length} de {max} materiais</span>
        </div>
        {!data.materials.length ? (
          <Empty title="Seu espaço está vazio">Cadastre uma disciplina e envie um PDF ou cole suas anotações.</Empty>
        ) : (
          <div className="stack">
            {data.materials.map((m) => <MaterialRow key={m.id} m={m} onDelete={remove} busy={busy} />)}
          </div>
        )}
      </div>
    </section>
  );
}
