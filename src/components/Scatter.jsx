import { useEffect, useId, useRef, useState } from 'react';
import { onLine, ticks as niceTicks } from '../data/ratingsReport.js';

const HEIGHT_RATIO = 0.56;
const MIN_HEIGHT = 300;
const MAX_HEIGHT = 470;
const NARROW = 560; // below this, only the points that matter keep their labels

/**
 * A scatterplot with its best straight line, drawn at its real pixel size so
 * the type stays the site's size on a phone rather than shrinking with a
 * viewBox. Hover or tap a point for its numbers.
 *
 *   points  [{ id, x, y, label?, keyLabel?, alt?, tip }]
 *           label shows on wide screens, keyLabel on every screen; alt draws
 *           the point hollow (the chart's second kind of point)
 */
export default function Scatter({ points, fit, x, y, xLabel, yLabel, label }) {
  const wrapRef = useRef(null);
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [width, setWidth] = useState(720);
  const [active, setActive] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const narrow = width < NARROW;
  const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(width * HEIGHT_RATIO)));
  const m = { l: narrow ? 42 : 54, r: 12, t: 12, b: 44 };
  const iw = width - m.l - m.r;
  const ih = height - m.t - m.b;
  const sx = (v) => m.l + ((v - x[0]) / (x[1] - x[0])) * iw;
  const sy = (v) => m.t + ih - ((v - y[0]) / (y[1] - y[0])) * ih;
  const xTicks = niceTicks(x[0], x[1], narrow ? 4 : 6);
  const yTicks = niceTicks(y[0], y[1], 5);

  // Labels that would sit on top of one another are dropped, the keyLabels
  // (the points the text names) placed first so they always survive.
  const labels = [];
  const LABEL_H = 13;
  const CHAR_W = 6.7;
  const DOT = 6;
  // Every point is an obstacle too, so no label is printed over another dot.
  const placed = points.map((p) => ({
    x0: sx(p.x) - DOT, x1: sx(p.x) + DOT, y0: sy(p.y) - DOT, y1: sy(p.y) + DOT,
  }));
  [...points]
    .sort((a, b) => Number(Boolean(b.keyLabel)) - Number(Boolean(a.keyLabel)))
    .forEach((p) => {
      const text = p.keyLabel ?? (narrow ? null : p.label);
      if (!text) return;
      const px = sx(p.x);
      const py = sy(p.y);
      const w = text.length * CHAR_W;
      const rightFirst = px <= width - 140;
      // Beside the point on its roomier side, then the other side, then above and below.
      const spots = [
        { dx: 8, dy: 0, anchor: 'start' }, { dx: -8, dy: 0, anchor: 'end' },
        { dx: 8, dy: -LABEL_H, anchor: 'start' }, { dx: -8, dy: -LABEL_H, anchor: 'end' },
        { dx: 8, dy: LABEL_H, anchor: 'start' }, { dx: -8, dy: LABEL_H, anchor: 'end' },
      ];
      if (!rightFirst) spots.sort((a, b) => a.dx - b.dx);
      const boxOf = (s) => ({
        x0: s.anchor === 'start' ? px + s.dx : px + s.dx - w,
        x1: s.anchor === 'start' ? px + s.dx + w : px + s.dx,
        y0: py + s.dy - LABEL_H / 2,
        y1: py + s.dy + LABEL_H / 2,
      });
      const clear = (box) =>
        box.x0 >= 0 && box.x1 <= width && !placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0);
      const spot = spots.find((s) => clear(boxOf(s))) ?? (p.keyLabel ? spots[0] : null);
      if (!spot) return;
      placed.push(boxOf(spot));
      labels.push({ id: p.id, text, x: px + spot.dx, y: py + spot.dy + 4, anchor: spot.anchor });
    });

  // The line only across the points, so it never claims a range with no data.
  const xs = points.map((p) => p.x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const tip = active ? points.find((p) => p.id === active) : null;

  return (
    <div className="scatter" ref={wrapRef} onPointerLeave={() => setActive(null)}>
      <svg width={width} height={height} role="img" aria-label={label}>
        <defs>
          <clipPath id={clipId}>
            <rect x={m.l} y={m.t} width={iw} height={ih} />
          </clipPath>
        </defs>
        <g className="scatter__grid">
          {yTicks.map((t) => (
            <line key={`y${t}`} x1={m.l} x2={width - m.r} y1={sy(t)} y2={sy(t)} />
          ))}
          {xTicks.map((t) => (
            <line key={`x${t}`} x1={sx(t)} x2={sx(t)} y1={m.t} y2={m.t + ih} />
          ))}
        </g>
        <g className="scatter__axis">
          {yTicks.map((t) => (
            <text key={`y${t}`} x={m.l - 8} y={sy(t) + 4} textAnchor="end">
              {t}
            </text>
          ))}
          {xTicks.map((t) => (
            <text key={`x${t}`} x={sx(t)} y={m.t + ih + 18} textAnchor="middle">
              {t}
            </text>
          ))}
          <line className="scatter__base" x1={m.l} x2={width - m.r} y1={m.t + ih} y2={m.t + ih} />
          <text className="scatter__title" x={m.l + iw / 2} y={height - 6} textAnchor="middle">
            {xLabel}
          </text>
          <text
            className="scatter__title"
            x={12}
            y={m.t + ih / 2}
            textAnchor="middle"
            transform={`rotate(-90 12 ${m.t + ih / 2})`}
          >
            {yLabel}
          </text>
        </g>
        <line
          className="scatter__fit"
          clipPath={`url(#${clipId})`}
          x1={sx(lo)}
          y1={sy(onLine(fit, lo))}
          x2={sx(hi)}
          y2={sy(onLine(fit, hi))}
        />
        <g>
          {points.map((p) => (
            <circle
              key={p.id}
              className="scatter__dot"
              data-alt={Boolean(p.alt)}
              data-active={p.id === active}
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={narrow ? 4.5 : 5.5}
              onPointerEnter={() => setActive(p.id)}
              onClick={() => setActive(p.id === active ? null : p.id)}
            />
          ))}
        </g>
        <g className="scatter__labels">
          {labels.map((l) => (
            <text key={l.id} x={l.x} y={l.y} textAnchor={l.anchor}>
              {l.text}
            </text>
          ))}
        </g>
      </svg>
      {tip && (
        <div
          className="scatter__tip"
          style={{ left: Math.min(Math.max(sx(tip.x), 90), width - 90), top: sy(tip.y) }}
          role="status"
        >
          {tip.tip}
        </div>
      )}
    </div>
  );
}
