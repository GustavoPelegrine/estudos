import { Link } from "react-router-dom";
import type { SourceRef } from "@estudos/shared";

/** Referência verificável: material, página e trecho original, com link para conferir. */
export function SourceRefView({ source, index }: { source: SourceRef; index?: number }) {
  return (
    <details className="citation">
      <summary>
        {index !== undefined ? `[${index}] ` : ""}
        {source.fileName} — página {source.page}
        {source.materialDeleted ? " (material excluído)" : ""}
      </summary>
      <blockquote>“{source.excerpt}”</blockquote>
      {!source.materialDeleted && (
        <Link className="small" to={`/conteudo?material=${source.materialId}&pagina=${source.page}`}>
          Abrir a página no material
        </Link>
      )}
    </details>
  );
}
