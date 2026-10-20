import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Material, Subject } from "@estudos/shared";
import { api } from "../lib/api";
import { Icon, type IconName } from "./Icons";
import { NAV } from "./Layout";

interface Entry {
  id: string;
  label: string;
  hint: string;
  to: string;
  icon: IconName;
  kind: "Páginas" | "Materiais" | "Disciplinas";
}

const norm = (s: string) => s.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{M}+/gu, "");

/** Busca rápida (Ctrl+K): páginas, materiais e disciplinas pelo nome, com navegação por teclado. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [data, setData] = useState<{ materials: Material[]; subjects: Subject[] } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    let alive = true;
    Promise.all([api.materials(), api.subjects()])
      .then(([m, s]) => alive && setData({ materials: m.materials, subjects: s.subjects }))
      .catch(() => alive && setData({ materials: [], subjects: [] }));
    return () => {
      alive = false;
    };
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const pages: Entry[] = NAV.map((n) => ({ id: `p-${n.to}`, label: n.label, hint: n.eyebrow, to: n.to, icon: n.icon, kind: "Páginas" }));
    const mats: Entry[] = (data?.materials ?? []).map((m) => ({
      id: `m-${m.id}`,
      label: m.fileName,
      hint: `${m.subjectName}${m.topic ? ` · ${m.topic}` : ""}`,
      to: `/materiais/${m.id}`,
      icon: "files",
      kind: "Materiais",
    }));
    const subs: Entry[] = (data?.subjects ?? []).map((s) => ({ id: `s-${s.id}`, label: s.name, hint: `${s.semester}º semestre`, to: `/conteudo?disciplina=${s.id}`, icon: "book", kind: "Disciplinas" }));
    const q = norm(query.trim());
    const all = [...mats, ...subs, ...pages];
    return q ? all.filter((e) => norm(`${e.label} ${e.hint}`).includes(q)).slice(0, 12) : [...pages, ...mats.slice(0, 5)];
  }, [data, query]);

  useEffect(() => setActive(0), [query]);

  const go = (e: Entry | undefined) => {
    if (!e) return;
    onClose();
    navigate(e.to);
  };

  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") onClose();
    else if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActive((a) => Math.min(entries.length - 1, a + 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      go(entries[active]);
    }
  };

  let lastKind = "";
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Busca rápida" onKeyDown={onKey}>
        <div className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar materiais, disciplinas ou páginas…"
            aria-label="Buscar"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={entries[active] ? `pal-${entries[active].id}` : undefined}
          />
          <span className="kbd">Esc</span>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox">
          {!data && <li className="palette-empty">Carregando…</li>}
          {data && !entries.length && <li className="palette-empty">Nada encontrado para “{query}”.</li>}
          {entries.map((e, i) => {
            const header = e.kind !== lastKind ? e.kind : null;
            lastKind = e.kind;
            return (
              <li key={e.id} role="presentation">
                {header && <div className="palette-group">{header}</div>}
                <div
                  id={`pal-${e.id}`}
                  role="option"
                  aria-selected={i === active}
                  className={`palette-item ${i === active ? "active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(e)}
                >
                  <span className="palette-icon">
                    <Icon name={e.icon} size={16} />
                  </span>
                  <span className="palette-text">
                    <strong>{e.label}</strong>
                    <small>{e.hint}</small>
                  </span>
                  <Icon name="arrowUpRight" size={14} className="palette-go" />
                </div>
              </li>
            );
          })}
        </ul>
        <div className="palette-foot">
          <span><span className="kbd">↑</span> <span className="kbd">↓</span> navegar</span>
          <span><span className="kbd">Enter</span> abrir</span>
        </div>
      </div>
    </div>
  );
}
