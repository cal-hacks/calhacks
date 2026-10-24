import { useEffect, useRef, useState } from "react";

export interface Bar {
  key: string;
  label: string;
  /** Shorter label for the x axis; omitted bars get no tick. */
  tick?: string;
  value: number;
  /** Tooltip text for the value, e.g. "2.5 h". */
  display: string;
}

/** Single-series column chart: hairline grid, 4px rounded caps, hover tooltip, table view. */
export function BarChart({
  bars,
  title,
  unit,
  reference,
  height = 200,
}: {
  bars: Bar[];
  title: string;
  unit: string;
  reference?: { value: number; label: string };
  height?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { top: 12, right: 8, bottom: 24, left: 34 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const rawMax = Math.max(reference?.value ?? 0, ...bars.map((b) => b.value), 1);
  const step = niceStep(rawMax / 4);
  const max = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const band = innerW / Math.max(1, bars.length);
  const barW = Math.min(24, Math.max(2, band - 2));
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const hovered = hover !== null ? bars[hover] : null;

  return (
    <figure className="chart">
      <figcaption className="chart-head">
        <span className="chart-title">{title}</span>
        <button type="button" className="link-btn small" onClick={() => setShowTable((v) => !v)}>
          {showTable ? "Show chart" : "Show table"}
        </button>
      </figcaption>

      {showTable ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th scope="col">Period</th><th scope="col" className="num">{unit}</th></tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.key}><td>{b.label}</td><td className="num">{b.display}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={wrapRef} className="chart-plot" onMouseLeave={() => setHover(null)}>
          <svg width={width} height={height} role="img" aria-label={`${title}. Use “Show table” for values.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="grid" />
                <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="axis">{fmtTick(t)}</text>
              </g>
            ))}
            {bars.map((b, i) => {
              const cx = pad.left + band * i + band / 2;
              const h = Math.max(0, y(0) - y(b.value));
              return (
                <g key={b.key}>
                  {b.value > 0 && (
                    <path d={roundedTop(cx - barW / 2, y(b.value), barW, h, Math.min(4, barW / 2, h))} className={`bar${hover === i ? " is-hover" : ""}`} />
                  )}
                  {b.tick && (
                    <text x={cx} y={height - 6} textAnchor="middle" className="axis">{b.tick}</text>
                  )}
                  {/* Hit target spans the whole band, taller than the mark. */}
                  <rect
                    x={pad.left + band * i}
                    y={pad.top}
                    width={band}
                    height={innerH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${b.label}: ${b.display}`}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  />
                </g>
              );
            })}
            {reference && (
              <g>
                <line x1={pad.left} x2={width - pad.right} y1={y(reference.value)} y2={y(reference.value)} className="ref-line" />
                <text x={width - pad.right} y={y(reference.value) - 4} textAnchor="end" className="axis">{reference.label}</text>
              </g>
            )}
            <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} className="baseline" />
          </svg>
          {hovered && hover !== null && (
            <div
              className="tooltip"
              style={{
                left: Math.min(width - 120, Math.max(0, pad.left + band * hover + band / 2 - 60)),
                top: Math.max(0, y(hovered.value) - 52),
              }}
            >
              <span className="tooltip-label">{hovered.label}</span>
              <strong>{hovered.display}</strong>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  if (h <= 0) return "";
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

function niceStep(raw: number) {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function fmtTick(v: number) {
  if (v >= 1000) return `${Math.round(v / 100) / 10}K`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
