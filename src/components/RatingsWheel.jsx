import { useId } from 'react';

/* ---------------------------------------------------------------------------
   The ratings wheel: one equal slice per attribute, pushed out by its rating.

   A pizza chart rather than a radar. Every slice gets the same angle, so the
   only thing that varies is how far it reaches -- one number, one length --
   and an empty slice still holds its place, which is how a hidden rating
   reads as "not enough data" rather than as a missing spoke.

   LENGTH, NOT AREA. A slice's area grows with the square of its radius, so a
   90 looks four times a 45 rather than twice. Length is honest about the
   number; the ring at 50 (league average) and the value printed at every tip
   carry the rest. An area-true wheel would squash the top of the scale, which
   is exactly where the players worth looking at live.

   The band is drawn under each slice as a paler arc from its low to its high
   end -- the middle 80% of where his true talent plausibly sits (ratings.py).

   ONE CIRCLE. Every slice is a true sector of the same circle: both edges are
   radii through the centre, and every pair is parted by the same small angle,
   group changes included. The cut therefore widens evenly with the radius, as
   on a real pie. (A fixed-width gutter looks tidier on paper, but it moves
   each edge off its radius, so the slices stop pointing at the centre and the
   cut looks wide at the hub and pinched at the rim.)

   Labels run along a circle of their own, centred on their slice, so a label
   is centred whatever its length -- there is no anchor to switch at 3 and 9
   o'clock, which is what used to throw them off-centre.

   Nothing is computed here. Every number comes from server/ratings.py; this
   only turns them into geometry.
--------------------------------------------------------------------------- */

/* Short labels for the wheel and the face of the card, where a full
   "Contact Management" will not fit. The full label is on every tooltip. */
export const SHORT_LABELS = {
  rawPower: 'Raw power',
  gamePower: 'Power',
  contactQuality: 'Contact Q',
  consistency: 'Consistency',
  batToBall: 'Bat-to-ball',
  swingDecisions: 'Decisions',
  speed: 'Speed',
  baserunning: 'Baserunning',
  range: 'Range',
  arm: 'Arm',
  jump: 'Jump',
  framing: 'Framing',
  blocking: 'Blocking',
  throwing: 'Throwing',
  velocity: 'Velocity',
  stuff: 'Stuff',
  batMissing: 'Whiffs',
  chase: 'Chase',
  command: 'Command',
  contactManagement: 'Contact mgmt',
  depth: 'Depth',
};

/* One colour per group, from the card's own palette. `band` is the pale tint
   the likely range is drawn in -- solid rather than an opacity, so it never
   darkens where it crosses a ring -- and `text` is the value colour that reads
   on the slice (dark ink on the gold). The rows below the wheel use the same
   three, so the two read as one chart. */
export const GROUP_STYLES = {
  hitting: { name: 'Hitting', fill: '#17456f', band: '#c0cad1', text: '#ffffff' },
  pitching: { name: 'Pitching', fill: '#17456f', band: '#c0cad1', text: '#ffffff' },
  running: { name: 'Running', fill: '#c8922f', band: '#ecdab8', text: '#12304e' },
  fielding: { name: 'Fielding', fill: '#8a3d32', band: '#dec8c1', text: '#ffffff' },
};

export const groupStyle = (group) => GROUP_STYLES[group] ?? GROUP_STYLES.hitting;

const W = 328;
const H = 268;
const CX = W / 2;
const CY = H / 2;
const HUB = 26; // the centre, where the overall sits
const R = 112; // the end of the scale
// Label baselines. Top-half labels stand on their circle and grow outward;
// bottom-half labels are flipped to stay upright, so they hang from theirs and
// grow inward -- hence the larger radius, which sets both the same distance
// off the rim.
const LABEL_TOP = R + 9;
const LABEL_BOTTOM = R + 16;
const LABEL_SPAN = 0.95; // radians either side of the slice centre the label path runs
const GAP = 2.5 / R; // the cut between slices: ~2.5px at the rim, nothing at the hub
const INSIDE_MIN = 24; // a slice at least this long prints its value inside

/** The value a slice shows, in whichever scale is selected. */
export function valueOf(score, scale) {
  if (!score || score.hidden) return null;
  return scale === 'grade' ? score.grade : score.pct;
}

function bandOf(score, scale) {
  if (!score || score.hidden) return null;
  return scale === 'grade' ? [score.gradeLo, score.gradeHi] : [score.lo, score.hi];
}

/* Radius for a value: percentiles run 0-100, grades 20-80. */
function radius(v, scale) {
  const t = scale === 'grade' ? (v - 20) / 60 : v / 100;
  return HUB + (R - HUB) * Math.max(0, Math.min(1, t));
}

const point = (r, a) => [CX + r * Math.sin(a), CY - r * Math.cos(a)];
const fmt = (n) => n.toFixed(2);

/* An annular sector from r0 to r1, between angles a0 and a1 (clockwise from 12). */
function sector(r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = point(r1, a0);
  const [x1, y1] = point(r1, a1);
  const [x2, y2] = point(r0, a1);
  const [x3, y3] = point(r0, a0);
  return (
    `M${fmt(x3)} ${fmt(y3)} L${fmt(x0)} ${fmt(y0)} ` +
    `A${r1} ${r1} 0 ${large} 1 ${fmt(x1)} ${fmt(y1)} ` +
    `L${fmt(x2)} ${fmt(y2)} A${r0} ${r0} 0 ${large} 0 ${fmt(x3)} ${fmt(y3)} Z`
  );
}

/* A label's path: an arc centred on its slice, clockwise on the top half and
   anticlockwise on the bottom, so the text along it is never upside down. */
function labelArc(mid) {
  const bottom = Math.cos(mid) < 0;
  const r = bottom ? LABEL_BOTTOM : LABEL_TOP;
  const [from, to] = bottom ? [mid + LABEL_SPAN, mid - LABEL_SPAN] : [mid - LABEL_SPAN, mid + LABEL_SPAN];
  const [x0, y0] = point(r, from);
  const [x1, y1] = point(r, to);
  return `M${fmt(x0)} ${fmt(y0)} A${r} ${r} 0 0 ${bottom ? 0 : 1} ${fmt(x1)} ${fmt(y1)}`;
}

/** Equal slices, the first group centred on 12 o'clock so the wheel sits symmetric. */
function layout(attributes) {
  const n = attributes.length;
  const each = (2 * Math.PI) / n;
  const multi = new Set(attributes.map((a) => a.group)).size > 1;
  let first = 0;
  while (first < n && attributes[first].group === attributes[0].group) first += 1;
  const start = multi ? (-first * each) / 2 : -each / 2;
  return attributes.map((_, i) => {
    const c0 = start + i * each;
    return { a0: c0 + GAP / 2, a1: c0 + each - GAP / 2, mid: c0 + each / 2 };
  });
}

/* The outer edge of a slice at radius r: one arc, for the comparison outline. */
function rim(r, a0, a1) {
  const [x0, y0] = point(r, a0);
  const [x1, y1] = point(r, a1);
  return `M${fmt(x0)} ${fmt(y0)} A${r} ${r} 0 0 1 ${fmt(x1)} ${fmt(y1)}`;
}

/**
 * `compare`, when set, is another player's ratings: his value on every slice
 * the two share is drawn as an outline across it, so the gap between two
 * players is a length you can see rather than two numbers to subtract.
 */
export default function RatingsWheel({ ratings, scale, compare = null }) {
  // Two cards can be open at once (and each has a front and back), so every
  // id in the <defs> is scoped to this wheel.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const attributes = ratings?.attributes ?? [];
  if (!attributes.length) return null;

  const slices = layout(attributes);
  const grade = scale === 'grade';
  // The rim is the top of the scale, so it needs no ring of its own.
  const rings = grade ? [35, 65] : [25, 75];
  const avg = radius(50, scale);
  const overall = valueOf(ratings.overall, scale);
  const summary = attributes
    .map((a) => `${a.label} ${valueOf(a, scale) ?? 'not rated'}`)
    .join(', ');

  return (
    <svg
      className="wheel"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Ratings wheel (${grade ? '20-80 grades' : 'percentiles'}): ${summary}`}
    >
      <defs>
        <pattern
          id={`${uid}-hatch`}
          patternUnits="userSpaceOnUse"
          width="5"
          height="5"
          patternTransform="rotate(45)"
        >
          <rect className="wheel__hatchbg" width="5" height="5" />
          <line className="wheel__hatch" x1="0" y1="0" x2="0" y2="5" />
        </pattern>
        {slices.map((s, i) => (
          <path key={i} id={`${uid}-l${i}`} d={labelArc(s.mid)} fill="none" />
        ))}
      </defs>

      {/* The whole scale under every slice, so the wheel reads as one disc and a
          short slice still shows how far it could have gone. */}
      {attributes.map((a, i) => {
        const empty = valueOf(a, scale) == null;
        return (
          <path
            key={a.key}
            className={empty ? 'wheel__empty' : 'wheel__track'}
            d={sector(HUB, R, slices[i].a0, slices[i].a1)}
            fill={empty ? `url(#${uid}-hatch)` : undefined}
          />
        );
      })}

      {rings.map((v) => (
        <circle key={v} className="wheel__ring" cx={CX} cy={CY} r={radius(v, scale)} />
      ))}
      <circle className="wheel__ring wheel__ring--avg" cx={CX} cy={CY} r={avg} />

      {attributes.map((a, i) => {
        const v = valueOf(a, scale);
        if (v == null) return null;
        const band = bandOf(a, scale);
        const { a0, a1 } = slices[i];
        const g = groupStyle(a.group);
        return (
          <g key={a.key}>
            {band && (
              <path
                d={sector(radius(band[0], scale), radius(band[1], scale), a0, a1)}
                fill={g.band}
              />
            )}
            <path d={sector(HUB, radius(v, scale), a0, a1)} fill={g.fill} />
          </g>
        );
      })}

      {/* League average again, faintly, across the slices that cover it. */}
      <circle className="wheel__ring wheel__ring--over" cx={CX} cy={CY} r={avg} />

      {compare &&
        attributes.map((a, i) => {
          const theirs = valueOf(compare.attributes?.find((c) => c.key === a.key), scale);
          if (theirs == null) return null;
          const { a0, a1 } = slices[i];
          return <path key={a.key} className="wheel__vs" d={rim(radius(theirs, scale), a0, a1)} />;
        })}

      {attributes.map((a, i) => {
        const v = valueOf(a, scale);
        const band = bandOf(a, scale);
        const { mid } = slices[i];
        const g = groupStyle(a.group);
        let tip = null;
        if (v != null) {
          const rv = radius(v, scale);
          const inside = rv - HUB >= INSIDE_MIN;
          tip = { at: point(inside ? rv - 9.5 : rv + 9, mid), fill: inside ? g.text : null };
        }

        return (
          <g key={a.key}>
            <title>
              {`${a.label}: ${v ?? (a.hidden || 'not rated')}${
                band ? ` (likely ${band[0]}–${band[1]})` : ''
              }. ${a.question}`}
            </title>
            {tip && (
              <text
                className="wheel__value"
                x={fmt(tip.at[0])}
                y={fmt(tip.at[1])}
                dy="0.36em"
                textAnchor="middle"
                style={tip.fill ? { fill: tip.fill } : undefined}
              >
                {v}
              </text>
            )}
            <text
              className={v == null ? 'wheel__label wheel__label--empty' : 'wheel__label'}
              textAnchor="middle"
            >
              <textPath href={`#${uid}-l${i}`} startOffset="50%">
                {SHORT_LABELS[a.key] ?? a.label}
              </textPath>
            </text>
          </g>
        );
      })}

      <circle className="wheel__hub" cx={CX} cy={CY} r={HUB} />
      <text className="wheel__ovr" x={CX} y={CY - 3} textAnchor="middle" dy="0.36em">
        {overall ?? '—'}
      </text>
      <text className="wheel__ovrlabel" x={CX} y={CY + 11} textAnchor="middle">
        OVR
      </text>
    </svg>
  );
}
