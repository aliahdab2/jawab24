/**
 * Sparkline — a tiny inline trend line (decorative).
 *
 * Pure SVG, no dependencies. Inherits its colour from the parent via
 * `currentColor`, so set the line colour with a text-* class on the wrapper.
 * Decorative by design (`aria-hidden`) — the numeric value it accompanies is
 * the accessible source of truth, so the trend line adds no screen-reader noise.
 */
interface SparklineProps {
  /** Series values, oldest → newest. Needs at least 2 points to render. */
  data: number[];
  width?: number;
  height?: number;
  strokeWidth?: number;
  className?: string;
}

export function Sparkline({
  data,
  width = 56,
  height = 18,
  strokeWidth = 1.5,
  className,
}: SparklineProps) {
  // A flat or single-point series has no trend worth drawing.
  if (!data || data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  // Inset by the stroke width so the top/bottom peaks aren't clipped.
  const pad = strokeWidth;
  const usableH = height - pad * 2;
  const stepX = width / (data.length - 1);

  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = pad + (1 - (v - min) / range) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // Highlight the latest point.
  const [lastX, lastY] = points.split(' ').at(-1)!.split(',');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden="true"
      className={className}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lastX} cy={lastY} r={strokeWidth} fill="currentColor" />
    </svg>
  );
}
