import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loading } from "../components/States";
import { useAuth } from "./AuthProvider";

/** Protege as páginas privadas (a proteção real dos dados está no backend e nas regras). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, me, loading, error, logout } = useAuth();
  const location = useLocation();
  if (loading) return <div className="auth-wrap"><Loading label="Carregando sua sessão…" /></div>;
  if (!user) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  if (!me) {
    return (
      <div className="auth-wrap">
        <div className="panel auth-card stack">
          {error ? <div className="notice bad" role="alert">{error}</div> : <Loading label="Carregando perfil…" />}
          {error && <button className="btn" onClick={() => void logout()}>Sair</button>}
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
