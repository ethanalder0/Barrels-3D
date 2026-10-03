/* ---------------------------------------------------------------------------
   FOUL BALLS — a swing that got a piece of it and sent it back.
   ---------------------------------------------------------------------------
   A foul during an at-bat is not a batted ball the feed describes. Statcast
   tracks some of them, but the app does not get a landing point for a foul and
   the replay does not need one: what the viewer has to see is that the batter
   swung and got wood on it, not where it went. So the flight here is not a
   reconstruction. It is the most common foul there is — fouled straight back,
   up and over the catcher — flown on the same physics as every other ball so
   it leaves the bat looking like one.

   It is deliberately short and deliberately off-screen: from the catcher's
   camera the ball comes back off the bat and climbs out over the top of the
   frame. The camera does not chase it (see the director in engine.js); the
   shot stays on the zone, which is where the next pitch is going to be.

   DETERMINISTIC. The launch is varied a little so consecutive fouls are not
   identical, but the variation is seeded from the at-bat and the pitch number,
   so scrubbing, replaying or re-polling the same pitch flies the same ball.
--------------------------------------------------------------------------- */

import { BALL_RADIUS, step } from './trajectory.js';

const DT = 1 / 480;
const OUT_HZ = 120;

/* The envelope a foul is drawn from. Exit velocity is the kind of number a
   foul straight back actually comes off at. */
const EXIT_MPH = [62, 82];
/* Degrees either side of straight back. Small on purpose: the foul this is
   drawing is the one fouled straight back, not one sliced into the stands. */
const SPREAD_DEG = [0, 5];

/* THE LAUNCH IS AIMED, NOT DRAWN. A random launch angle sent some fouls
   skimming the dirt and others up like a pop-up, and neither reads as the
   ordinary foul straight back. So the angle is solved for: picture a 6 ft
   umpire standing straight up behind the catcher, and the ball goes back just
   over his head. UMPIRE_Z is where he stands (ft behind the back point of the
   plate, inside the 8 ft catcher's box); CLEARANCE is how far over his cap it
   passes, drawn from the seed like the rest. */
const UMPIRE_Z = 4.5;
const UMPIRE_HEIGHT = 6;
const CLEARANCE = [0.25, 0.9];

/* Where the flight stops: the backstop is roughly sixty feet behind the
   plate in most parks, and nothing about the ball matters once it is there. */
const BACKSTOP_Z = 58;
const MAX_TIME = 2.0;

/** A small stable hash, so one pitch always gets one foul. */
function seeded(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Successive draws from one seed.
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const lerp = (a, b, u) => a + (b - a) * u;

/**
 * Fly a foul back from the point of contact.
 *
 * `origin` is where the pitch crossed the plate, [x, y, z] in feet (see
 * field/spec.js for the axes: +Z is toward the backstop). `key` seeds the
 * variation. Returns samples on the ball's own clock (t = 0 at contact) in the
 * same shape the pitch and batted-ball solvers return.
 */
export function foulBack(origin, key = '') {
  const rand = seeded(key);
  const exitVelo = lerp(...EXIT_MPH, rand());
  const side = rand() < 0.5 ? -1 : 1;
  const spread = (side * lerp(...SPREAD_DEG, rand()) * Math.PI) / 180;
  const overHead = UMPIRE_HEIGHT + lerp(...CLEARANCE, rand());
  const speed = (exitVelo * 5280) / 3600;

  /* Bisect on the launch angle for the height at the umpire. Height there
     rises with the angle over the whole bracket — five feet of travel is far
     too short for gravity or drag to turn that round — so this converges. */
  let lo = 0;
  let hi = (80 * Math.PI) / 180;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (heightAt(origin, speed, mid, spread, UMPIRE_Z) < overHead) lo = mid;
    else hi = mid;
  }

  const { samples, t } = fly(origin, speed, (lo + hi) / 2, spread);
  return { samples, exitVelo, flightTime: t };
}

function launchVelocity(speed, launch, spread) {
  const horizontal = speed * Math.cos(launch);
  return [horizontal * Math.sin(spread), speed * Math.sin(launch), horizontal * Math.cos(spread)];
}

/* A ball fouled back leaves the bottom of the barrel with backspin that,
   going the "wrong" way, carries it up and back. Modest, and about the
   horizontal axis across its flight, as for any batted ball. */
const SPIN_RAD = (1800 * 2 * Math.PI) / 60;
function spinAxis(vel) {
  const h = Math.hypot(vel[0], vel[2]) || 1;
  return [-vel[2] / h, 0, vel[0] / h];
}

/** The ball's height as it passes `z`, for a given launch. */
function heightAt(origin, speed, launch, spread, z) {
  let vel = launchVelocity(speed, launch, spread);
  const axis = spinAxis(vel);
  let pos = [...origin];
  for (let t = 0; t < MAX_TIME; t += DT) {
    const prev = pos;
    [pos, vel] = step(pos, vel, axis, SPIN_RAD, 1, DT);
    if (pos[2] >= z) {
      const u = (z - prev[2]) / (pos[2] - prev[2] || 1);
      return prev[1] + (pos[1] - prev[1]) * u;
    }
    if (pos[1] <= BALL_RADIUS) return -Infinity; // never got there
  }
  return Infinity; // went (nearly) straight up
}

/** Fly the chosen launch to the backstop or the ground. */
function fly(origin, speed, launch, spread) {
  let vel = launchVelocity(speed, launch, spread);
  const axis = spinAxis(vel);
  let pos = [...origin];

  const every = Math.max(1, Math.round(1 / (OUT_HZ * DT)));
  const samples = [{ t: 0, x: pos[0], y: pos[1], z: pos[2] }];
  let t = 0;
  for (let i = 0; t < MAX_TIME; i++) {
    [pos, vel] = step(pos, vel, axis, SPIN_RAD, 1, DT);
    t += DT;
    const done = pos[1] <= BALL_RADIUS || pos[2] >= BACKSTOP_Z;
    if (done || i % every === 0) samples.push({ t, x: pos[0], y: Math.max(pos[1], BALL_RADIUS), z: pos[2] });
    if (done) break;
  }
  return { samples, t };
}
