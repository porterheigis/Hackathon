"use client";

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const width = 120;
  const height = 24;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = values[values.length - 1];
  const stroke = last > 0 ? "#2fd682" : last < 0 ? "#ff5c5c" : "#7a7466";

  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}
