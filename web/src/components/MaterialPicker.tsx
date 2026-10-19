import type { Material } from "@estudos/shared";
import { Empty } from "./States";
import { Link } from "react-router-dom";

/** Seleção de materiais prontos (texto conferido) para uso pela IA. */
export function MaterialPicker({ materials, selected, onChange, max }: { materials: Material[]; selected: string[]; onChange: (ids: string[]) => void; max: number }) {
  const ready = materials.filter((m) => m.status === "ready");
  if (!ready.length) {
    return (
      <Empty title="Nenhum material pronto">
        Envie um PDF em <Link to="/materiais">Meu material</Link> e confira o texto extraído para liberá-lo.
      </Empty>
    );
  }
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else if (selected.length < max) onChange([...selected, id]);
  };
  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="label">Materiais (até {max})</legend>
      <div className="checklist">
        {ready.map((m) => (
          <label key={m.id} className="check">
            <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} disabled={!selected.includes(m.id) && selected.length >= max} />
            <span>
              <strong>{m.fileName}</strong>
              <small>
                {m.subjectName} · {m.semester}º sem.{m.topic ? ` · ${m.topic}` : ""} · {m.pageCount} pág.
              </small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
