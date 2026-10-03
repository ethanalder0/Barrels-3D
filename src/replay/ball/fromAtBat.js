/* ---------------------------------------------------------------------------
   AT-BAT -> BALL PARAMETERS
   ---------------------------------------------------------------------------
   The one place that knows the shape of the app's at-bat payload. The solver
   in trajectory.js takes plain numbers and knows nothing about MLB; everything
   feed-specific lives here.

   Two shapes arrive at this function and both are legitimate:

     live    atBat.hit = { launchSpeed, launchAngle, totalDistance, trajectory,
                           coordinates: { x, y } }        (server/projection.py)
     stub    atBat.{ exitVelo, launchAngle, distance }    (src/data/stubs.js,
                                                           and the offline
                                                           fallback path)

   The stub shape carries no coordinates, so it has no direction. That is
   reported rather than invented — see `sprayKnown`.
--------------------------------------------------------------------------- */

import { thetaOf, fromHitGrid } from '../field/spec.js';

/**
 * Pull ball parameters out of an at-bat, or null if there is not enough to
 * rebuild a flight.
 *
 * `hasReplay` is the app's own gate and is true only when a batted ball has
 * landing coordinates — but it is not sufficient on its own here, because a
 * flight also needs an exit velocity and a launch angle, and those can be
 * missing on a ball the coordinate grid still recorded.
 */
export function ballParamsFromAtBat(atBat) {
  if (!atBat) return null;
  const hit = atBat.hit ?? null;

  const exitVelo = num(hit?.launchSpeed ?? atBat.exitVelo);
  const launchAngle = num(hit?.launchAngle ?? atBat.launchAngle);
  if (exitVelo == null || launchAngle == null) return null;

  const coords = hit?.coordinates;
  const hasCoords = num(coords?.x) != null && num(coords?.y) != null;

  /* Direction always comes from the coordinates when they exist. They are the
     one thing the grid is reliable for — unlike distance, which can be a
     landing point, a catch point, or a roll depending on the play. */
  let sprayAngle = 0;
  if (hasCoords) {
    const at = fromHitGrid(coords.x, coords.y);
    sprayAngle = clampSpray(thetaOf(at.x, at.z));
  }

  /* Magnitude: the larger of the stated distance and the coordinate's own.

     Not "prefer the stated distance", which is what this did first and which
     is wrong on exactly the balls that never leave the ground. `totalDistance`
     is a projected carry — a meaningful number for a fly ball and a poor one
     for a chopper, where it can come back well short of where the ball was
     actually fielded. The coordinate is not a projection: a fielder stood
     there and touched the ball, so the ball reached at least that far. Taking
     the stated number on its own had grounders stopping dead in the middle of
     the infield, short of the fielder who threw the runner out.

     Taking the max keeps fly balls on their projected distance (coordinates
     for those sit at or inside the landing point) and stops ground balls
     short-changing themselves. */
  const stated = num(hit?.totalDistance ?? atBat.distance);
  const reached = hasCoords ? coordinateDistance(coords) : null;
  const distance =
    stated != null && reached != null ? Math.max(stated, reached) : (stated ?? reached);

  return {
    exitVelo,
    launchAngle,
    sprayAngle,
    distance,
    /* Context for the caller and for diagnostics. `trajectory` is NOT fed to
       the solver — it decides its own mode from the physics, so a mislabelled
       ball cannot produce a broken flight. Kept here to check the solver's
       choice against MLB's label. */
    trajectory: hit?.trajectory ?? inferTrajectory(launchAngle),
    trajectoryInferred: !hit?.trajectory,
    /* Whether a fielder caught it on the fly, so the play ended at the landing
       point instead of the ball bouncing on. This is the one place an outcome
       LABEL is allowed to change the reconstruction — it is a fact the feed
       states, not a guess about physics, and without it every routine fly out
       trundled another thirty feet as though it had been dropped. */
    caught: CAUGHT_ON_THE_FLY.test(atBat.result ?? ''),
    sprayKnown: hasCoords,
    distanceKnown: stated != null,
    /* Which number won, so the selftest and the lab can show when the stated
       distance was short of where the ball was actually fielded. */
    distanceFrom: reached != null && (stated == null || reached > stated) ? 'coordinates' : 'stated',
  };
}

/**
 * Statcast's own launch-angle buckets, for payloads with no `trajectory`.
 * Only ever a label — see the note above about it not steering the solve.
 */
function inferTrajectory(launchAngle) {
  if (launchAngle < 10) return 'ground_ball';
  if (launchAngle < 25) return 'line_drive';
  if (launchAngle < 50) return 'fly_ball';
  return 'popup';
}

/* A ball cannot be fair outside the foul lines. Coordinates on a foul ball or
   a scorer's rough placement can land a degree or two past them; clamping is
   better than flying a "fair" ball into the stands down the line. */
const clampSpray = (deg) => Math.max(-45, Math.min(45, deg));

/* Results that mean the ball was caught before it hit the ground. Ground outs
   are deliberately NOT here: the ball reached the fielder along the ground,
   which the ground mode already models by stopping it there. */
const CAUGHT_ON_THE_FLY = /fly\s?out|pop\s?out|line\s?out|sac(rifice)?\s?fly|flyball|caught/i;

/** How far from home the hit grid says the play was made. */
function coordinateDistance(coords) {
  const at = fromHitGrid(coords.x, coords.y);
  return Math.hypot(at.x, at.z);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
