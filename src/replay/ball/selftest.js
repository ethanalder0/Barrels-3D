/* ---------------------------------------------------------------------------
   BALL SELFTEST — offline check of the flight solver. No browser, no network.
   ---------------------------------------------------------------------------
       node src/replay/ball/selftest.js

   The solver is the one part of the replay engine that can be wrong in a way
   nobody would notice by looking at it — a flight that renders beautifully and
   lands 40 feet from where the ball actually landed still looks like a
   baseball. So it gets checked against numbers, here, before it is ever drawn.

   Three groups:
     1. calibration  physics that has a known right answer, independent of MLB
     2. coordinates  the hit grid -> world conversion and spray direction
     3. at-bats      every stub at-bat end to end, adapter included

   Follows the pattern of server/selftest.py: prints what it found, exits
   non-zero if a check fails.
--------------------------------------------------------------------------- */

import { atBats } from '../../data/stubs.js';
import { fromHitGrid, thetaOf } from '../field/spec.js';
import { ballParamsFromAtBat } from './fromAtBat.js';
import { liveAtBats, inPlayVague, inPlayDetailed } from './fixtures.js';
import { solveTrajectory, sampleAt, nominalSpin } from './trajectory.js';
import { solvePitch, PLATE_FRONT_Z } from '../pitch/trajectory.js';
import { buildPlay, isAwaitingDetail, playKey } from '../play.js';
import { FINISH_TAIL, WINDUP_LEAD_IN } from '../tuning.js';
import { zoneFor } from '../strikezone.js';

let failures = 0;

function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
}

const f1 = (n) => (n == null ? '—' : n.toFixed(1));

/* --- 1. Calibration ----------------------------------------------------- */

console.log('\ncalibration');

/* A drag-free parabola is the thing this solver exists to not be. Quote the
   gap so a future change that quietly drops drag is obvious. */
const vacuum = (mph, deg) => {
  const v = (mph * 5280) / 3600;
  const r = (deg * Math.PI) / 180;
  return (v * v * Math.sin(2 * r)) / 32.174;
};
console.log(`  108.4 mph at 27 deg: vacuum range ${f1(vacuum(108.4, 27))} ft, tracked 428 ft`);

/* Well-struck ball with no distance imposed: the natural flight. A 100 mph,
   30 degree ball at normal backspin carries a bit under 400 ft in real life. */
const natural = solveTrajectory({ exitVelo: 100, launchAngle: 30, sprayAngle: 0 });
console.log(
  `  100 mph / 30 deg, ${nominalSpin(30).toFixed(0)} rpm nominal, no target:` +
    ` carry ${f1(natural.carry)} ft,` +
    ` apex ${f1(natural.apexHeight)} ft, hang ${natural.hangTime.toFixed(2)} s`,
);
check(
  'natural carry is in the believable band (330-420 ft)',
  natural.carry > 330 && natural.carry < 420,
  `got ${f1(natural.carry)}`,
);
check(
  'hang time is in the believable band (4-6 s)',
  natural.hangTime > 4 && natural.hangTime < 6,
  `got ${natural.hangTime.toFixed(2)}`,
);

/* More backspin must mean more carry across the whole usable range, or the
   bisection in the carry solve is not valid. This is a real regression guard:
   an earlier lift model with a hard cap peaked at 1700 rpm and went flat above
   3500, and the solver had no way to notice. */
const sweep = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 3800].map((rpm) => ({
  rpm,
  carry: solveTrajectory({ exitVelo: 100, launchAngle: 30, sprayAngle: 0, spinRpm: rpm }).carry,
}));
console.log(`  carry vs spin: ${sweep.map((s) => `${s.rpm}rpm ${s.carry.toFixed(0)}ft`).join('  ')}`);
check(
  'carry rises with backspin at every step (the carry solve assumes it)',
  sweep.every((s, i) => i === 0 || s.carry > sweep[i - 1].carry),
);

/* Carry against distances Statcast actually reports. Loose bands — these guard
   against the model drifting, not against a couple of feet. */
console.log('  carry table:');
for (const [ev, la, want] of [
  [95, 30, 360],
  [100, 30, 395],
  [105, 30, 425],
  [110, 30, 455],
]) {
  const got = solveTrajectory({ exitVelo: ev, launchAngle: la, sprayAngle: 0 }).carry;
  console.log(`    ${ev} mph / ${la} deg -> ${f1(got)} ft   (expect ~${want})`);
  check(`  ${ev}/${la} within 25 ft of ${want}`, Math.abs(got - want) < 25, `got ${f1(got)}`);
}

/* Straight-up: it must come back down essentially where it started. */
const popup = solveTrajectory({ exitVelo: 70, launchAngle: 88, sprayAngle: 0 });
check(
  'an 88 degree popup lands within 50 ft of home',
  popup.carry < 50,
  `carry ${f1(popup.carry)} ft, apex ${f1(popup.apexHeight)} ft`,
);

/* --- 2. Coordinates ----------------------------------------------------- */

console.log('\ncoordinates');

/* The worked example already documented in components/PlayerCardBack.jsx:
   coordX 84.05 / coordY 81.28 is 95 ft to the pull side and 280 ft out. */
const worked = fromHitGrid(84.05, 81.28);
check(
  'grid (84.05, 81.28) is ~95 ft toward left field',
  Math.abs(worked.x + 94.7) < 1.5,
  `x = ${f1(worked.x)}`,
);
check(
  'grid (84.05, 81.28) is ~280 ft toward center',
  Math.abs(worked.z + 279.9) < 1.5,
  `z = ${f1(worked.z)}`,
);
check(
  'and reads as a left-field angle',
  thetaOf(worked.x, worked.z) < -15 && thetaOf(worked.x, worked.z) > -25,
  `theta = ${f1(thetaOf(worked.x, worked.z))} deg`,
);

/* Straight-away center, and both foul lines. */
for (const [label, gx, gy, want] of [
  ['dead center', 125.42, 78.5, 0],
  ['right-field line', 214.0, 115.0, 45],
  ['left-field line', 36.8, 115.0, -45],
]) {
  const at = fromHitGrid(gx, gy);
  const got = thetaOf(at.x, at.z);
  check(`${label} reads as ${want} deg`, Math.abs(got - want) < 6, `theta = ${f1(got)}`);
}

/* --- 3. Every stub at-bat, end to end ----------------------------------- */

console.log('\nat-bats (stub payloads, through the adapter)');
console.log(
  '\n  result            EV     LA   dist   mode        carry   ends at   height' +
    '    hang    dur    apex    spin',
);
console.log('  ' + '-'.repeat(101));

for (const ab of atBats) {
  const params = ballParamsFromAtBat(ab);
  if (!params) {
    console.log(`  ${ab.result.padEnd(16)}  (no batted-ball data — correctly skipped)`);
    continue;
  }

  const path = solveTrajectory(params);
  const row = [
    ab.result.padEnd(16),
    f1(params.exitVelo).padStart(6),
    f1(params.launchAngle).padStart(6),
    f1(params.distance).padStart(6),
    ('  ' + path.mode).padEnd(12),
    f1(path.carry).padStart(6),
    f1(path.endDistance).padStart(9),
    f1(path.endHeight).padStart(8),
    path.hangTime.toFixed(2).padStart(7),
    path.duration.toFixed(2).padStart(6),
    f1(path.apexHeight).padStart(7),
    Math.round(path.spinRpm).toString().padStart(7),
  ].join(' ');
  console.log('  ' + row + (path.solved ? '' : '   <- UNSOLVED'));

  check(
    `  lands on the tracked distance (${ab.result})`,
    Math.abs(path.trackedDistance - params.distance) < 3,
    `tracked ${f1(params.distance)}, got ${f1(path.trackedDistance)}`,
  );
  /* The spin the solve lands on is the model's honesty check. If the drag is
     wrong, the flight still ends in the right place — the solve hides the
     error by compensating with lift — and the only visible symptom is a
     backspin no bat produces. Fly balls get the tight band; liners genuinely
     carry less backspin, so they only get the outer bound. */
  const fly = params.launchAngle >= 25;
  check(
    `  spin stayed plausible (${ab.result})`,
    fly
      ? path.spinRpm > 1000 && path.spinRpm < 3000
      : path.spinRpm >= 0 && path.spinRpm <= 3800,
    `${Math.round(path.spinRpm)} rpm`,
  );
  /* The play does not end when the ball lands. Before this, every fly ball
     stopped dead on touchdown, which was the most unnatural thing the replay
     did. A ball that landed in play and was not caught must roll on. */
  if (path.mode === 'carry' && !params.caught) {
    check(
      `  kept going after it landed (${ab.result})`,
      path.duration > path.hangTime && path.rollDistance > 3,
      `rolled ${f1(path.rollDistance)} ft over ${(path.duration - path.hangTime).toFixed(2)} s`,
    );
  }
  check(`  path is monotonic in time (${ab.result})`, monotonic(path.samples));
  check(`  never below the ground (${ab.result})`, path.samples.every((s) => s.y > -0.01));
}

function monotonic(samples) {
  for (let i = 1; i < samples.length; i++) if (samples[i].t < samples[i - 1].t) return false;
  return true;
}

/* --- 4. The live payload shape ------------------------------------------ */

/* The stub at-bats above are the FLAT shape and carry no coordinates, so every
   one of them flies to dead center and the adapter's `hit` branch never runs.
   These are the shape server/projection.py actually emits. */
console.log('\nlive-shaped at-bats (hit.coordinates present)');
console.log('\n  play                      spray    mode        ends at   height    hang    spin');
console.log('  ' + '-'.repeat(78));

for (const ab of liveAtBats) {
  const params = ballParamsFromAtBat(ab);
  const path = solveTrajectory(params);
  console.log(
    '  ' +
      [
        ab.result.padEnd(12) + (ab.hit.trajectory ?? '').padEnd(12),
        (params.sprayAngle > 0 ? '+' : '') + f1(params.sprayAngle).padStart(5),
        ('  ' + path.mode).padEnd(12),
        f1(path.endDistance).padStart(7),
        f1(path.endHeight).padStart(8),
        path.hangTime.toFixed(2).padStart(7),
        Math.round(path.spinRpm).toString().padStart(7),
      ].join(' '),
  );

  check(`  read the coordinates (${ab.result})`, params.sprayKnown);
  check(`  used the stated distance (${ab.result})`, params.distanceKnown);
  /* The bug this guards: preferring `totalDistance` outright stopped ground
     balls dead in the infield, short of the fielder who made the play. When
     the coordinates say the ball got further than the projected carry, they
     win — so the ball must finish past the stated number, not on it. */
  if (params.distanceFrom === 'coordinates') {
    check(
      `  travelled past the projected carry to the fielder (${ab.result})`,
      path.trackedDistance > ab.hit.totalDistance + 5,
      `carry said ${ab.hit.totalDistance} ft, fielded at ${f1(path.trackedDistance)} ft`,
    );
  }
  check(`  did not infer a trajectory (${ab.result})`, !params.trajectoryInferred);
  check(
    `  stayed in fair territory (${ab.result})`,
    Math.abs(params.sprayAngle) <= 45,
    `spray ${f1(params.sprayAngle)} deg`,
  );
  check(
    `  ends on the tracked distance (${ab.result})`,
    Math.abs(path.trackedDistance - params.distance) < 3,
    `tracked ${f1(params.distance)}, got ${f1(path.trackedDistance)}`,
  );
  /* Direction is the coordinates' job. A ball pulled to right field must end
     with a positive X, and one to left with a negative X — getting this
     backwards is the single easiest mistake in the whole grid conversion, and
     it would put every home run in the wrong half of the park. */
  check(
    `  landed on the correct side (${ab.result})`,
    Math.sign(path.tracked.x) === Math.sign(params.sprayAngle) || Math.abs(params.sprayAngle) < 1,
    `spray ${f1(params.sprayAngle)} deg, landed x = ${f1(path.tracked.x)}`,
  );
}

/* The zone bounds ride on the pitch, and the engine reads them from there. */
const zoned = liveAtBats[0].pitches[0].plate;
check(
  'pitches carry per-batter strike-zone bounds',
  zoned.szTop > zoned.szBottom && zoned.szTop < 5 && zoned.szBottom > 1,
  `${zoned.szBottom} to ${zoned.szTop} ft`,
);

/* One zone per batter, never moving: the at-bat's own zone wins, a payload
   without one uses the pitch bounds, and a batter yet to see a pitch still
   gets his server-supplied zone rather than nothing. */
const fromPitches = zoneFor(liveAtBats[0]);
check(
  'an at-bat without a zone falls back to its pitches',
  fromPitches?.top === zoned.szTop && fromPitches?.bottom === zoned.szBottom,
);
check(
  "the at-bat's zone wins over pitch bounds",
  zoneFor({ ...liveAtBats[0], zone: { top: 3.3, bottom: 1.66 } })?.bottom === 1.66,
);
check(
  'a batter with no pitches yet keeps his zone',
  zoneFor({ pitches: [], zone: { top: 3.1, bottom: 1.57 } })?.top === 3.1,
);

/* --- 5. Pitches --------------------------------------------------------- */

console.log('\npitches (a fit to the plate crossing, not a simulation)');
console.log('\n  type   mph   plate x/z        crossed at        miss     flight');
console.log('  ' + '-'.repeat(66));

const PITCHES = [
  ['FF', 95.2, 0.31, 3.05, 'R'],
  ['FF', 95.2, -0.8, 1.7, 'R'],
  ['SI', 93.5, 0.62, 2.3, 'L'],
  ['CH', 87.0, -0.4, 1.95, 'L'],
  ['SL', 86.1, 0.55, 2.1, 'R'],
  ['CU', 79.4, -0.15, 1.62, 'R'],
  ['EP', 55.0, 0.1, 2.2, 'R'],
];

let previousTime = 0;
for (const [code, velo, x, z, hand] of PITCHES) {
  const r = solvePitch({ velo, plateX: x, plateZ: z, hand, code });
  console.log(
    '  ' +
      code.padEnd(6) +
      f1(velo).padStart(5) +
      `${x.toFixed(2)} / ${z.toFixed(2)}`.padStart(14) +
      `${r.crossing.x.toFixed(3)} / ${r.crossing.y.toFixed(3)}`.padStart(18) +
      r.error.toFixed(4).padStart(9) +
      r.flightTime.toFixed(3).padStart(9) + 's',
  );

  /* The whole point of the fit: whatever the assumed release point and spin
     do on the way, the ball has to arrive where the feed says it did. */
  check(`  ${code} arrives at the recorded plate location`, r.error < 0.02, `off by ${r.error.toFixed(4)} ft`);
  check(`  ${code} crosses on the plate plane`, Math.abs(r.crossing.z - PLATE_FRONT_Z) < 1e-6);

  /* A pitch cannot reach the plate faster than it was thrown. This is the
     check that caught the first version: a curveball buried itself fifteen
     feet short, the solve gave up, and the fallback reported the miss as
     exactly zero — a broken flight claiming to be perfect. The tell was a
     79 mph curve arriving in less time than a 95 mph fastball. */
  const travelled = Math.hypot(r.crossing.x - r.release.x, r.crossing.y - r.release.y,
    r.crossing.z - r.release.z);
  const average = travelled / r.flightTime / 1.46667; // ft/s -> mph
  check(`  ${code} averages less than its release speed`, average < velo,
    `${average.toFixed(1)} mph average vs ${velo} released`);

  const preplate = r.samples.filter((p) => p.z <= PLATE_FRONT_Z);
  check(`  ${code} stays above ground before the plate`, preplate.every((p) => p.y > 0.2));
}

/* Slower pitches take longer. Trivially true and worth pinning: it is the
   property that failed first when the solve was silently giving up. */
const times = PITCHES.map(([code, velo, x, z, hand]) =>
  solvePitch({ velo, plateX: x, plateZ: z, hand, code }).flightTime);
const speeds = PITCHES.map((r) => r[1]);
const ordered = speeds
  .map((v, i) => ({ v, t: times[i] }))
  .sort((a, b) => b.v - a.v);
/* Only compare pitches thrown at DIFFERENT speeds. Two at the same velocity
   legitimately differ by a fraction of a millisecond because their plate
   locations differ, and demanding a strict order across those tests nothing. */
check(
  'flight time rises as velocity falls',
  ordered.every((r, i) => i === 0 || r.v === ordered[i - 1].v || r.t > ordered[i - 1].t),
);

/* --- 6. Composition ----------------------------------------------------- */

console.log('\nplay composition (pitch + batted ball on one clock)');
for (const ab of liveAtBats) {
  const play = buildPlay(ab);
  check(`  ${ab.result} composes a play`, !!play);
  if (!play) continue;
  check(`  ${ab.result} has a pitch`, !!play.pitch);
  check(
    `  ${ab.result} times run forward across contact`,
    monotonic(play.samples),
  );
  if (play.ball) {
    check(
      `  ${ab.result} contact is when the pitch reaches the plate`,
      Math.abs(play.contactTime - play.releaseTime - play.pitch.flightTime) < 1e-9,
    );
    /* The bat meets the ball where the pitch actually was — including its
       height, so a ball hit at the knees starts at the knees. */
    const at = sampleAt(play, play.contactTime);
    check(
      `  ${ab.result} batted ball starts at the plate crossing`,
      Math.abs(at.y - play.pitch.crossing.y) < 0.05 &&
        Math.abs(at.x - play.pitch.crossing.x) < 0.05,
      `contact at ${f1(at.y)} ft, pitch crossed at ${f1(play.pitch.crossing.y)} ft`,
    );
    /* Moving the launch point must NOT move the landing point: distances are
       measured from the plate, not from the bat. */
    check(
      `  ${ab.result} still lands on the tracked distance`,
      Math.abs(play.trackedDistance - ballParamsFromAtBat(ab).distance) < 3,
      `${f1(play.trackedDistance)} ft`,
    );
  }
}

/* A pitch that was never put in play is a complete play on its own. */
const takenPitch = buildPlay({
  result: 'Called Strike',
  pitches: [{ type: 'Slider', velo: 84.2, code: 'SL', plate: { x: -0.2, z: 2.1, szTop: 3.4, szBottom: 1.6 } }],
});
check('a called strike builds a play with no batted ball', !!takenPitch && !takenPitch.ball);
check('  and the camera has no contact to cut on', takenPitch?.contactTime === null);
check('  and it finishes past the plate, in the mitt', takenPitch.samples[takenPitch.samples.length - 1].z > 0);

/* --- 6b. The show clock -------------------------------------------------
   A play is longer than its ball at both ends: a wind-up before the release
   and a tail after the last sample, so the pitcher can finish his motion
   instead of freezing mid follow-through. Everything the play reports has to
   be on that one clock — a camera cutting on contact while the ball flies on
   an unshifted clock is a whole wind-up out of step. */

console.log('\nthe show clock (wind-up, ball, follow-through)');

const shown = buildPlay(liveAtBats[0]);
const bare = buildPlay(liveAtBats[0], undefined, { leadIn: 0, tail: 0 });

check(
  'the wind-up comes before the ball',
  shown.releaseTime === WINDUP_LEAD_IN && shown.samples[0].t === WINDUP_LEAD_IN,
  `release ${shown.releaseTime}s, first sample ${shown.samples[0].t}s`,
);
check(
  '  the whole play is the ball plus both ends',
  Math.abs(shown.duration - (bare.duration + WINDUP_LEAD_IN + FINISH_TAIL)) < 1e-9,
  `${shown.duration.toFixed(2)}s vs ${bare.duration.toFixed(2)}s of ball`,
);
check(
  '  the clock runs on after the last sample',
  shown.duration - shown.samples[shown.samples.length - 1].t > 1,
  `${(shown.duration - shown.samples[shown.samples.length - 1].t).toFixed(2)}s of tail`,
);
for (const [name, t] of [
  ['contact', shown.contactTime],
  ['the crossing', shown.crossingTime],
  ['hang', shown.hangTime],
]) {
  check(
    `  ${name} moved onto the play's clock with everything else`,
    t > shown.releaseTime && t <= shown.duration,
    `${t?.toFixed?.(3)}s`,
  );
}
check(
  '  the ball is where the ball was, just later',
  Math.abs(sampleAt(shown, shown.contactTime).y - sampleAt(bare, bare.contactTime).y) < 1e-9,
);
check(
  '  a pitch nobody swung at gets the same treatment',
  takenPitch.releaseTime === WINDUP_LEAD_IN && takenPitch.crossingTime > WINDUP_LEAD_IN,
);

/* --- 7. The two-update pair --------------------------------------------- */

/* A ball put in play arrives twice. Both payloads below are verbatim from a
   real game; see fixtures.js. The first is complete enough to build a flight
   and wrong about where it went, which is the whole problem. */
console.log('\nthe two-update pair (ball in play)');

const vagueParams = ballParamsFromAtBat(inPlayVague);
const detailParams = ballParamsFromAtBat(inPlayDetailed);

console.log(
  `  first update:  result ${JSON.stringify(inPlayVague.result)}, kind ${inPlayVague.kind},` +
    ` spray ${f1(vagueParams.sprayAngle)} deg, distance ${f1(vagueParams.distance)} ft`,
);
console.log(
  `  second update: result ${JSON.stringify(inPlayDetailed.result)}, kind ${inPlayDetailed.kind},` +
    ` spray ${f1(detailParams.sprayAngle)} deg, distance ${f1(detailParams.distance)} ft`,
);

check('the first update is held back', isAwaitingDetail(inPlayVague) === true);
check('the second update is not', isAwaitingDetail(inPlayDetailed) === false);

/* The two really are different plays — this is what the hold is preventing. */
check(
  '  the first update would have flown it to dead centre',
  Math.abs(vagueParams.sprayAngle) < 0.001 && vagueParams.sprayKnown === false,
  `spray ${f1(vagueParams.sprayAngle)} deg`,
);
check(
  '  the second update puts it in left field',
  detailParams.sprayAngle < -20 && detailParams.sprayKnown === true,
  `spray ${f1(detailParams.sprayAngle)} deg`,
);
check(
  '  and they disagree on distance by more than 50 ft',
  Math.abs(detailParams.distance - vagueParams.distance) > 50,
  `${f1(vagueParams.distance)} ft vs ${f1(detailParams.distance)} ft`,
);

/* Once the hold lifts, the key has to have moved or the engine's same-at-bat
   guard would swallow the update that finally carries the truth. */
check(
  '  the key changes between them, so the second update loads',
  playKey(inPlayVague) !== playKey(inPlayDetailed),
);

/* A pitch that was not put in play must never be held: a called strike is
   complete the moment it arrives and there is no second update coming. */
const takenStrike = {
  id: 'ab-9',
  result: 'Strikeout',
  kind: 'k',
  live: false,
  pitches: [{ type: 'Slider', velo: 84, code: 'SL', number: 5, callCode: 'C',
              outcome: 'called', isInPlay: false,
              plate: { x: -0.2, z: 2.1, szTop: 3.4, szBottom: 1.6 } }],
};
check('a called strike is never held', isAwaitingDetail(takenStrike) === false);
check(
  'nor is an at-bat still in progress on a foul',
  isAwaitingDetail({
    id: 'ab-9', result: 'At bat', kind: 'live', live: true,
    pitches: [{ code: 'FF', number: 3, callCode: 'F', outcome: 'foul', isInPlay: false,
                plate: { x: 0.1, z: 2.4, szTop: 3.4, szBottom: 1.6 } }],
  }) === false,
);

/* --- 6b. What the batter did with the pitch ---------------------------- */

console.log('\nswings: fouls, foul tips, takes');
{
  const base = liveAtBats.find((a) => a.pitches?.length && a.hit);
  const as = (outcome, callCode, isInPlay = false) => ({
    ...base, id: `${base.id}-${callCode}`, kind: 'live', result: 'At bat',
    pitches: [...base.pitches.slice(0, -1),
              { ...base.pitches.at(-1), number: 4, outcome, callCode, isInPlay }],
  });
  const foul = buildPlay(as('foul', 'F'));
  const end = foul.samples.at(-1);
  check('a foul is contact', foul.foul && foul.contactTime === foul.crossingTime);
  check('a foul is not a batted ball: no flight, no landing marker', !foul.ball && !foul.tracked);
  check(
    'a foul goes back, over the catcher',
    end.z > 20 && end.y > 10,
    `ends at z ${f1(end.z)} ft, y ${f1(end.y)} ft`,
  );
  /* Straight back, just over a 6 ft umpire standing up behind the catcher
     (4.5 ft behind the plate — see foul.js). */
  const ump = (() => {
    const s = foul.samples;
    const i = s.findIndex((p) => p.z >= 4.5);
    const a = s[i - 1];
    const b = s[i];
    const u = (4.5 - a.z) / (b.z - a.z);
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
  })();
  check(
    'a foul goes just over the umpire, nearly straight back',
    ump.y > 6 && ump.y < 7.2 && Math.abs(ump.x) < 1.5,
    `${f1(ump.y)} ft high, ${f1(ump.x)} ft off centre`,
  );
  check('a foul leaves the picture at the backstop', foul.vanishTime === end.t);
  check(
    'a take leaves the picture past the plate',
    (() => {
      const take = buildPlay(as('called', 'C'));
      return take.vanishTime === take.samples.at(-1).t && take.vanishTime > take.crossingTime;
    })(),
  );
  check(
    'the same foul flies the same way every time',
    JSON.stringify(buildPlay(as('foul', 'F')).samples.at(-1)) === JSON.stringify(end),
  );
  const tip = buildPlay(as('swinging', 'T'));
  check('a foul tip is a swing and a miss', tip.swing === 'miss' && tip.contactTime == null && !tip.foul);
  check('a called strike is a take', buildPlay(as('called', 'C')).swing === 'take');
  /* The regression this guards: mid at-bat `hit` can be an earlier tracked
     foul, and a later take must not replay it as a ball in play. */
  check('a take never flies the at-bat\'s old hit data', !buildPlay(as('called', 'C')).ball);
  check('the pitch that was put in play still does', !!buildPlay(as('inplay', 'X', true)).ball);
}

/* --- 7. The sampler ----------------------------------------------------- */

console.log('\nsampler');
const hr = solveTrajectory(ballParamsFromAtBat(atBats[0]));
const mid = sampleAt(hr, hr.duration / 2);
check('sampleAt clamps below the start', sampleAt(hr, -1).t === hr.samples[0].t);
check('sampleAt clamps past the end', sampleAt(hr, 99).t === hr.duration);
check(
  'sampleAt lands mid-flight in the air',
  mid.y > 10,
  `t = ${mid.t.toFixed(2)} s, y = ${f1(mid.y)} ft`,
);

console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
