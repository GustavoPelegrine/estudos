import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { Sparkline } from "./Sparkline";

export function Delta({ value }: { value: number | null }) {
  if (value === null) return null;
  const cls = value > 0 ? "" : value < 0 ? "down" : "flat";
  return (
    <span className={`delta ${cls}`} title="Última tentativa comparada à média das anteriores">
      {value > 0 ? "+" : ""}
      {value} p.p.
    </span>
  );
}

/** Cartão de indicador com ícone luminoso e minigráfico opcional (referência Quantix). */
export function StatCard({ icon, label, value, extra, trend, trendMax }: { icon: IconName; label: string; value: ReactNode; extra?: ReactNode; trend?: number[]; trendMax?: number }) {
  return (
    <div className="panel stat-card">
      <div className="stat-top">
        <div className="stat-icon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </div>
        {extra}
      </div>
      <div>
        <div className="num">{value}</div>
        <div className="label">{label}</div>
      </div>
      {trend && <Sparkline values={trend} max={trendMax} height={44} />}
    </div>
  );
}
