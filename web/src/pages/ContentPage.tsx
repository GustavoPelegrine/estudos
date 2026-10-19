import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { MaterialPage } from "@estudos/shared";
import { Empty, ErrorState, Loading } from "../components/States";
import { useToast } from "../components/Toast";
import { useApi } from "../hooks/useApi";
import { api } from "../lib/api";

/** Renderiza o texto normalizado de uma página: "# " = título, linha em branco = parágrafo. */
export function PageText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/u).map((b) => b.trim()).filter(Boolean);
  return (
    <>
      {blocks.map((b, i) =>
        b.startsWith("# ") ? <h3 key={i}>{b.slice(2)}</h3> : <p key={i}>{b}</p>,
      )}
    </>
  );
}

const BATCH = 20;

export function ContentPage() {
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const materials = useApi(() => api.materials().then((r) => r.materials));
  const subjectFilter = params.get("disciplina");
  const targetPage = Number(params.get("pagina") ?? 0);
  const readable = useMemo(
    () => (materials.data ?? []).filter((m) => ["ready", "needs_review", "needs_ocr"].includes(m.status) && (!subjectFilter || m.subjectId === subjectFilter)),
    [materials.data, subjectFilter],
  );
  const selectedId = params.get("material") ?? readable[0]?.id ?? "";
  const material = readable.find((m) => m.id === selectedId) ?? (materials.data ?? []).find((m) => m.id === selectedId);
  const [pages, setPages] = useState<MaterialPage[]>([]);
  const [loadedUntil, setLoadedUntil] = useState(0);
  const [loadingPages, setLoadingPages] = useState(false);

  useEffect(() => {
    setPages([]);
    setLoadedUntil(0);
  }, [selectedId]);

  useEffect(() => {
    if (!material) return;
    const want = Math.max(BATCH, Math.ceil(targetPage / BATCH) * BATCH);
    if (loadedUntil >= Math.min(want, material.pageCount)) return;
    setLoadingPages(true);
    api
      .pages(material.id, loadedUntil + 1, Math.min(material.pageCount, Math.max(loadedUntil + BATCH, want)))
      .then((r) => {
        setPages((prev) => [...prev, ...r.pages]);
        setLoadedUntil(Math.min(material.pageCount, Math.max(loadedUntil + BATCH, want)));
      })
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setLoadingPages(false));
  }, [material, loadedUntil, targetPage, toast]);

  useEffect(() => {
    if (targetPage && pages.some((p) => p.page === targetPage)) {
      document.getElementById(`pagina-${targetPage}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [targetPage, pages]);

  const loadMore = () => {
    if (!material) return;
    setLoadingPages(true);
    api
      .pages(material.id, loadedUntil + 1, Math.min(material.pageCount, loadedUntil + BATCH))
      .then((r) => {
        setPages((prev) => [...prev, ...r.pages]);
        setLoadedUntil((n) => Math.min(material.pageCount, n + BATCH));
      })
      .catch((err: Error) => toast(err.message, "error"))
      .finally(() => setLoadingPages(false));
  };

  const markStudied = async () => {
    if (!material) return;
    try {
      const { material: updated } = await api.updateMaterial(material.id, { studied: true });
      materials.setData((prev) => (prev ?? []).map((m) => (m.id === updated.id ? updated : m)));
      toast("Material marcado como estudado.");
    } catch (err) {
      toast((err as Error).message, "error");
    }
  };

  if (materials.loading && !materials.data) return <Loading />;
  if (materials.error) return <ErrorState message={materials.error} onRetry={() => void materials.reload()} />;

  return (
    <section>
      <div className="section-title">
        <div>
          <h2>Conteúdo de estudo</h2>
          <p>Leia o texto extraído dos seus materiais, organizado por página.</p>
        </div>
        <div className="row">
          <label className="sr-only" htmlFor="content-material">Selecionar material</label>
          <select id="content-material" className="inline" value={selectedId} onChange={(e) => setParams({ material: e.target.value })}>
            {readable.map((m) => (
              <option key={m.id} value={m.id}>{m.fileName} — {m.subjectName}</option>
            ))}
          </select>
          {material && <button className="btn" onClick={() => void markStudied()} disabled={material.studied}>{material.studied ? "Estudado ✓" : "Marcar como estudado ✓"}</button>}
        </div>
      </div>
      <div className="panel">
        {!material ? (
          <Empty title="Não há material selecionado">Adicione seus materiais em <Link to="/materiais">Meu material</Link>.</Empty>
        ) : (
          <div className="content-text">
            <h2>{material.subjectName}{material.topic ? ` — ${material.topic}` : ""}</h2>
            <p className="muted small">{material.semester}º semestre · {material.fileName} · {material.pageCount} {material.kind === "pdf" ? "página(s)" : "seção(ões)"}</p>
            {material.status !== "ready" && (
              <div className="notice warn">Este texto ainda não foi conferido. <Link to={`/materiais/${material.id}`}>Conferir agora</Link></div>
            )}
            {pages.map((p) => (
              <article key={p.page} id={`pagina-${p.page}`} aria-label={`Página ${p.page}`} style={targetPage === p.page ? { outline: "1px solid var(--cyan)", borderRadius: 8, padding: "0 8px" } : undefined}>
                <span className="page-tag">{material.kind === "pdf" ? "Página" : "Seção"} {p.page}</span>
                {p.hasText ? <PageText text={p.text} /> : <p className="muted">Página sem texto extraível (provável imagem digitalizada).</p>}
              </article>
            ))}
            {loadingPages && <Loading label="Carregando páginas…" />}
            {!loadingPages && loadedUntil < material.pageCount && (
              <button className="btn" onClick={loadMore}>Carregar mais páginas</button>
            )}
            <p className="footer-note">Conteúdo exibido a partir do texto extraído do seu material. Nenhum resumo gerado por IA foi acrescentado.</p>
          </div>
        )}
      </div>
    </section>
  );
}
