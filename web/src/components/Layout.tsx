import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import type { StatsSummary } from "@estudos/shared";
import { useAuth } from "../auth/AuthProvider";
import { api } from "../lib/api";
import { formatDateTime, percent } from "../lib/format";
import { CommandPalette } from "./CommandPalette";
import { Icon, type IconName } from "./Icons";
import { useToast } from "./Toast";

interface NavItem {
  to: string;
  icon: IconName;
  label: string;
  /** Título da página; `accent` é a palavra destacada em itálico serifado. */
  title: string;
  accent?: string;
  eyebrow: string;
  group: "Estudo" | "Prática" | "Conta";
  mobile?: string;
  badge?: "due";
}

export const NAV: NavItem[] = [
  { to: "/", icon: "home", label: "Visão geral", title: "Vamos estudar?", accent: "estudar", eyebrow: "Seu ambiente de aprendizagem", group: "Estudo", mobile: "Início" },
  { to: "/materiais", icon: "files", label: "Meu material", title: "Meu material", accent: "material", eyebrow: "Organização acadêmica", group: "Estudo", mobile: "Material" },
  { to: "/conteudo", icon: "book", label: "Conteúdo", title: "Conteúdo de estudo", accent: "estudo", eyebrow: "Leitura e revisão", group: "Estudo" },
  { to: "/flashcards", icon: "cards", label: "Flashcards", title: "Flashcards", accent: "Flashcards", eyebrow: "Memorização ativa", group: "Prática", mobile: "Cartões", badge: "due" },
  { to: "/questoes", icon: "list", label: "Questões", title: "Questões de revisão", accent: "revisão", eyebrow: "Prática de recuperação", group: "Prática", mobile: "Questões" },
  { to: "/simulados", icon: "timer", label: "Simulados", title: "Simulados", accent: "Simulados", eyebrow: "Avaliação", group: "Prática" },
  { to: "/tutor", icon: "sparkle", label: "Tutor de estudos", title: "Tutor de estudos", accent: "estudos", eyebrow: "Dúvidas sobre seu material", group: "Prática", mobile: "Tutor" },
  { to: "/desempenho", icon: "chart", label: "Desempenho", title: "Desempenho", accent: "Desempenho", eyebrow: "Progresso e revisão", group: "Conta" },
  { to: "/configuracoes", icon: "settings", label: "Configurações", title: "Configurações", eyebrow: "Conta e privacidade", group: "Conta" },
];

// Rotas internas sem item no menu.
const EXTRA: NavItem[] = [{ to: "/quiz", icon: "list", label: "Questões", title: "Questões e simulados", accent: "simulados", eyebrow: "Prática de recuperação", group: "Prática" }];

function currentItem(pathname: string): NavItem {
  return [...NAV, ...EXTRA].sort((a, b) => b.to.length - a.to.length).find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to))) ?? (NAV[0] as NavItem);
}

/** Título com a palavra de destaque em itálico serifado (referência Verdant). */
export function AccentTitle({ title, accent }: { title: string; accent?: string }): ReactNode {
  if (!accent || !title.includes(accent)) return title;
  const [before, after] = title.split(accent) as [string, string];
  return (
    <>
      {before}
      <em>{accent}</em>
      {after}
    </>
  );
}

export function applyTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#050706" : "#f4f6ef");
}

/** Nome para a saudação: displayName ou a primeira parte do e-mail ("gustavo.dias…" → "Gustavo"). */
export function firstName(displayName: string | null | undefined, email: string | null | undefined): string {
  const raw = (displayName || (email ?? "").split("@")[0] || "").split(/[\s._-]+/)[0]?.replace(/\d+/g, "") ?? "";
  return raw ? raw[0]!.toLocaleUpperCase("pt-BR") + raw.slice(1).toLocaleLowerCase("pt-BR") : "";
}
/** Resumo de progresso do menu (contadores) e da faixa de informações; recarrega ao trocar de página ou voltar à aba (no máximo 1x/min). */
function useProgressSummary(path: string) {
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const last = useRef(0);
  const load = useCallback(async (force = false) => {
    if (!force && Date.now() - last.current < 60_000) return;
    last.current = Date.now();
    try {
      setStats((await api.stats()).stats);
    } catch {
      /* indicador opcional: falha silenciosa */
    }
  }, []);
  useEffect(() => {
    void load(true);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);
  useEffect(() => void load(), [path, load]);
  return stats;
}

function Ticker({ stats, aiCalls, aiLimit }: { stats: StatsSummary | null; aiCalls: number; aiLimit: number }) {
  const lastQuiz = stats?.recentQuizzes.find((q) => q.answeredCount > 0);
  const items: { label: string; value: string; tone?: "good" | "bad" }[] = [
    { label: "Taxa de acerto", value: stats ? percent(stats.correct, stats.answered) : "—", tone: stats && stats.answered ? (stats.correct / stats.answered >= 0.7 ? "good" : "bad") : undefined },
    { label: "Questões respondidas", value: String(stats?.answered ?? "—") },
    { label: "Flashcards para hoje", value: String(stats?.flashcardsDue ?? "—") },
    { label: "Simulados finalizados", value: String(stats?.quizzesFinished ?? "—") },
    { label: "Uso de IA hoje", value: `${aiCalls}/${aiLimit}` },
    ...(lastQuiz ? [{ label: "Última tentativa", value: `${lastQuiz.correctCount}/${lastQuiz.questionCount}` }] : []),
    ...(stats?.weakTopics[0] ? [{ label: "Revisar", value: stats.weakTopics[0].topic, tone: "bad" as const }] : []),
  ];
  const row = (hidden: boolean) => (
    <div className="ticker-row" aria-hidden={hidden || undefined}>
      {items.map((i) => (
        <span key={i.label} className="ticker-item">
          <span className="ticker-dot" aria-hidden="true" />
          <span className="ticker-label">{i.label}</span>
          <strong className={i.tone ?? ""}>{i.value}</strong>
        </span>
      ))}
    </div>
  );
  return (
    <div className="ticker" role="region" aria-label="Resumo do seu progresso">
      <div className="ticker-track">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}

export function Layout() {
  const { me, user, logout, refreshMe } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const item = currentItem(location.pathname);
  const stats = useProgressSummary(location.pathname);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebarCollapsed") === "1";
    } catch {
      return false;
    }
  });
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const theme = me?.profile.preferences.theme ?? "dark";
  const name = firstName(me?.profile.displayName, me?.profile.email);

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    setMoreOpen(false);
    setSearchOpen(false);
    document.title = `${item.title} · Estudos Odonto`;
  }, [location.pathname, item.title]);

  // Atalho Ctrl+K / ⌘K para a busca rápida
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const badgeFor = (n: NavItem) => (n.badge === "due" && stats?.flashcardsDue ? stats.flashcardsDue : null);
  const mobileMain = NAV.filter((n) => n.mobile);
  const mobileMore = NAV.filter((n) => !n.mobile);
  const groups = ["Estudo", "Prática", "Conta"] as const;

  return (
    <>
      <a className="skip-link" href="#conteudo-principal">Pular para o conteúdo</a>
      <div className={`app ${collapsed ? "collapsed" : ""}`}>
        <aside className="sidebar" aria-label="Menu principal">
          <div className="brand">
            <div className="brand-icon" aria-hidden="true">
              <Icon name="tooth" size={20} />
            </div>
            <div className="brand-text">
              <strong>Estudos Odonto</strong>
              <small>Plataforma de estudos</small>
            </div>
            <button className="collapse-btn" onClick={toggleCollapsed} aria-expanded={!collapsed} aria-label={collapsed ? "Expandir menu" : "Recolher menu"} title={collapsed ? "Expandir menu" : "Recolher menu"}>
              <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} />
            </button>
          </div>

          <div className="welcome">
            <p className="welcome-title">
              Bom estudo{name ? "," : ""}
              <br />
              <em>{name || "por aqui"}</em>
            </p>
            {user?.metadata.lastSignInTime && <p className="welcome-sub">Último acesso: {formatDateTime(new Date(user.metadata.lastSignInTime).toISOString())}</p>}
          </div>

          <nav className="nav" aria-label="Seções">
            {groups.map((g) => (
              <div key={g} className="nav-group">
                <div className="nav-label">{g}</div>
                {NAV.filter((n) => n.group === g).map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.to === "/"} title={collapsed ? n.label : undefined}>
                    <Icon name={n.icon} />
                    <span className="label">{n.label}</span>
                    {badgeFor(n) ? <span className="nav-badge" aria-label={`${badgeFor(n)} pendentes`}>{badgeFor(n)}</span> : null}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>

          <div className="side-bottom">
            <span className="pill info">Conta privada</span>
            <p>{me?.profile.email}</p>
            <p>Seus materiais são visíveis apenas para você e sincronizam entre dispositivos.</p>
          </div>
        </aside>

        <main className="main" id="conteudo-principal">
          <div className="topbar-shell">
            <nav className="crumbs" aria-label="Você está em">
              <Icon name="home" size={16} />
              <Link to="/">Visão geral</Link>
              {item.to !== "/" && (
                <>
                  <span aria-hidden="true">/</span>
                  <span aria-current="page">{item.label}</span>
                </>
              )}
            </nav>
            <div className="top-actions">
              <button className="search-trigger" onClick={() => setSearchOpen(true)} aria-label="Buscar materiais e páginas">
                <Icon name="search" size={16} />
                <span>Buscar…</span>
                <span className="kbd">Ctrl K</span>
              </button>
              <button className="btn ghost icon-btn" onClick={() => void toggleTheme()} title="Alternar tema" aria-label="Alternar tema claro/escuro">
                <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
                <span className="hide-sm">Tema</span>
              </button>
              <button className="btn ghost icon-btn" onClick={() => void logout()} title="Sair da conta">
                <Icon name="logout" size={16} />
                <span>Sair</span>
              </button>
            </div>
          </div>
          <Ticker stats={stats} aiCalls={me?.usage.aiCalls ?? 0} aiLimit={me?.usage.aiDailyLimit ?? 0} />

          <header className="topbar">
            <div>
              <div className="eyebrow">
                <span className="live-dot" aria-hidden="true" />
                {item.eyebrow}
              </div>
              <h1>
                <AccentTitle title={item.title} accent={item.accent} />
              </h1>
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
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} />}
      <div className={`more-sheet ${moreOpen ? "open" : ""}`} id="menu-mais">
        {mobileMore.map((n) => (
          <NavLink key={n.to} to={n.to}>
            <Icon name={n.icon} /> {n.label}
          </NavLink>
        ))}
        <button className="more-search" onClick={() => setSearchOpen(true)}>
          <Icon name="search" /> Buscar
        </button>
      </div>
      <nav className="mobile-nav" aria-label="Navegação">
        {mobileMain.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === "/"}>
            <Icon name={n.icon} size={20} />
            {n.mobile}
          </NavLink>
        ))}
        <button className={moreOpen ? "active" : ""} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} aria-controls="menu-mais">
          <Icon name="more" size={20} />
          Mais
        </button>
      </nav>
    </>
  );
}
