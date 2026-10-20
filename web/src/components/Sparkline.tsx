import { useId } from "react";

/**
 * Minigráfico de linha luminosa (referências Quantix/Verdant), em SVG puro.
 * values: série numérica; com menos de 2 pontos mostra uma linha base discreta.
 */
export function Sparkline({
  values,
  width = 160,
  height = 48,
  max,
  label,
  className = "",
}: {
  values: number[];
  width?: number;
  height?: number;
  max?: number;
  label?: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const pad = 4;
  const series = values.length >= 2 ? values : [0, 0];
  const top = max ?? Math.max(...series, 1);
  const bottom = Math.min(0, ...series);
  const x = (i: number) => pad + (i / (series.length - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - bottom) / (top - bottom || 1)) * (height - pad * 2);
  // Curva suave (Catmull-Rom → Bézier)
  const pts = series.map((v, i) => [x(i), y(v)] as const);
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  const last = pts[pts.length - 1]!;
  const area = `${d} L${last[0]},${height} L${pts[0]![0]},${height} Z`;
  const empty = values.length < 2;
  return (
    <svg className={`sparkline ${empty ? "empty" : ""} ${className}`} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--lime)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--lime)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {!empty && <path d={area} fill={`url(#fill-${id})`} />}
      <path d={d} fill="none" stroke="var(--lime)" strokeWidth="1.8" strokeLinecap="round" vectorEffect="non-scaling-stroke" className="sparkline-line" />
      {!empty && <circle cx={last[0]} cy={last[1]} r="3" fill="var(--lime)" className="sparkline-dot" />}
    </svg>
  );
}
