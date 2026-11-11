/* ---------------------------------------------------------------------------
   node src/data/ratingsReport.selftest.js

   The helpers behind "How Overall works", and the shape of the built report.
--------------------------------------------------------------------------- */

import { readFileSync } from 'node:fs';
import { furthest, listed, onLine, padded, sharePct, signed, ticks } from './ratingsReport.js';

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const fit = { slope: 1, intercept: 0 };
const rows = [
  { id: 'a', x: 1, y: 5 }, { id: 'b', x: 2, y: 2 }, { id: 'c', x: 3, y: 0 },
  { id: 'd', x: 4, y: 6 }, { id: 'e', x: 5, y: 5.5 },
];
const out = furthest(rows, fit, (r) => r.x, (r) => r.y, 2);
check('furthest above, most first', same(out.above.map((r) => r.id), ['a', 'd']));
check('furthest below, most first', same(out.below.map((r) => r.id), ['c', 'b']), out.below.map((r) => r.id).join());
check('on the line', onLine({ slope: 2, intercept: 1 }, 3) === 7);
check('share of the spread', sharePct(0.69) === 48 && sharePct(-0.667) === 44);
check('signs, with a true minus', signed(12.5) === '+12.5' && signed(-7.5) === '−7.5' && signed(0) === '0.0' && signed(-0.04) === '0.0');
check('lists read as prose', listed(['A']) === 'A' && listed(['A', 'B']) === 'A and B' && listed(['A', 'B', 'C']) === 'A, B and C');
check('ticks fall on round steps', same(ticks(33.9, 72.4, 5), [40, 50, 60, 70]), ticks(33.9, 72.4, 5).join());
check('ticks for small ranges', same(ticks(-1.4, 11.2, 5), [0, 2, 4, 6, 8, 10]), ticks(-1.4, 11.2, 5).join());
const [lo, hi] = padded([10, 20]);
check('padding keeps points off the frame', lo < 10 && hi > 20);

const report = JSON.parse(readFileSync(new URL('./ratingsReport.json', import.meta.url), 'utf8'));
check('the report has every chart', ['wins', 'runsScored', 'runsAllowed', 'hitters', 'pitchers'].every((k) => report.fits[k]));
check('every club has its numbers', report.clubs.length === 30
  && report.clubs.every((c) => ['overall', 'hitting', 'pitching', 'w', 'l', 'rs', 'ra'].every((k) => typeof c[k] === 'number')));
check('every point has a value on both axes', [...report.hitters, ...report.pitchers]
  .every((p) => typeof p.overall === 'number' && typeof p.war === 'number'));
check('each hitter part has its spread', ['bat', 'defense', 'fielding', 'position', 'legs']
  .every((k) => report.hitterParts[k] && report.hitterParts[k].sd > 0));

console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
process.exit(failures ? 1 : 0);
