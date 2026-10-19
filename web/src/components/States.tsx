import type { ReactNode } from "react";

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice bad stack" role="alert">
      <span>{message}</span>
      {onRetry && (
        <div>
          <button className="btn sm" onClick={onRetry}>Tentar novamente</button>
        </div>
      )}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}
