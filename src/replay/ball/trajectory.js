/* ---------------------------------------------------------------------------
   BALL FLIGHT — reconstructing a batted ball from what was actually tracked.
   ---------------------------------------------------------------------------
   This is not a replay of a recorded path. MLB gives us four numbers — exit
   velocity, launch angle, a landing/fielding coordinate and a distance — and
   from those we rebuild a flight that both looks physical AND ends where the
   tracked data says it ended. Those two goals fight each other, and resolving
   that fight is the whole job of this file.

   Why a real integration is unavoidable: a drag-free parabola is not remotely
   close. 108.4 mph at 27 degrees has a vacuum range of 635 ft. The tracked
   distance for that ball is 428. Drag and lift account for a third of the
   flight, so there is no closed form worth having.

   THE THREE MODES. `distance` does not mean the same thing on every batted
   ball, so the solver decides what it is looking at from the physics rather
   than from the label on it (a mislabelled trajectory then cannot break a
   replay):

     intercept  The ball is still in the air when it reaches `distance`. That
                is a catch — the number is where the fielder was, not where the
                ball would have landed. Fly the natural arc, stop there, and
                the height it stops at IS the catch height. A 99 mph liner at
                8 degrees with distance 121 is a lineout to short, and this
                mode puts it in the shortstop's glove at about chest height
                without being told any of that.

     carry      The ball lands short of `distance` but could reach it with
                plausible backspin. Solve the spin. This is every fly ball and
                home run: the flight stays physical and the landing point is
                exactly the tracked one.

     ground     The ball lands far short and no amount of backspin would fix
                it — you cannot lift a -2 degree ball 96 feet through the air.
                So `distance` includes bounce and roll. Fly to first contact,
                then bounce and roll, solving the rolling friction to stop on
                the number.

   What is NOT modelled, and is a deliberate omission rather than an oversight:
   sidespin. A real ball hooks toward the foul line it was pulled to. Nothing
   in the feed measures it, so inventing a hook would be inventing data. The
   flight is straight in plan view; the spray angle from the coordinates
   carries all of the direction.

   Units are feet, seconds, and slugs, consistent with field/spec.js.
--------------------------------------------------------------------------- */

import { thetaOf } from '../field/spec.js';
import { createPark } from '../field/park.js';

/* --- Physical constants ------------------------------------------------- */

const G = 32.174; // ft/s^2

/* A major-league ball: 5 to 5.25 oz, 9 to 9.25 in around. Midpoints. */
const WEIGHT_LB = 5.125 / 16;
const MASS = WEIGHT_LB / G; // slugs
export const BALL_RADIUS = 9.125 / Math.PI / 2 / 12; // ft, from the circumference
const AREA = Math.PI * BALL_RADIUS ** 2;
const AIR_DENSITY = 0.0023769; // slug/ft^3, sea level

/* Every aerodynamic force here is (1/2) rho A C v^2 / m. Fold the constants
   that never change into one number so the inner loop is a multiply. */
const K = (AIR_DENSITY * AREA) / (2 * MASS); // ~0.00549 per ft

/* Drag coefficient, roughly flat across the speeds a batted ball sees.
   Calibrated, not looked up: swept against the tracked distances until the
   backspin the solver needs came out in the range a bat actually imparts.
   At 0.35 a 428 ft home run only needed 995 rpm and a 389 ft fly ball 562 —
   the model was carrying the ball too far on its own, so the solve was
   compensating with implausibly little lift. At 0.385 those become 1822 and
   1371 rpm, and 100 mph at 30 degrees carries 393 ft, which is where
   Statcast puts it.

   There is a cliff not far above: by 0.42 the model cannot reach these
   distances at any spin, and the solver drops to `ground` mode. If flights
   ever start coming back as `ground` that should have flown, this number is
   the first place to look. */
const CD = 0.385;

/* Lift from backspin, as a function of the spin parameter S = omega*r/v.
   Saturating and smooth: Cl = CL_MAX * S / (S_HALF + S). Calibrated so that
   2000 rpm at 100 mph gives Cl ~ 0.20, the usual measured value.

   The shape matters more than the calibration, and specifically it must have
   no corner in it. A linear fit with a hard cap looks equivalent and is not:
   S grows as the ball slows, so late in any flight the cap binds, and past
   that point carry stops responding to spin at all. Measured on the earlier
   version, carry peaked at 1700 rpm and was flat from 3500 up — which quietly
   destroys the assumption the carry solve below is built on, that more
   backspin is always more carry. This form stays monotonic across the whole
   usable range.

   Absolute calibration is the less critical half: the solver adjusts spin to
   hit a known distance, so an error here surfaces as an implausible spin in
   the result rather than as a wrong landing point. That is what `spinRpm` is
   in the output for. */
const CL_MAX = 0.5;
const S_HALF = 0.26;
const liftCoefficient = (s) => (CL_MAX * s) / (S_HALF + s);

/* --- Model defaults ----------------------------------------------------- */

export const DEFAULTS = {
  contactHeight: 3.0, // ft; roughly where a swing meets the ball
};

/**
 * What the ball lands on.
 *
 * `field` is grass and dirt: it bounces well and rolls a long way, which is
 * why a ball in the gap keeps going. `seats` is everything past the fence —
 * a ball landing in the stands hits chairs and people, barely bounces, and
 * stops within a few feet. Without that distinction a home run kept bouncing
 * for another ninety feet through the bleachers.
 */
export const SURFACES = {
  field: { restitution: 0.45, bounce: 0.75, roll: 0.24 },
  seats: { restitution: 0.15, bounce: 0.3, roll: 2.2 },
};

/**
 * The backspin a bat actually imparts, by launch angle.
 *
 * A ball driven at 30-plus degrees leaves with 2000-2500 rpm; a low line drive
 * carries a few hundred, and a chopper often has topspin. One flat nominal is
 * wrong at the ends and it shows: at a fly ball's 2000 rpm, an 8 degree liner
 * gets so much lift that the model had it caught 15 ft in the air — over the
 * shortstop's head on a play the feed calls a sharp liner to short. Sloped, it
 * arrives at a catchable height on its own.
 *
 * This only sets the starting flight and the arc of an intercepted ball. The
 * carry solve overrides it outright.
 */
export function nominalSpin(launchAngle) {
  return (Math.max(0, Math.min(35, launchAngle)) / 35) * 2200;
}

/** Has this point cleared the outfield fence for its own spray angle? */
const beyondFence = (park, p) =>
  Math.hypot(p.x, p.z) > park.fenceDistance(thetaOf(p.x, p.z));

/* The park a solve runs in when none is named. Built once: the solver is called
   per batted ball and rebuilding a park each time would redo its foul-area
   solve for nothing. */
const DEFAULT_PARK = createPark();

/* The most backspin the solver may use, by launch angle. A bat puts a few
   hundred rpm on a low line drive and a grounder, and 2000+ only on a ball hit
   in the air. With one flat 3800 ceiling a 2 degree ball with a 150 ft tracked
   distance was "solved" by giving it absurd lift, so a grounder skimmed 150 ft
   in the air and then bounced on, high and far. Capped this way it cannot, and
   a number that far out falls to `ground` mode: fly to first contact, then
   hop and roll to the tracked spot, which is what a grounder does. */
const maxSpinFor = (launchAngle) =>
  300 + (Math.max(0, Math.min(30, launchAngle)) / 30) * 3500; // rpm
const DT = 1 / 480; // integration step
const OUT_HZ = 120; // sample rate of the returned path
const MAX_TIME = 15; // s, a hard stop so nothing can loop forever

/* --- Vector helpers ----------------------------------------------------- */

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => {
  const n = norm(v);
  return n < 1e-9 ? [0, 0, 0] : [v[0] / n, v[1] / n, v[2] / n];
};

/* --- Integration -------------------------------------------------------- */

/**
 * Acceleration on a ball at velocity `vel`.
 *
 * `axis` is the spin axis, fixed in space for the whole flight — spin does not
 * swing around to follow the velocity, and recomputing it per step both is
 * wrong and blows up when the ball is momentarily vertical. Because it is
 * fixed, |axis x vhat| falls below 1 as the flight curves, which is exactly
 * the physics: only the component of spin across the velocity lifts.
 */
export function accel(vel, axis, spinRad, dragScale, liftScale = 1) {
  const v = norm(vel);
  if (v < 1e-6) return [0, -G, 0];

  const drag = -K * CD * dragScale * v; // times vel, below
  // liftScale exaggerates break for pitches (tuning.js); batted balls use 1.
  const lift = K * liftCoefficient((spinRad * BALL_RADIUS) / v) * v * v * liftScale;
  const m = cross(axis, [vel[0] / v, vel[1] / v, vel[2] / v]);

  return [
    drag * vel[0] + lift * m[0],
    drag * vel[1] + lift * m[1] - G,
    drag * vel[2] + lift * m[2],
  ];
}

/** One RK4 step. Shared with the pitch solver. */
export function step(pos, vel, axis, spinRad, dragScale, dt, liftScale = 1) {
  const a1 = accel(vel, axis, spinRad, dragScale, liftScale);
  const v2 = vel.map((c, i) => c + a1[i] * (dt / 2));
  const a2 = accel(v2, axis, spinRad, dragScale, liftScale);
  const v3 = vel.map((c, i) => c + a2[i] * (dt / 2));
  const a3 = accel(v3, axis, spinRad, dragScale, liftScale);
  const v4 = vel.map((c, i) => c + a3[i] * dt);
  const a4 = accel(v4, axis, spinRad, dragScale, liftScale);

  return [
    pos.map((c, i) => c + (dt / 6) * (vel[i] + 2 * v2[i] + 2 * v3[i] + v4[i])),
    vel.map((c, i) => c + (dt / 6) * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i])),
  ];
}

/**
 * Fly the ball until it touches the ground, recording the path.
 * Returns the samples, the moment of first contact, and the state there.
 */
function flight({ exitVelo, launchAngle, sprayAngle, spinRpm, contactHeight, dragScale, origin }) {
  const speed = (exitVelo * 5280) / 3600; // mph -> ft/s
  const theta = (launchAngle * Math.PI) / 180;
  const phi = (sprayAngle * Math.PI) / 180;

  // Spray angle follows spec.polar(): 0 is center field (-Z), + toward first.
  const horizontal = speed * Math.cos(theta);
  let vel = [horizontal * Math.sin(phi), speed * Math.sin(theta), -horizontal * Math.cos(phi)];
  /* Where the bat met the ball. Distances stay measured from the world origin
     (the back point of the plate, which is what MLB measures from), so moving
     the launch point does not move the target — it only changes the spin the
     solve needs by a hair. */
  let pos = origin ? [...origin] : [0, contactHeight, 0];

  // Pure backspin: the axis is across the velocity, horizontal, oriented so
  // the Magnus force comes out upward.
  const axis = unit(cross(unit(vel), [0, 1, 0]));
  const spinRad = (spinRpm * 2 * Math.PI) / 60;

  const samples = [];
  const every = Math.max(1, Math.round(1 / (OUT_HZ * DT)));
  let t = 0;
  let i = 0;
  samples.push({ t: 0, x: pos[0], y: pos[1], z: pos[2] });

  for (; t < MAX_TIME; i++) {
    const [nextPos, nextVel] = step(pos, vel, axis, spinRad, dragScale, DT);

    if (nextPos[1] <= BALL_RADIUS && nextVel[1] < 0) {
      // Land on the exact crossing rather than the step that overshot it.
      const f = (pos[1] - BALL_RADIUS) / (pos[1] - nextPos[1]);
      const land = pos.map((c, k) => c + (nextPos[k] - c) * f);
      const landVel = vel.map((c, k) => c + (nextVel[k] - c) * f);
      t += DT * f;
      samples.push({ t, x: land[0], y: land[1], z: land[2] });
      return { samples, hangTime: t, pos: land, vel: landVel, grounded: true };
    }

    pos = nextPos;
    vel = nextVel;
    t += DT;
    if (i % every === 0) samples.push({ t, x: pos[0], y: pos[1], z: pos[2] });
  }
  return { samples, hangTime: t, pos, vel, grounded: false };
}

/**
 * Bounce and roll from a ground contact until the ball stops.
 *
 * `rollFriction` is in g, and is the knob the ground mode solves on.
 * `maxDistance` stops the roll at the wall — without it a ball that lands near
 * the track keeps rolling straight through the fence and out into the stands,
 * which looks exactly as broken as it sounds.
 */
function groundPhase(start, startVel, startTime, surface, out, maxDistance = Infinity) {
  const rollFriction = surface.roll;
  let pos = [...start];
  let vel = [...startVel];
  let t = startTime;
  const every = Math.max(1, Math.round(1 / (OUT_HZ * DT)));
  let i = 0;

  while (t < MAX_TIME) {
    const speed = Math.hypot(vel[0], vel[2]);
    const bouncing = Math.abs(vel[1]) > 2 || pos[1] > BALL_RADIUS * 1.5;

    if (bouncing) {
      // In the air between hops: gravity and drag only, spin is spent.
      const [nextPos, nextVel] = step(pos, vel, [0, 0, 0], 0, 1, DT);
      if (nextPos[1] <= BALL_RADIUS && nextVel[1] < 0) {
        pos = [nextPos[0], BALL_RADIUS, nextPos[2]];
        /* A ball does not bounce the same off every impact: it gives back
           less of a hard hit. A flat restitution sent steep chops (and every
           first hop) up and away; scaled by impact speed, hard grounders stay
           low and tight while a slow dribble still hops. */
        const e = surface.restitution * Math.max(0.55, 1 - Math.abs(nextVel[1]) / 120);
        vel = [nextVel[0] * surface.bounce, -nextVel[1] * e, nextVel[2] * surface.bounce];
      } else {
        pos = nextPos;
        vel = nextVel;
      }
    } else {
      if (speed < 1) break; // come to rest
      const decel = rollFriction * G * DT;
      const scale = Math.max(0, (speed - decel) / speed);
      vel = [vel[0] * scale, 0, vel[2] * scale];
      pos = [pos[0] + vel[0] * DT, BALL_RADIUS, pos[2] + vel[2] * DT];
    }

    t += DT;
    if (i++ % every === 0) out.push({ t, x: pos[0], y: pos[1], z: pos[2] });
    if (Math.hypot(pos[0], pos[2]) >= maxDistance) break; // into the wall
  }
  out.push({ t, x: pos[0], y: pos[1], z: pos[2] });
  return { t, pos };
}

/* --- Path measurements -------------------------------------------------- */

const groundDistance = (p) => Math.hypot(p.x, p.z);

/** Where a path first reaches horizontal distance `d`, interpolated. */
function crossing(samples, d) {
  for (let i = 1; i < samples.length; i++) {
    const a = groundDistance(samples[i - 1]);
    const b = groundDistance(samples[i]);
    if (b >= d && b > a) {
      const f = (d - a) / (b - a);
      const p = samples[i - 1];
      const q = samples[i];
      return {
        index: i,
        t: p.t + (q.t - p.t) * f,
        x: p.x + (q.x - p.x) * f,
        y: p.y + (q.y - p.y) * f,
        z: p.z + (q.z - p.z) * f,
      };
    }
  }
  return null;
}

/** Truncate a path at a crossing point, keeping the samples before it. */
function truncate(samples, at) {
  return [...samples.slice(0, at.index), { t: at.t, x: at.x, y: at.y, z: at.z }];
}

function apexOf(samples) {
  let best = samples[0];
  for (const s of samples) if (s.y > best.y) best = s;
  return best;
}

/* --- The solver --------------------------------------------------------- */

/**
 * Rebuild a batted ball.
 *
 * @param {object} p
 * @param {number} p.exitVelo      mph off the bat
 * @param {number} p.launchAngle   degrees above horizontal
 * @param {number} p.sprayAngle    degrees, 0 = center field, + toward first
 * @param {number} [p.distance]    ft; the tracked distance, whatever it means
 * @param {number} [p.contactHeight]
 * @param park  which ballpark this is in. It decides where the wall is, and so
 *              whether a ball is gone or off the wall — the one place a park
 *              changes an outcome rather than a picture. Defaults to generic.
 * @returns a path plus what the solve had to do to produce it
 */
export function solveTrajectory(p, park = DEFAULT_PARK) {
  const contactHeight = p.contactHeight ?? DEFAULTS.contactHeight;
  const base = {
    origin: p.origin ?? null,
    exitVelo: p.exitVelo,
    launchAngle: p.launchAngle,
    sprayAngle: p.sprayAngle ?? 0,
    contactHeight,
    /* Air is thinner at altitude and the ball carries. Coors Field is about
       0.82 here. Exposed for that, and for calibration sweeps. */
    dragScale: p.dragScale ?? 1,
  };

  const fly = (spinRpm) => flight({ ...base, spinRpm });
  const nominal = p.spinRpm ?? nominalSpin(p.launchAngle);

  // The natural flight, before any distance is imposed on it.
  const natural = fly(nominal);
  const naturalCarry = groundDistance(natural.samples[natural.samples.length - 1]);

  /**
   * Attach the measurements every caller wants to a solved path.
   *
   * Two different points matter and conflating them is a mistake waiting to
   * happen, because which one the feed's distance refers to depends on the
   * mode: it is the touchdown on a `carry` ball, the resting place on a
   * `ground` ball, and the catch on an `intercept`. `trackedTime` is whichever
   * of those this branch solved for, and `tracked` is the point to mark.
   */
  const result = (solve) => {
    const end = solve.samples[solve.samples.length - 1];
    const apex = apexOf(solve.samples);
    const at = sampleAt(
      { samples: solve.samples },
      Math.min(solve.trackedTime ?? end.t, end.t),
    );
    return {
      rollFriction: null,
      ...solve,
      apexHeight: apex.y,
      apexTime: apex.t,
      duration: end.t,
      tracked: { x: at.x, z: at.z }, // what the data pins down
      trackedDistance: groundDistance(at),
      rest: { x: end.x, z: end.z }, // where the ball finally stops
      endHeight: end.y,
      endDistance: groundDistance(end),
      rollDistance: groundDistance(end) - groundDistance(at),
    };
  };

  const distance = p.distance;
  if (!Number.isFinite(distance) || distance <= 0) {
    // Nothing to match — the natural flight is the honest answer.
    return result({
      samples: natural.samples,
      carry: naturalCarry,
      hangTime: natural.hangTime,
      spinRpm: nominal,
      mode: 'natural',
      solved: true,
    });
  }

  /* The spin bounds bracket everything. Carry is monotonic in spin (see the
     note on liftCoefficient), so these two flights alone decide the mode:

       distance < zero-spin carry  the ball outflies the number even with no
                                   lift at all, so it never landed there —
                                   it was intercepted
       within the bracket          solvable: land it exactly on the number
       distance > max-spin carry   no backspin could carry it that far, so the
                                   number includes ground travel

     Order matters and is the opposite of what it looks like. Checking
     intercept first — "was it still airborne at `distance`?" — reads as the
     natural question, but the nominal flight overshoots most tracked
     distances, so it captured almost everything: a 428 ft home run came back
     as a catch 34 ft in the air. Carry is the common case and must be tried
     first; intercept is only for balls that beat the number with zero lift. */
  const carryAt = (rpm) => {
    const f = fly(rpm);
    return { f, carry: groundDistance(f.samples[f.samples.length - 1]) };
  };
  const spinMax = maxSpinFor(p.launchAngle);
  const lo = carryAt(0);
  const hi = carryAt(spinMax);

  // 1. INTERCEPT — it flew past the number, so the number is where it was
  // caught. Fly the nominal arc and stop there; that height is the catch.
  if (distance < lo.carry) {
    const hit = crossing(natural.samples, distance);
    if (hit) {
      return result({
        samples: truncate(natural.samples, hit),
        carry: naturalCarry,
        hangTime: natural.hangTime,
        spinRpm: nominal,
        mode: 'intercept',
        solved: true,
      });
    }
  }

  // 2. CARRY — land it exactly on the number by solving backspin.
  if (distance >= lo.carry && distance <= hi.carry) {
    let a = 0;
    let b = spinMax;
    let best = hi;
    for (let i = 0; i < 40 && b - a > 0.5; i++) {
      const mid = (a + b) / 2;
      best = carryAt(mid);
      if (best.carry < distance) a = mid;
      else b = mid;
    }
    const spinRpm = (a + b) / 2;

    /* The tracked distance is where the ball LANDED, and a play does not end
       when the ball lands — it bounces and rolls until someone picks it up.
       Ending the path at touchdown made every fly ball stop dead the instant
       it hit the grass, which is the single most unnatural thing the replay
       did. The landing point stays exactly on the tracked number; the roll
       past it is simulated, because nothing in the feed describes it. */
    const landed = best.f;
    const samples = [...landed.samples];
    const touchdown = samples[samples.length - 1];
    const out = beyondFence(park, touchdown);
    const surface = out ? SURFACES.seats : SURFACES.field;

    /* A ball caught on the fly does not roll — a fielder ended the play at the
       landing point. `caught` is an outcome the feed states outright, not a
       physics guess, which is why it is allowed to steer this when the
       trajectory label is not allowed to steer the mode. */
    if (!p.caught) {
      groundPhase(
        landed.pos,
        landed.vel,
        landed.hangTime,
        surface,
        samples,
        out ? Infinity : park.fenceDistance(thetaOf(touchdown.x, touchdown.z)),
      );
    }

    return result({
      samples,
      carry: best.carry,
      hangTime: landed.hangTime,
      trackedTime: landed.hangTime, // the number describes the landing
      spinRpm,
      rollFriction: p.caught ? 0 : surface.roll,
      mode: 'carry',
      solved: Math.abs(best.carry - distance) < 2,
    });
  }

  /* 3. CAUGHT, BUT OUT OF REACH — the feed says a fielder caught it on the
     fly, and the fielding coordinate is further out than the measured launch
     could ever carry. A caught ball never touches the ground, so it must not
     fall through to the ground mode below.

     This is common on pop-ups and it looked absurd: real data had a 67.7 mph
     ball at 80 degrees, straight up, being rolled sixty-five feet across the
     infield to reach a coordinate it could not fly to, over twelve seconds.
     Every pop-up in a sample of three real games did some version of it.

     The launch measurements are the trustworthy half here and the fielding
     coordinate on a pop-up is the loose one, so the honest answer is to fly
     the arc that was actually measured, mark it unsolved, and let the caller
     see that the two disagree rather than paper over it with a long roll. */
  if (p.caught) {
    /* `solved` has to stay worth reading. Most of these miss by four to nine
       feet, which is coordinate noise on a ball nobody measured landing —
       flagging those as failures would bury the handful that genuinely cannot
       be reconciled, like a 26 mph bunt pop-up credited to a fielder forty
       feet away. Only a miss bigger than the greater of 10 ft and 5% counts. */
    const miss = Math.abs(naturalCarry - distance);
    return result({
      samples: natural.samples,
      carry: naturalCarry,
      hangTime: natural.hangTime,
      trackedTime: natural.hangTime,
      spinRpm: nominal,
      mode: 'caught',
      solved: miss <= Math.max(10, distance * 0.05),
    });
  }

  // 4. GROUND — it lands well short of the number, so the number includes
  // bounce and roll. Solve the rolling friction that stops it there.
  const rollTo = (friction) => {
    const f = fly(nominal);
    const samples = [...f.samples];
    groundPhase(f.pos, f.vel, f.hangTime, { ...SURFACES.field, roll: friction }, samples);
    return { f, samples, total: groundDistance(samples[samples.length - 1]) };
  };

  let a = 0.02; // slick, rolls a long way
  let b = 3.0; // heavy grass, stops almost at once
  let run = rollTo(a);
  if (run.total < distance) {
    // Even a near-frictionless roll cannot reach it. Take the longest we have.
    return result({
      samples: run.samples,
      carry: naturalCarry,
      hangTime: run.f.hangTime,
      spinRpm: nominal,
      rollFriction: a,
      trackedTime: undefined, // the number is where it came to rest
      mode: 'ground',
      solved: false,
    });
  }
  for (let i = 0; i < 24 && b - a > 0.005; i++) {
    const mid = (a + b) / 2;
    run = rollTo(mid);
    if (run.total > distance) a = mid;
    else b = mid;
  }
  // Trim any overshoot so it finishes exactly on the tracked spot.
  const stop = crossing(run.samples, distance);
  const samples = stop ? truncate(run.samples, stop) : run.samples;

  return result({
    samples,
    carry: naturalCarry,
    hangTime: run.f.hangTime,
    spinRpm: nominal,
    rollFriction: (a + b) / 2,
    mode: 'ground',
    solved: true,
  });
}

/** Position on a solved path at time `t`, for the renderer. */
export function sampleAt(path, t) {
  const s = path.samples;
  if (t <= s[0].t) return s[0];
  if (t >= s[s.length - 1].t) return s[s.length - 1];
  let lo = 0;
  let hi = s.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - s[lo].t) / (s[hi].t - s[lo].t);
  return {
    t,
    x: s[lo].x + (s[hi].x - s[lo].x) * f,
    y: s[lo].y + (s[hi].y - s[lo].y) * f,
    z: s[lo].z + (s[hi].z - s[lo].z) * f,
  };
}
