/* ---------------------------------------------------------------------------
   PITCH FLIGHT
   ---------------------------------------------------------------------------
   A different problem from the batted ball, and a weaker one. For a batted ball
   the feed gives exit velocity, launch angle and a distance, which is enough to
   pin a flight down. For a pitch it gives only two things:

     plate.x / plate.z   where the ball crossed the front of home plate, in feet
     velo                release speed, mph

   No release point, no acceleration, no spin — none of the nine parameters a
   full Trackman record carries. So this is a FIT, not a simulation: the release
   point is assumed, and the launch direction is solved so that the ball, flown
   under the same drag and Magnus model as a batted ball, arrives exactly at the
   recorded plate location. What is real is where it ends up and how long it
   took. What is assumed is where it started and how it broke getting there.

   THE SIGN OF plate.x is not guessed. server/projection.py establishes it
   empirically — 9 of 9 hit-by-pitches to right-handed batters had pX < 0, so
   negative pX is the third-base side. That is this engine's -X, so plate.x maps
   straight onto world X with no flip. Getting this backwards would mirror every
   pitch in the app.
--------------------------------------------------------------------------- */

import { PLATE_DEPTH, IN } from '../field/spec.js';
import { BALL_RADIUS, step } from '../ball/trajectory.js';
import { PITCH_MOVEMENT } from '../tuning.js';

/* Where the ball leaves the hand. Averages, because the feed carries none of
   it: MLB release extension runs about 6.4 ft in front of the rubber, and a
   release height around 5.8 ft. The horizontal offset is toward the throwing
   arm — a right-hander's arm is on the third-base side, which is -X here, and
   that is why a righty's pitch to a righty appears to come from behind him. */
export const RELEASE = {
  distance: 60.5 - 6.4, // ft from the back point of the plate
  height: 5.8,
  side: 1.9,
};

/* The front edge of home plate: the 17 in side, facing the pitcher. This is
   the plane pX / pZ are measured on. */
export const PLATE_FRONT_Z = -PLATE_DEPTH;

/* How far past the plate to keep flying, so the ball finishes in the catcher's
   mitt rather than stopping dead in mid-air over the plate. */
const MITT_Z = 2.2;

/**
 * Nominal spin by pitch type, in rpm.
 *
 * Every one of these is invented — the feed has no spin data at all. They are
 * here because a curveball and a four-seamer that arrive at the same spot on
 * identical paths look wrong, and the feed does at least tell us which is
 * which. `back` is backspin (positive resists gravity, negative is topspin and
 * drops); `side` is arm-side run, signed for the pitcher's hand.
 *
 * None of this affects where the pitch ends up: the solve below adjusts the
 * release direction until the ball reaches the recorded plate location whatever
 * the spin does on the way. Spin changes the SHAPE of the path, nothing else.
 */
const PROFILES = {
  FF: { back: 2300, side: 500 }, // four-seam
  FA: { back: 2300, side: 500 },
  SI: { back: 1900, side: 1400 }, // sinker / two-seam
  FT: { back: 1900, side: 1400 },
  FC: { back: 1700, side: -900 }, // cutter, glove side
  SL: { back: -300, side: -1500 }, // slider
  ST: { back: -400, side: -2200 }, // sweeper
  CU: { back: -2200, side: -700 }, // curveball, topspin
  KC: { back: -2300, side: -600 }, // knuckle curve
  CH: { back: 1500, side: 1200 }, // changeup, arm side
  FS: { back: 900, side: 600 }, // splitter, low spin
  EP: { back: 800, side: 0 }, // eephus
  KN: { back: 150, side: 0 }, // knuckleball
};
const DEFAULT_PROFILE = { back: 1900, side: 600 };

const DT = 1 / 960; // finer than a batted ball: the whole flight is 0.4 s
const OUT_HZ = 240;
const MAX_STEPS = 4000;

const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => {
  const n = norm(v);
  return n < 1e-9 ? [0, 0, 0] : [v[0] / n, v[1] / n, v[2] / n];
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * Build the spin vector for a pitch travelling in direction `dir`.
 *
 * Backspin sits on the axis across the direction of travel — the same
 * construction the batted ball uses. Arm-side run sits on the vertical axis,
 * because a spin axis pointing up pushes a ball moving toward the plate
 * sideways. Summing the two gives one axis and one rate, which is all the
 * shared `accel` needs.
 */
function spinVector(dir, profile, hand) {
  const back = unit(cross(dir, [0, 1, 0]));
  const armSide = hand === 'L' ? 1 : -1; // a righty's run goes toward -X
  const v = [
    back[0] * profile.back + 0 * profile.side * armSide,
    back[1] * profile.back + 1 * profile.side * armSide,
    back[2] * profile.back + 0 * profile.side * armSide,
  ];
  const rpm = norm(v);
  return { axis: rpm < 1e-6 ? [1, 0, 0] : v.map((c) => c / rpm), rpm };
}

/** Fly one pitch from `release` aimed at `aim`, recording the path. */
function throwAt(release, aim, speed, profile, hand) {
  const dir = unit([aim[0] - release[0], aim[1] - release[1], aim[2] - release[2]]);
  const { axis, rpm } = spinVector(dir, profile, hand);
  const spinRad = (rpm * 2 * Math.PI) / 60;

  let pos = [...release];
  let vel = [dir[0] * speed, dir[1] * speed, dir[2] * speed];
  let t = 0;

  const samples = [{ t: 0, x: pos[0], y: pos[1], z: pos[2] }];
  const every = Math.max(1, Math.round(1 / (OUT_HZ * DT)));
  let crossing = null;

  for (let i = 0; i < MAX_STEPS; i++) {
    const [nextPos, nextVel] = step(pos, vel, axis, spinRad, 1, DT, PITCH_MOVEMENT);

    // The plate plane, interpolated so the crossing is exact.
    if (crossing === null && nextPos[2] >= PLATE_FRONT_Z) {
      const f = (PLATE_FRONT_Z - pos[2]) / (nextPos[2] - pos[2]);
      crossing = {
        t: t + DT * f,
        x: pos[0] + (nextPos[0] - pos[0]) * f,
        y: pos[1] + (nextPos[1] - pos[1]) * f,
        z: PLATE_FRONT_Z,
      };
    }

    pos = nextPos;
    vel = nextVel;
    t += DT;
    if (i % every === 0) samples.push({ t, x: pos[0], y: pos[1], z: pos[2] });

    /* Only stop at the ground AFTER the plate — a low pitch legitimately
       finishes in the dirt. Stopping before the plate breaks the solve: the
       first attempt at a curveball, aimed straight at its target, is buried by
       its own topspin fifteen feet short, and if the flight ends there the
       correction below has no crossing to correct against and gives up on the
       first pass. Letting it fly through the plate plane always yields a
       crossing, and the converged flight passes above ground by construction. */
    if (pos[2] >= MITT_Z) break;
    if (crossing !== null && pos[1] <= BALL_RADIUS) break;
  }
  samples.push({ t, x: pos[0], y: pos[1], z: pos[2] });
  return { samples, crossing, speed, axis, rpm };
}

/**
 * Reconstruct a pitch.
 *
 * @param {object} p
 * @param {number} p.velo        release speed, mph
 * @param {number} p.plateX      pX, feet, + toward first base
 * @param {number} p.plateZ      pZ, feet above the ground
 * @param {string} [p.hand]      'L' | 'R', the pitcher's throwing hand
 * @param {string} [p.code]      MLB pitch-type code, for the spin profile
 */
export function solvePitch(p) {
  const speed = ((p.velo ?? 90) * 5280) / 3600;
  const hand = p.hand === 'L' ? 'L' : 'R';
  const profile = PROFILES[p.code] ?? DEFAULT_PROFILE;

  const target = [p.plateX ?? 0, p.plateZ ?? 2.5, PLATE_FRONT_Z];
  const release = [
    (hand === 'L' ? 1 : -1) * RELEASE.side,
    RELEASE.height,
    -RELEASE.distance,
  ];

  /* Shooting solve. Aiming straight at the plate location undershoots, because
     gravity and break both act over the 54 ft on the way. So aim at a virtual
     point, see where the ball actually crossed, and move the aim by the miss.
     The map from aim to crossing is very nearly linear over these distances,
     so this converges in a handful of passes. */
  let aim = [...target];
  let flight = throwAt(release, aim, speed, profile, hand);
  for (let i = 0; i < 8; i++) {
    if (!flight.crossing) break;
    const dx = target[0] - flight.crossing.x;
    const dy = target[1] - flight.crossing.y;
    if (Math.hypot(dx, dy) < 0.005) break;
    aim = [aim[0] + dx, aim[1] + dy, aim[2]];
    flight = throwAt(release, aim, speed, profile, hand);
  }

  /* If there is still no crossing the fit failed outright. Report that: the
     first version substituted the target's own coordinates here, which made
     `error` come back as exactly 0 for a pitch that never reached the plate —
     a broken flight that claimed to be perfect. */
  const failed = !flight.crossing;
  const crossing = flight.crossing ?? flight.samples[flight.samples.length - 1];

  return {
    samples: flight.samples,
    duration: flight.samples[flight.samples.length - 1].t,
    crossing, // where and when it crossed the front of the plate
    flightTime: crossing.t, // release to plate
    release: { x: release[0], y: release[1], z: release[2] },
    veloMph: p.velo ?? null,
    spinRpm: flight.rpm,
    code: p.code ?? null,
    /* How far the fit missed the recorded plate location. Anything but ~0
       means the solve failed and the pitch is not where the feed says. */
    error: failed
      ? Infinity
      : Math.hypot(crossing.x - target[0], crossing.y - target[1]),
  };
}

/** Pull the parameters for a pitch out of an at-bat's pitch object. */
export function pitchParams(pitch, atBat) {
  const plate = pitch?.plate;
  if (!plate || !Number.isFinite(plate.x) || !Number.isFinite(plate.z)) return null;
  return {
    velo: Number.isFinite(pitch.velo) ? pitch.velo : 90,
    plateX: plate.x,
    plateZ: plate.z,
    hand: atBat?.pitchHand ?? 'R',
    code: pitch.code ?? null,
  };
}

export const PITCH_IN = IN; // re-export for callers that size things in inches
