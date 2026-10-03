/* ---------------------------------------------------------------------------
   PARK SELFTEST — offline check of every ballpark. No browser, no network.
   ---------------------------------------------------------------------------
       node src/replay/field/selftest.js

   A wrong park does not throw. It renders a perfectly convincing ballpark that
   happens to be the wrong shape, and the only thing that ever notices is a home
   run called off the wall. So the geometry gets checked against the two numbers
   in the sheet that the wall distances do not feed into:

     fair territory   an independent measurement of the area the wall encloses.
                      Rebuilding it from the five distances agrees to about 2%
                      across all 32 parks, which is what says the power alleys
                      really are at 22.5 degrees. It is a coarse instrument --
                      see the note on the tolerance below -- so it is checked
                      loosely, as a way of catching a park whose SHAPE is wrong
                      rather than one whose measurement is a little off.

     foul territory   solved for exactly, by moving the side walls. This one is
                      not a cross-check but a fit, so it must come out tight;
                      a park that misses it has failed to converge.

   Follows the pattern of ball/selftest.js: prints what it found, exits non-zero
   if a check fails.
--------------------------------------------------------------------------- */

import { allParks, createPark, GENERIC, parkFor } from './park.js';
import { thetaOf } from './spec.js';

let failures = 0;

function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
}

const pct = (a, b) => ((a - b) / b) * 100;
const f1 = (n) => n.toFixed(1);

/* --- 1. Every park builds ------------------------------------------------ */

console.log('\nevery park builds');

const parks = allParks();
check('the sheet produced parks', parks.length >= 30, `${parks.length} parks`);
check(
  'every club but the Athletics has a current park',
  parks.filter((p) => p.team && !p.retired).length === 29,
  'the A’s left Oakland and their new park is not in the sheet',
);

for (const park of parks) {
  const bad = [];
  for (let t = -45; t <= 45; t += 0.5) {
    const d = park.fenceDistance(t);
    const h = park.fenceHeight(t);
    if (!Number.isFinite(d) || d < 250 || d > 500) bad.push(`d(${t})=${d}`);
    if (!Number.isFinite(h) || h < 0 || h > 60) bad.push(`h(${t})=${h}`);
  }
  if (bad.length) check(`${park.name} wall is sane at every angle`, false, bad[0]);
}
check('every wall is sane at every angle', failures === 0);

/* --- 2. The foul-territory solve ----------------------------------------- */

console.log('\nfoul territory (solved for, so it must land exactly)');

let worstFoul = { name: '', err: 0 };
for (const park of parks) {
  const err = Math.abs(pct(park.foulArea, park.listedFoulArea));
  if (err > Math.abs(worstFoul.err)) worstFoul = { name: park.name, err };
  if (!park.foulSolved) {
    check(`${park.name} solved`, false, `off by ${f1(err)}%`);
  }
}
check(
  'all 32 parks hit their listed foul area',
  parks.every((p) => p.foulSolved),
  `worst: ${worstFoul.name} ${f1(worstFoul.err)}%`,
);

/* The setback is the free parameter the solve moves. It should land somewhere a
   ballpark could actually put a wall — if it ever solves to a few feet or to
   most of a foul line, the construction is wrong, not the park. */
const setbacks = parks.map((p) => p.setback);
check(
  'every setback is a distance a park could have',
  setbacks.every((s) => s > 20 && s < 150),
  `${f1(Math.min(...setbacks))} to ${f1(Math.max(...setbacks))} ft`,
);

/* The two extremes are the point of doing this at all. */
const coliseum = parks.find((p) => p.key === 'oaklandcoliseum');
const wrigley = parks.find((p) => p.key === 'wrigleyfield');
check(
  'the Coliseum has the most foul ground of any park',
  coliseum.setback === Math.max(...setbacks),
  `${f1(coliseum.setback)} ft vs Wrigley’s ${f1(wrigley.setback)}`,
);

/* --- 3. Fair territory, as a cross-check --------------------------------- */

console.log('\nfair territory (independent, so it only has to be close)');

/* 4% is deliberately loose. The rebuild agrees with the sheet to a median of
   -2% with a couple of percent of spread, and both interpolations we tried --
   smoothstep and a centripetal Catmull-Rom through the same points -- land
   within 0.1% of each other, which says the residual is in the source's own
   numbers and not in how the wall is drawn. So this catches a park built the
   wrong SHAPE, and nothing finer. */
const TOLERANCE = 4;
const off = [];
for (const park of parks) {
  const err = pct(park.fairArea, park.listedFairArea);
  if (Math.abs(err) > TOLERANCE) off.push({ name: park.name, err, authored: park.authored });
}
for (const o of off) {
  console.log(
    `  note  ${o.name} encloses ${o.err > 0 ? '+' : ''}${f1(o.err)}% against the sheet` +
      (o.authored ? ' (hand-authored; see outlines.js)' : ' -- five samples cannot describe it'),
  );
}
check(
  'no more than a handful of parks disagree with their listed area',
  off.length <= 5,
  `${off.length} of ${parks.length} outside ${TOLERANCE}%`,
);

/* Fenway is the one park whose wall is written out by hand, and the reason is
   that its landmarks and its listed area cannot both be true. Assert what the
   outline is actually built on, so a future edit to it has to stay honest:
   the Monster is a straight 231 ft wall, and it lands where the sheet's own
   estimate of the left-centre distance says it should. */
const fenway = parks.find((p) => p.key === 'fenwaypark');
check('Fenway uses the hand-authored outline', fenway.authored === true);

const polar = (t, d) => ({ x: Math.sin((t * Math.PI) / 180) * d, z: Math.cos((t * Math.PI) / 180) * d });
const pole = polar(-45, fenway.fenceDistance(-45));
const corner = polar(-7.5, fenway.fenceDistance(-7.5));
const monster = Math.hypot(corner.x - pole.x, corner.z - pole.z);
check('the Green Monster is 231 ft long', Math.abs(monster - 231) < 1, `${f1(monster)} ft`);
check(
  'and it crosses left-centre where the sheet estimates',
  Math.abs(fenway.fenceDistance(-22.5) - 335) < 6,
  `${f1(fenway.fenceDistance(-22.5))} ft vs the sheet’s 335`,
);
check('the triangle is Fenway’s deepest point', Math.round(fenway.fenceDistance(9)) === 420);
check('the Monster is 37 ft of it', fenway.fenceHeight(-45) === 37);
check('and right field is not', fenway.fenceHeight(45) === 5);

/* --- 3b. Wall height steps, never slopes -------------------------------- */

/* A real wall is flat panels meeting at seams, so height has to be piecewise
   CONSTANT: every change happens at one angle, and between two seams the
   number does not move. The old interpolated wall failed both of these — it
   crept upward on nearly every sample. */
console.log('\nwall height steps rather than slopes');

let sloping = 0;
for (const park of parks) {
  const creeps = [];
  /* Stepped in quarter-degree integers rather than by adding 0.25 to a float:
     the seams are at exact angles (-22.5, 0, 9), and accumulated error walks
     the sample right past one. */
  for (let i = -180; i < 180; i++) {
    const t = i / 4;
    const next = (i + 1) / 4;
    const a = park.fenceHeight(t);
    const b = park.fenceHeight(next);
    if (a === b) continue;
    // A change is only allowed to be a step, and only at a declared seam.
    if (!park.heightSteps.some((x) => x >= t && x <= next)) {
      creeps.push(`h(${f1(t)})=${f1(a)} -> h(${f1(next)})=${f1(b)}`);
    }
  }
  if (creeps.length) {
    sloping++;
    check(`${park.name}'s wall changes height only at a seam`, false, creeps[0]);
  }
}
check('no park has a sloping wall', sloping === 0, `${parks.length} parks checked`);

/* Fenway is the sharpest case: the Monster ends and the centre-field wall
   starts, 19 ft lower, at one angle. */
check(
  'the Monster ends in one step, not a ramp',
  fenway.fenceHeight(-7.6) === 37 && fenway.fenceHeight(-7.4) === 18,
  `${fenway.fenceHeight(-7.6)} ft -> ${fenway.fenceHeight(-7.4)} ft across 0.2°`,
);
check(
  'and a park of one height has no seams at all',
  parks.find((p) => p.key === 'americanfamilyfield').heightSteps.length === 0,
);

/* The seam has to reach the MESH, not just the height function: the wall
   ribbon joins consecutive boundary points, so each seam needs a sample either
   side of it or the step gets drawn as a slope after all. */
const oracle = parks.find((p) => p.key === 'oraclepark');
const seam = oracle.heightSteps[0];
const bracketing = oracle
  .boundary()
  .map((pt) => thetaOf(pt.x, pt.z))
  .filter((t) => Math.abs(t - seam) < 0.05);
check(
  'the 24 ft wall in right field is bracketed by two wall samples',
  bracketing.length === 2,
  `${bracketing.length} samples within 0.05° of ${seam}°`,
);

/* --- 4. Lookup ----------------------------------------------------------- */

console.log('\nfinding a park from what the feed sends');

const cases = [
  ['Fenway Park', null, 'Fenway Park'],
  ['Great American Ball Park', null, 'Great American Ballpark'], // sheet spells it as one word
  ['loanDepot park', null, 'Loan Depot Park'],
  ['Busch Stadium', null, 'Busch Stadium'], // sheet says "Busch Stadium III"
  ['Yankee Stadium', null, 'Yankee Stadium'], // sheet says "Yankee Stadium II"
  ['Rate Field', null, 'Guaranteed Rate Field'], // renamed after the sheet
  ['T-Mobile Park', null, 'T-Mobile Park'],
  // The feed sells naming rights inside the venue string.
  ['UNIQLO Field at Dodger Stadium', 'LAD', 'Dodger Stadium'],
  ['UNIQLO Field at Dodger Stadium', null, 'Dodger Stadium'], // without the club too
  ['', 'NYY', 'Yankee Stadium'], // no venue: fall back to the home club
  ['Sutter Health Park', 'ATH', 'Ballpark'], // neither is known: generic
  ['', null, 'Ballpark'],
];
for (const [venue, team, expected] of cases) {
  const got = parkFor(venue, team).name;
  check(
    `${venue ? `"${venue}"` : '(no venue)'}${team ? ` + ${team}` : ''} → ${expected}`,
    got === expected,
    got === expected ? '' : `got "${got}"`,
  );
}

/* --- 5. The generic park stays what it was ------------------------------- */

console.log('\nthe generic park');

/* Splitting park geometry out of spec.js was meant to change nothing for a park
   nobody has chosen. The sun was hand-placed at (-260, 150, 90) before any of
   this existed; it is now derived from a compass bearing, and it has to come
   back to the same place or every existing screenshot is wrong. */
const generic = createPark(GENERIC);
check(
  'the sun lands where it was hand-placed',
  Math.hypot(generic.sun.x + 260, generic.sun.y - 150, generic.sun.z - 90) < 4,
  `(${generic.sun.x.toFixed(0)}, ${generic.sun.y.toFixed(0)}, ${generic.sun.z.toFixed(0)})`,
);
check('it is 400 ft to centre', Math.round(generic.fenceDistance(0)) === 400);
check('and 330 down the lines', Math.round(generic.fenceDistance(-45)) === 330);
check('the wall is 8 ft all the way round', generic.fenceHeight(-45) === 8 && generic.fenceHeight(0) === 8);

/* The boundary is what both the painter and the wall mesh consume, so its
   ordering is a contract: it starts behind home on the third-base side and the
   outfield wall is the far end of it. */
const bounds = generic.boundary();
check('the boundary closes on itself', bounds.length > 100, `${bounds.length} points`);
check(
  'it starts behind home plate',
  Math.abs(thetaOf(bounds[0].x, bounds[0].z)) > 90,
  `theta ${f1(thetaOf(bounds[0].x, bounds[0].z))}°`,
);
check(
  'and reaches the outfield wall',
  Math.abs(Math.max(...bounds.map((p) => Math.hypot(p.x, p.z))) - 400) < 1,
);

/* --- Result -------------------------------------------------------------- */

console.log(failures ? `\n${failures} check${failures > 1 ? 's' : ''} failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
