import { memo } from 'react';
import { CX, CY, HUB, R, groupStyle, layout, radius, sector, valueOf } from './RatingsWheel.jsx';

const PAD = 3;
const BOX = `${CX - R - PAD} ${CY - R - PAD} ${2 * (R + PAD)} ${2 * (R + PAD)}`;
const GAP = 5 / R; // wider than the card's: at this size its cut would close up

/**
 * The card's ratings wheel, small enough for a table row: same slices, same
 * scale, same colours, so a shape learned on the card reads here. No labels and
 * no numbers, since the row beside it has those, and only the shape is left.
 *
 * Like the card, it keeps the card's palette in both themes: it reads as a chip
 * of card stock sitting on the page.
 *
 * Slices of one colour are one path. A page of these is hundreds of slices, and
 * nothing here needs them apart.
 */
function MiniWheel({ attributes, scale, size = 52 }) {
  const slices = layout(attributes, GAP);
  const paths = {};
  let track = '';
  let empty = '';
  attributes.forEach((a, i) => {
    const { a0, a1 } = slices[i];
    const v = valueOf(a, scale);
    if (v == null) {
      empty += sector(HUB, R, a0, a1);
      return;
    }
    track += sector(HUB, R, a0, a1);
    const { fill } = groupStyle(a.group);
    paths[fill] = (paths[fill] ?? '') + sector(HUB, radius(v, scale), a0, a1);
  });
  const avg = radius(50, scale);

  return (
    <svg className="miniwheel" width={size} height={size} viewBox={BOX} aria-hidden="true">
      <circle className="miniwheel__disc" cx={CX} cy={CY} r={R + PAD - 1} />
      <path className="miniwheel__track" d={track} />
      <path className="miniwheel__empty" d={empty} />
      <circle className="miniwheel__avg" cx={CX} cy={CY} r={avg} />
      {Object.entries(paths).map(([fill, d]) => (
        <path key={fill} d={d} fill={fill} />
      ))}
      <circle className="miniwheel__over" cx={CX} cy={CY} r={avg} />
      <circle className="miniwheel__hub" cx={CX} cy={CY} r={HUB} />
    </svg>
  );
}

export default memo(MiniWheel);
