import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { MaterialPage } from "@estudos/shared";
import { ErrorState, Loading } from "../components/States";
import { useToast } from "../components/Toast";
import { useAction, useApi } from "../hooks/useApi";
import { api } from "../lib/api";
import { extractPdfInBrowser, localPdfFor, rememberLocalPdf } from "../lib/pdf";
import { uploadExtractedPages } from "../lib/pdf-upload";
import { useAuth } from "../auth/AuthProvider";
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
  const [versionStage, setVersionStage] = useState<string | null>(null);
  const [versionProgress, setVersionProgress] = useState(0);
  const versionInput = useRef<HTMLInputElement>(null);
  const { me } = useAuth();
  const m = material.data;

  // Carrega as páginas em lotes conforme a navegação.
  useEffect(() => {
    if (!m || m.status === "processing" || m.status === "failed") return;
    if (pages.some((p) => p.page === current)) return;
    const from = Math.floor((current - 1) / PAGE_BATCH) * PAGE_BATCH + 1;
    api
      .pages(id, from, from + PAGE_BATCH - 1)
      .then((r) => setPages((prev) => [...prev.filter((p) => p.page < from || p.page >= from + PAGE_BATCH), ...r.pages].sort((a, b) => a.page - b.page)))
      .catch((err: Error) => toast(err.message, "error"));
  }, [m, current, id, pages, toast]);

  // Reabre automaticamente o PDF escolhido nesta aba (fica só em memória).
  useEffect(() => {
    if (m?.kind !== "pdf" || pdfUrl) return;
    const remembered = localPdfFor(m.id);
    if (remembered) setPdfUrl(URL.createObjectURL(remembered));
  }, [m, pdfUrl]);

  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  }, [pdfUrl]);

  if (material.loading && !m) return <Loading />;
  if (material.error || !m) return <ErrorState message={material.error ?? "Material não encontrado."} onRetry={() => void material.reload()} />;

  const page = pages.find((p) => p.page === current);
  const st = STATUS_LABEL[m.status];
  const ext = m.extraction;
  const reviewable = m.status === "needs_review" || m.status === "needs_ocr";

  // O PDF original fica apenas no aparelho: é aberto localmente para comparação, nunca enviado.
  const openLocalPdf = (file: File | null) => {
    if (!file) return;
    rememberLocalPdf(m.id, file);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(URL.createObjectURL(file));
  };

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

  const toggleStudied = () =>
    run(async () => {
      const { material: updated } = await api.updateMaterial(m.id, { studied: !m.studied });
      material.setData(updated);
    });

  /**
   * Nova versão do PDF: lê o arquivo no aparelho, envia o texto para uma área temporária e só então
   * substitui a versão atual. Se algo falhar no meio, a versão atual continua intacta.
   */
  const sendNewVersion = (file: File | null) => {
    if (versionInput.current) versionInput.current.value = "";
    if (!file) return;
    const maxBytes = me?.limits.maxPdfBytes ?? 20 * 1024 * 1024;
    if (file.size > maxBytes) return toast(`O PDF tem ${formatBytes(file.size)}; o limite é ${formatBytes(maxBytes)}.`, "error");
    if (
      !confirm(
        `Substituir o texto de “${m.fileName}” pelo de “${file.name}”?\n\nO material continua na mesma disciplina. Você vai conferir e liberar o texto novo antes de a IA usá-lo. Flashcards e simulados já feitos são mantidos.`,
      )
    )
      return;
    void run(async () => {
      try {
        setVersionStage("Lendo a nova versão neste dispositivo…");
        const { pages: newPages, report } = await extractPdfInBrowser(file, {
          maxPages: me?.limits.maxPdfPages ?? 400,
          onProgress: (page, total) => {
            setVersionStage(`Lendo a página ${page} de ${total} neste dispositivo…`);
            setVersionProgress(page / total);
          },
        });
        setVersionStage("Salvando a nova versão…");
        setVersionProgress(0);
        await api.startNewVersion(m.id, { fileName: file.name, sizeBytes: file.size, pageCount: report.pageCount, warnings: report.warnings });
        const updated = await uploadExtractedPages(m.id, newPages, setVersionProgress);
        rememberLocalPdf(m.id, file);
        if (pdfUrl) URL.revokeObjectURL(pdfUrl);
        setPdfUrl(URL.createObjectURL(file));
        setPages([]);
        setCurrent(1);
        setEditing(false);
        material.setData(updated);
        toast(`Versão ${updated.version ?? 2} salva. Confira o texto e libere para estudo.`);
      } catch (err) {
        toast(`${(err as Error).message} A versão anterior continua disponível.`, "error");
      } finally {
        setVersionStage(null);
        setVersionProgress(0);
      }
    });
  };

  const remove = () => {
    if (!confirm(`Excluir “${m.fileName}”? O texto extraído e os flashcards derivados serão apagados (o PDF continua só no seu aparelho).`)) return;
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
            {(m.version ?? 1) > 1 ? ` · versão ${m.version}, atualizada em ${formatDateTime(m.versionUpdatedAt)}` : ""}
          </p>
        </div>
        <div className="row">
          <span className={`pill ${st.tone}`}>{st.text}</span>
          {m.kind === "pdf" && m.status !== "processing" && (
            <label className={`btn ${busy ? "disabled" : ""}`} style={{ cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.5 : 1 }}>
              Enviar nova versão
              <input ref={versionInput} type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy} onChange={(e) => sendNewVersion(e.target.files?.[0] ?? null)} />
            </label>
          )}
          <button className="btn" onClick={() => void toggleStudied()} disabled={busy}>{m.studied ? "Estudado ✓" : "Marcar como estudado"}</button>
          <button className="btn danger" onClick={remove} disabled={busy}>Excluir</button>
        </div>
      </div>

      {versionStage && (
        <div className="notice upload-progress" role="status">
          <span className="small"><span className="spinner" aria-hidden="true" /> {versionStage}</span>
          <div className="progress"><span style={{ width: `${Math.round(versionProgress * 100)}%` }} /></div>
        </div>
      )}
      {m.updating && !versionStage && <div className="notice">Uma nova versão está sendo enviada. Enquanto isso, a versão atual continua disponível.</div>}

      {m.status === "failed" && (
        <div className="notice bad stack" role="alert">
          <span>{m.errorMessage ?? "Falha ao salvar o texto do PDF."}</span>
          <span className="small">Exclua este material e envie o arquivo de novo.</span>
        </div>
      )}
      {m.status === "processing" && <div className="notice">Recebendo o texto extraído… <button className="btn sm" onClick={() => void material.reload()}>Atualizar</button></div>}

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
                  O PDF fica só no seu aparelho (não é enviado para a nuvem). Abra o arquivo para conferir lado a lado.
                  <div style={{ marginTop: 10 }}>
                    <label className="btn" style={{ cursor: "pointer" }}>
                      Abrir PDF deste aparelho
                      <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => openLocalPdf(e.target.files?.[0] ?? null)} />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
