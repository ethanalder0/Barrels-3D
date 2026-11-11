/* ---------------------------------------------------------------------------
   Reading the "How Overall works" numbers (ratingsReport.json, built by
   scripts/build_ratings_report.py). Kept free of React so it can be tested.
--------------------------------------------------------------------------- */

/** Where the best straight line puts y for this x. */
export const onLine = (fit, x) => fit.slope * x + fit.intercept;

/** The `n` points furthest above and below the line, most extreme first. */
export function furthest(rows, fit, getX, getY, n = 3) {
  const byGap = rows
    .map((row) => ({ row, gap: getY(row) - onLine(fit, getX(row)) }))
    .sort((a, b) => b.gap - a.gap);
  return {
    above: byGap.slice(0, n).map((d) => d.row),
    below: byGap.slice(-n).reverse().map((d) => d.row),
  };
}

/** r squared, as a whole percentage: the share of the spread a line explains. */
export const sharePct = (r) => Math.round(r * r * 100);

/** A run value with its sign: +12.5, −7.5, 0.0. A true minus, not a hyphen. */
export function signed(n, digits = 1) {
  const fixed = Math.abs(n).toFixed(digits);
  if (Number(fixed) === 0) return fixed;
  return `${n > 0 ? '+' : '−'}${fixed}`;
}

/** "A, B and C". */
export function listed(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Nice round ticks spanning [lo, hi]: on 1, 2 or 5 steps, as close to `count` of them as those allow. */
export function ticks(lo, hi, count = 5) {
  const span = hi - lo;
  const mag = 10 ** Math.floor(Math.log10(span / count));
  const step = [1, 2, 5, 10]
    .map((m) => m * mag)
    .reduce((best, s) => (Math.abs(span / s - count) < Math.abs(span / best - count) ? s : best));
  const start = Math.ceil(lo / step) * step;
  const out = [];
  for (let v = start; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** A domain padded past the data so no point sits on the frame. */
export function padded(values, pad = 0.06) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const room = (hi - lo) * pad || 1;
  return [lo - room, hi + room];
}
