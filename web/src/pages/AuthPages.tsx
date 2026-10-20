import { createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { authErrorMessage } from "../lib/auth-errors";
import { auth } from "../lib/firebase";
import { Icon } from "../components/Icons";
import { AccentTitle } from "../components/Layout";

function AuthShell({ title, accent, subtitle, children }: { title: string; accent?: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <main className="panel auth-card">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true"><Icon name="tooth" size={20} /></div>
          <div>
            <strong>Estudos Odonto</strong>
            <small>Seu espaço de aprendizagem</small>
          </div>
        </div>
        <div className="eyebrow"><span className="live-dot" aria-hidden="true" />{subtitle}</div>
        <h1 style={{ margin: "8px 0 20px" }}><AccentTitle title={title} accent={accent} /></h1>
        {children}
        <div className="auth-aside">
          <span><Icon name="check" size={14} /> Materiais privados</span>
          <span><Icon name="sparkle" size={14} /> Tutor com citações</span>
          <span><Icon name="cards" size={14} /> Revisão espaçada</span>
        </div>
      </main>
    </div>
  );
}

export function LoginPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  if (user) return <Navigate to={from} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Bem-vindo de volta" accent="volta" subtitle="Acesso à sua conta">
      <form className="stack" onSubmit={submit} noValidate>
        {error && <div className="notice bad" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn primary" type="submit" disabled={busy || !email || !password}>{busy ? "Entrando…" : "Entrar"}</button>
        <div className="row small" style={{ justifyContent: "space-between" }}>
          <Link to="/recuperar-senha">Esqueci minha senha</Link>
          <Link to="/cadastro">Criar conta</Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function SignupPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirm) return setError("As senhas não conferem.");
    setBusy(true);
    setError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await sendEmailVerification(cred.user).catch(() => undefined);
      navigate("/", { replace: true });
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Criar sua conta" accent="conta" subtitle="Cadastro">
      <form className="stack" onSubmit={submit} noValidate>
        {error && <div className="notice bad" role="alert">{error}</div>}
        <div className="field">
          <label htmlFor="email">E-mail</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Senha</label>
          <input id="password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="password-hint" />
          <span className="hint" id="password-hint">Mínimo de 8 caracteres.</span>
        </div>
        <div className="field">
          <label htmlFor="confirm">Confirmar senha</label>
          <input id="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <button className="btn primary" type="submit" disabled={busy || !email || !password}>{busy ? "Criando…" : "Criar conta"}</button>
        <p className="small muted" style={{ margin: 0 }}>
          Seus materiais ficam privados na sua conta. Enviaremos um e-mail de confirmação.
        </p>
        <Link className="small" to="/entrar">Já tenho conta</Link>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Não revela se o e-mail está cadastrado.
      if (code === "auth/user-not-found") setSent(true);
      else setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Recuperar senha" accent="senha" subtitle="Acesso à sua conta">
      {sent ? (
        <div className="stack">
          <div className="notice good" role="status">Se houver uma conta com este e-mail, você receberá um link para redefinir a senha.</div>
          <Link to="/entrar">Voltar para o login</Link>
        </div>
      ) : (
        <form className="stack" onSubmit={submit} noValidate>
          {error && <div className="notice bad" role="alert">{error}</div>}
          <div className="field">
            <label htmlFor="email">E-mail da conta</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <button className="btn primary" type="submit" disabled={busy || !email}>{busy ? "Enviando…" : "Enviar link"}</button>
          <Link className="small" to="/entrar">Voltar</Link>
        </form>
      )}
    </AuthShell>
  );
}
