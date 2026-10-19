import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { api } from "../lib/api";
import { useToast } from "./Toast";

interface NavItem {
  to: string;
  icon: string;
  label: string;
  title: string;
  eyebrow: string;
  mobile?: string;
}

// Mesmos ícones, rótulos e títulos da versão original, acrescidos de Desempenho e Configurações.
export const NAV: NavItem[] = [
  { to: "/", icon: "⌂", label: "Visão geral", title: "Vamos estudar?", eyebrow: "SEU AMBIENTE DE APRENDIZAGEM", mobile: "Início" },
  { to: "/materiais", icon: "▤", label: "Meu material", title: "Meu material", eyebrow: "ORGANIZAÇÃO ACADÊMICA", mobile: "Material" },
  { to: "/conteudo", icon: "▣", label: "Conteúdo", title: "Conteúdo de estudo", eyebrow: "LEITURA E REVISÃO" },
  { to: "/flashcards", icon: "▧", label: "Flashcards", title: "Flashcards", eyebrow: "MEMORIZAÇÃO ATIVA", mobile: "Cartões" },
  { to: "/questoes", icon: "☷", label: "Questões", title: "Questões de revisão", eyebrow: "PRÁTICA DE RECUPERAÇÃO", mobile: "Questões" },
  { to: "/simulados", icon: "◷", label: "Simulados", title: "Simulados", eyebrow: "AVALIAÇÃO" },
  { to: "/tutor", icon: "✧", label: "Tutor de estudos", title: "Tutor de estudos", eyebrow: "DÚVIDAS SOBRE SEU MATERIAL", mobile: "Tutor" },
  { to: "/desempenho", icon: "↗", label: "Desempenho", title: "Desempenho", eyebrow: "PROGRESSO E REVISÃO" },
  { to: "/configuracoes", icon: "⚙", label: "Configurações", title: "Configurações", eyebrow: "CONTA E PRIVACIDADE" },
];

// Rotas internas sem item no menu.
const EXTRA: NavItem[] = [{ to: "/quiz", icon: "☷", label: "Questões", title: "Questões e simulados", eyebrow: "PRÁTICA DE RECUPERAÇÃO" }];

function currentItem(pathname: string): NavItem {
  return [...NAV, ...EXTRA].sort((a, b) => b.to.length - a.to.length).find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to))) ?? (NAV[0] as NavItem);
}

export function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0b1525" : "#eef4fa");
}

export function Layout() {
  const { me, logout, refreshMe } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const item = currentItem(location.pathname);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const theme = me?.profile.preferences.theme ?? "dark";

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    setMoreOpen(false);
    document.title = `${item.title} · Estudos Odonto`;
  }, [location.pathname, item.title]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("sidebarCollapsed", c ? "0" : "1");
      } catch {
        /* armazenamento indisponível */
      }
      return !c;
    });
  };

  const toggleTheme = async () => {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      await api.updatePreferences({ theme: next });
      await refreshMe();
    } catch {
      toast("Não foi possível salvar a preferência de tema.", "error");
    }
  };

  const mobileMain = NAV.filter((n) => n.mobile);
  const mobileMore = NAV.filter((n) => !n.mobile);

  return (
    <>
      <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
      <div className={`app ${collapsed ? "collapsed" : ""}`}>
        <aside className="sidebar" aria-label="Menu principal">
          <div className="brand">
            <div className="brand-icon" aria-hidden="true">✦</div>
            <div>
              <strong>Estudos Odonto</strong>
              <small>Seu espaço de aprendizagem</small>
            </div>
          </div>
          <div>
            <div className="nav-label">PLATAFORMA</div>
            <nav className="nav">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.to === "/"} title={collapsed ? n.label : undefined}>
                  <span className="ico" aria-hidden="true">{n.icon}</span>
                  <span className="label">{n.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>
          <div className="side-bottom">
            <span className="pill info">CONTA PRIVADA</span>
            <p>{me?.profile.email}</p>
            <p>Seus materiais são visíveis apenas para você e sincronizam entre dispositivos.</p>
          </div>
          <button className="collapse-btn" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? "Expandir menu" : "Recolher menu"}>
            {collapsed ? "»" : "« Recolher"}
          </button>
        </aside>
        <main className="main" id="conteudo-principal">
          <header className="topbar">
            <div>
              <div className="eyebrow">{item.eyebrow}</div>
              <h1>{item.title}</h1>
            </div>
            <div className="top-actions">
              <button className="btn ghost" onClick={() => void toggleTheme()} title="Alternar tema" aria-label="Alternar tema claro/escuro">
                {theme === "dark" ? "☼ Tema" : "☾ Tema"}
              </button>
              <button className="btn" onClick={() => void logout()}>Sair</button>
            </div>
          </header>
          {!me?.aiAvailable && (
            <div className="notice warn" style={{ marginBottom: 15 }}>
              A IA não está configurada no servidor. Leitura, flashcards existentes e busca nos materiais continuam funcionando.
            </div>
          )}
          {me?.aiProvider === "fake" && (
            <div className="notice warn" style={{ marginBottom: 15 }}>
              Modo de desenvolvimento: as respostas de IA são <strong>simuladas</strong> (sem Gemini). Não use este modo em produção.
            </div>
          )}
          <Outlet />
          <footer className="footer-note">Estudos Odonto · Seus materiais são privados e protegidos por login. A IA pode errar: confira as referências citadas.</footer>
        </main>
      </div>
      <div className={`more-sheet ${moreOpen ? "open" : ""}`} id="menu-mais">
        {mobileMore.map((n) => (
          <NavLink key={n.to} to={n.to}>
            <span aria-hidden="true">{n.icon}</span> {n.label}
          </NavLink>
        ))}
      </div>
      <nav className="mobile-nav" aria-label="Navegação">
        {mobileMain.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}>
            <span aria-hidden="true">{n.icon}</span>
            {n.mobile}
          </NavLink>
        ))}
        <button className={moreOpen ? "active" : ""} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} aria-controls="menu-mais">
          <span aria-hidden="true">⋯</span>Mais
        </button>
      </nav>
    </>
  );
}
