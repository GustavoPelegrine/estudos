import type { ReactNode } from "react";

export function Loading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="skeleton" role="status">
      <span className="sr-only">{label}</span>
      <div className="skeleton-line lg" aria-hidden="true" />
      <div className="skeleton-line" aria-hidden="true" />
      <div className="skeleton-line" style={{ width: "72%" }} aria-hidden="true" />
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
