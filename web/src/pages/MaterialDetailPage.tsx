import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { MaterialPage } from "@estudos/shared";
import { ErrorState, Loading } from "../components/States";
import { useToast } from "../components/Toast";
import { useAction, useApi } from "../hooks/useApi";
import { api, fetchBlob } from "../lib/api";
import { formatBytes, formatDateTime, STATUS_LABEL } from "../lib/format";
import { PageText } from "./ContentPage";

const PAGE_BATCH = 20;

export function MaterialDetailPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { busy, run } = useAction();
  const material = useApi(() => api.material(id).then((r) => r.material), [id]);
  const [pages, setPages] = useState<MaterialPage[]>([]);
  const [current, setCurrent] = useState(1);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const m = material.data;

  // Carrega as páginas em lotes conforme a navegação.
  useEffect(() => {
    if (!m || m.status === "awaiting_upload" || m.status === "processing" || m.status === "failed") return;
    if (pages.some((p) => p.page === current)) return;
    const from = Math.floor((current - 1) / PAGE_BATCH) * PAGE_BATCH + 1;
    api
      .pages(id, from, from + PAGE_BATCH - 1)
      .then((r) => setPages((prev) => [...prev.filter((p) => p.page < from || p.page >= from + PAGE_BATCH), ...r.pages].sort((a, b) => a.page - b.page)))
      .catch((err: Error) => toast(err.message, "error"));
  }, [m, current, id, pages, toast]);

  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  if (material.loading && !m) return <Loading />;
  if (material.error || !m) return <ErrorState message={material.error ?? "Material não encontrado."} onRetry={() => void material.reload()} />;

  const page = pages.find((p) => p.page === current);
  const st = STATUS_LABEL[m.status];
  const ext = m.extraction;
  const reviewable = m.status === "needs_review" || m.status === "needs_ocr";

  const openPdf = () =>
    run(async () => {
      try {
        const blob = await fetchBlob(`/materials/${m.id}/file`);
        setPdfUrl(URL.createObjectURL(blob));
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

  const savePage = () =>
    run(async () => {
      try {
        const { page: saved } = await api.updatePage(m.id, current, draft);
        setPages((prev) => prev.map((p) => (p.page === saved.page ? saved : p)));
        setEditing(false);
        toast("Página corrigida.");
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

  const approve = () =>
    run(async () => {
      try {
        const { material: updated } = await api.approveMaterial(m.id);
        material.setData(updated);
        toast("Material liberado para questões, flashcards e tutor.");
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

  const reprocess = () =>
    run(async () => {
      try {
        const { material: updated } = await api.processMaterial(m.id);
        material.setData(updated);
        setPages([]);
      } catch (err) {
        toast((err as Error).message, "error");
      }
    });

  const toggleStudied = () =>
    run(async () => {
      const { material: updated } = await api.updateMaterial(m.id, { studied: !m.studied });
      material.setData(updated);
    });

  const remove = () => {
    if (!confirm(`Excluir “${m.fileName}”? O PDF, o texto e os flashcards derivados serão apagados.`)) return;
    void run(async () => {
      await api.deleteMaterial(m.id);
      toast("Material excluído.");
      navigate("/materiais");
    });
  };

  return (
    <section className="stack">
      <div className="section-title">
        <div>
          <p style={{ margin: 0 }}><Link to="/materiais">← Meu material</Link></p>
          <h2 style={{ overflowWrap: "anywhere" }}>{m.fileName}</h2>
          <p>
            {m.subjectName} · {m.semester}º semestre{m.topic ? ` · ${m.topic}` : ""} · enviado em {formatDateTime(m.uploadedAt)}
            {m.kind === "pdf" ? ` · ${formatBytes(m.sizeBytes)}` : ""}
          </p>
        </div>
        <div className="row">
          <span className={`pill ${st.tone}`}>{st.text}</span>
          <button className="btn" onClick={() => void toggleStudied()} disabled={busy}>{m.studied ? "Estudado ✓" : "Marcar como estudado"}</button>
          <button className="btn danger" onClick={remove} disabled={busy}>Excluir</button>
        </div>
      </div>

      {m.status === "failed" && (
        <div className="notice bad stack" role="alert">
          <span>{m.errorMessage ?? "Falha ao processar o PDF."}</span>
          <div className="row">
            <button className="btn sm" onClick={() => void reprocess()} disabled={busy}>Tentar novamente</button>
            <span className="small">Se o problema persistir, exclua e envie o arquivo de novo.</span>
          </div>
        </div>
      )}
      {m.status === "awaiting_upload" && <div className="notice warn">O arquivo ainda não foi enviado. Exclua este registro e envie o PDF novamente.</div>}
      {m.status === "processing" && <div className="notice">Processando o PDF… <button className="btn sm" onClick={() => void material.reload()}>Atualizar</button></div>}

      {ext && (
        <div className="panel stack">
          <div className="panel-head" style={{ marginBottom: 0 }}>
            <div>
              <h2>Qualidade da extração</h2>
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                {ext.pageCount} página(s) · {ext.pagesWithText} com texto · {ext.charCount.toLocaleString("pt-BR")} caracteres
              </p>
            </div>
            {reviewable && (
              <button className="btn primary" onClick={() => void approve()} disabled={busy || ext.pagesWithText === 0}>
                Texto conferido — liberar para estudo
              </button>
            )}
          </div>
          {ext.ocrRequired && (
            <div className="notice bad">
              <strong>Este documento exige OCR.</strong> Ele parece ser digitalizado (imagem), e o texto não pode ser lido diretamente.
              Por enquanto, gere uma versão pesquisável do PDF (ex.: “Salvar como PDF com OCR” no Adobe Acrobat, Google Drive → “Abrir com Documentos Google” ou aplicativos de digitalização) e envie novamente.
              {ext.pagesWithText > 0 && " Você ainda pode liberar as páginas que têm texto."}
            </div>
          )}
          {ext.warnings.filter((w) => !/OCR/.test(w) || !ext.ocrRequired).length > 0 && (
            <div className="notice warn">
              <ul>
                {ext.warnings.filter((w) => !/OCR/.test(w) || !ext.ocrRequired).map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}
          {m.status === "needs_review" && (
            <div className="notice">
              Confira algumas páginas comparando com o PDF original. Corrija o que for necessário e libere o material — só depois disso ele será usado pela IA.
            </div>
          )}
          {m.status === "ready" && <div className="notice good">Material liberado: já pode ser usado em questões, flashcards e no tutor.</div>}
        </div>
      )}

      {m.pageCount > 0 && m.status !== "failed" && (
        <div className="grid two-col">
          <div className="panel stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>{m.kind === "pdf" ? `Página ${current}` : `Seção ${current}`} de {m.pageCount}</h2>
              <div className="row">
                <button className="btn sm" onClick={() => { setCurrent((c) => Math.max(1, c - 1)); setEditing(false); }} disabled={current <= 1}>← Anterior</button>
                <label className="sr-only" htmlFor="page-jump">Ir para página</label>
                <input id="page-jump" type="number" min={1} max={m.pageCount} value={current} onChange={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= m.pageCount) { setCurrent(v); setEditing(false); } }} style={{ width: 70 }} className="chat-input" />
                <button className="btn sm" onClick={() => { setCurrent((c) => Math.min(m.pageCount, c + 1)); setEditing(false); }} disabled={current >= m.pageCount}>Próxima →</button>
              </div>
            </div>
            {!page ? (
              <Loading label="Carregando página…" />
            ) : editing ? (
              <div className="stack">
                <label className="small muted" htmlFor="page-editor">Linhas iniciadas por “# ” são títulos. Separe parágrafos com uma linha em branco.</label>
                <textarea id="page-editor" className="chat-input page-editor" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <div className="row">
                  <button className="btn primary" onClick={() => void savePage()} disabled={busy}>Salvar correção</button>
                  <button className="btn" onClick={() => setEditing(false)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <>
                <div className="row">
                  {page.layout === "columns" && <span className="pill warn">Layout em colunas</span>}
                  {page.layout === "empty" && <span className="pill bad">Sem texto extraível</span>}
                  {page.editedByUser && <span className="pill info">Corrigida por você</span>}
                </div>
                <div className="content-text">{page.hasText ? <PageText text={page.text} /> : <p className="muted">Nenhum texto foi encontrado nesta página. Se ela contém texto visível no PDF, provavelmente é uma imagem digitalizada.</p>}</div>
                {(reviewable || m.status === "ready") && (
                  <div><button className="btn sm" onClick={() => { setDraft(page.text); setEditing(true); }}>Corrigir texto desta página</button></div>
                )}
              </>
            )}
          </div>
          {m.kind === "pdf" && (
            <div className="panel stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2>PDF original</h2>
                {pdfUrl ? <a className="btn sm" href={`${pdfUrl}#page=${current}`} target="_blank" rel="noreferrer">Abrir em nova aba</a> : null}
              </div>
              {pdfUrl ? (
                <iframe className="pdf-frame" key={current} src={`${pdfUrl}#page=${current}`} title={`PDF original — página ${current}`} />
              ) : (
                <div className="empty">
                  <strong>Compare com o original</strong>
                  O arquivo é baixado de forma autenticada; não existe link público.
                  <div style={{ marginTop: 10 }}><button className="btn" onClick={() => void openPdf()} disabled={busy}>Carregar PDF</button></div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
