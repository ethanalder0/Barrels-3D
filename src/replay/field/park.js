/* ---------------------------------------------------------------------------
   PARK — the half of a ballpark that is different in every ballpark.
   ---------------------------------------------------------------------------
   spec.js holds the rulebook: the diamond, the mound, the plate, the chalk.
   Those are identical in all thirty parks and no park record may override them.
   Everything that DOES vary lives here, behind one object:

     · the outfield wall, as distance and height by angle
     · how far back the backstop sits
     · how much foul ground there is, and therefore where the side walls run
     · which way the park points, and therefore where the sun is

   Nothing else in the engine reads src/data/parks.js. It reads a park built
   here, so the generated data can change shape without every consumer caring.

   Angles are the engine's: theta = 0 is the center-field line, positive toward
   first base, foul lines at +/-45. Distances are feet.
--------------------------------------------------------------------------- */

import { polar } from './spec.js';
import { PARKS, PARK_BY_TEAM, venueKey, venueMatch } from '../../data/parks.js';
import { OUTLINES } from './outlines.js';

/* The park the engine falls back to: a plausible symmetric one, and the exact
   geometry this engine drew before any of the real parks existed. It is what
   an unknown venue gets, so an unrecognised game still renders a ballpark. */
export const GENERIC = {
  key: 'generic',
  name: 'Ballpark',
  fence: [
    { theta: -45, distance: 330 },
    { theta: -22.5, distance: 365 },
    { theta: 0, distance: 400 },
    { theta: 22.5, distance: 365 },
    { theta: 45, distance: 330 },
  ],
  wallHeight: { left: 8, center: 8, right: 8 },
  backstop: 60,
  foulArea: null, // no listed area: the side walls fall back to the tangent
  azimuth: 45,
  fairArea: null,
};

/* Where the sun is put, as a compass bearing and an elevation.

   Held as a COMPASS bearing rather than a world direction, because that is the
   only way it can mean the same thing in two parks that face different ways. A
   park's `azimuth` says which compass bearing center field lies on, so the sun's
   world direction is the difference between the two — and a park turned 90
   degrees from its neighbour gets shadows turned 90 degrees with it, which is
   most of what makes one real park look unlike another from the same seat.

   These values reproduce the engine's previous fixed sun exactly at a park
   facing northeast, which is where it was hand-placed for. */
const SUN = { bearing: 296, elevation: 29, distance: 313 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (u) => u * u * (3 - 2 * u);

/* Half the angular width of a wall-height step, in degrees. At 385 ft the pair
   lands 1.7 inches apart, which is a real quad the renderer is happy with and
   still vertical to the eye. See outfieldAngles. */
const STEP_EPS = 0.01;

/* --- Interpolating the wall --------------------------------------------- */

/**
 * Wall distance between two samples, smoothly.
 *
 * Used for a park described by the five posted distances. Five samples of a
 * curve are not a polygon, and joining them with straight chords puts a kink at
 * every marker that no park has; smoothstep gives a wall with no corners, which
 * is what a five-number description actually justifies claiming.
 */
function smoothAt(theta, a, b) {
  const u = (theta - a.theta) / (b.theta - a.theta);
  return a.distance + (b.distance - a.distance) * smoothstep(u);
}

/**
 * Wall distance between two samples, along the straight line joining them.
 *
 * Used for a hand-authored outline, where the samples are the actual corners of
 * an actual wall and the runs between them really are straight. Smoothing those
 * would round off the one thing the outline was written to capture.
 *
 * Solves for where the ray at `theta` crosses the segment; both endpoints are
 * in front of home and the wall never doubles back on an angle, so the ray
 * always meets it exactly once.
 */
function chordAt(theta, a, b) {
  const p0 = polar(a.theta, a.distance);
  const p1 = polar(b.theta, b.distance);
  const d = polar(theta, 1);
  const ex = p1.x - p0.x;
  const ez = p1.z - p0.z;
  const den = d.x * ez - d.z * ex;
  if (Math.abs(den) < 1e-9) return a.distance;
  return (p0.x * ez - p0.z * ex) / den;
}

/* --- Foul territory ----------------------------------------------------- */

/**
 * The side walls, and how the listed foul area sets them.
 *
 * Each side wall is the tangent from its foul pole to a circle of radius
 * `setback` centred on home, and behind the plate the boundary eases from that
 * radius to the backstop distance. The tangent is what keeps the corner at the
 * foul pole sharp and the join behind the dugout smooth — a wall run parallel
 * to the foul line instead leaves a concave notch where it meets the arc, which
 * no park has.
 *
 * `setback` is the one free number in the construction, and it is what the
 * listed foul area buys us. Foul ground is the single most visible difference
 * between two ballparks — the Coliseum has 40,700 sq ft of it and Fenway 18,100,
 * and their backstops are 53 and 54 ft, so nothing about the backstop can
 * explain the gap. Solving the setback against the listed area is the only way
 * that difference gets into the geometry at all.
 */
function foulWallAngle(setback, lineDistance) {
  // Right triangle home-tangent-pole, right angle at the tangent point.
  return 45 + (Math.acos(clamp(setback / lineDistance, -1, 1)) * 180) / Math.PI;
}

/** Boundary radius in foul ground, from the tangent point around behind home.
 *
 * Easing from the setback to the backstop distance rather than joining them
 * with a corner: the tangent line meets its circle at a right angle to the
 * radius, so a blend that leaves the tangent point with no radial slope — which
 * smoothstep does — continues the wall smoothly instead of kinking it. */
function foulRadius(absTheta, tangentAngle, setback, backstop) {
  if (absTheta <= tangentAngle) return setback;
  const u = (absTheta - tangentAngle) / (180 - tangentAngle);
  return setback + (backstop - setback) * smoothstep(u);
}

/** An angle in degrees folded into [-180, 180). */
const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

/* --- Building one park --------------------------------------------------- */

/**
 * A park record (from src/data/parks.js, or a hand-authored outline) -> the
 * object the rest of the engine uses.
 *
 * Everything expensive — the setback solve, the boundary polyline — is done
 * once here, because a park changes between games and never during one.
 */
export function createPark(data = GENERIC) {
  const wall = [...data.fence].sort((a, b) => a.theta - b.theta);
  // A hand-authored outline names the wall's real corners; the five posted
  // distances only sample a curve. See smoothAt/chordAt.
  const authored = data.authored === true;
  const heights = data.wallHeight || {};

  /** Wall distance at any angle, in feet. */
  function fenceDistance(theta) {
    const t = clamp(theta, wall[0].theta, wall[wall.length - 1].theta);
    for (let i = 0; i < wall.length - 1; i++) {
      const a = wall[i];
      const b = wall[i + 1];
      if (t >= a.theta && t <= b.theta) {
        return authored ? chordAt(t, a, b) : smoothAt(t, a, b);
      }
    }
    return wall[wall.length - 1].distance;
  }

  /* --- Wall height ------------------------------------------------------
     A ZONE MODEL, NOT A CURVE.

     Wall height used to be interpolated between the listed heights, which drew
     a wall that ramps continuously from one number to the next — 8 ft in
     centre easing up to 25 at the right-field pole across the whole of
     right-centre. Almost no ballpark is built that way. A park's wall is a run
     of flat panels of one height, and where the height changes it changes at a
     seam, all at once: the Monster ends and the centre-field wall starts, the
     bullpen fence begins, a scoreboard section is taller than the fence beside
     it. The step is the landmark. Sloping it away loses the one feature of a
     wall a hitter would name, and invents a shape the park does not have.

     So height is held as zones — each a span of angle at ONE height — and
     `steps` records the angles between them. The step itself is drawn as a
     vertical jump; see buildWalls in field.js, which uses `steps` to put two
     wall samples either side of each seam.

     AUTHORED PARKS (outlines.js). A corner's height is the height of the wall
     run that ARRIVES at it, so a zone takes the height of the corner it ends
     on. That is how the outlines are written: Fenway's -7.5 corner is where
     the Monster ends, and its 37 ft belongs to everything back to the pole, not
     to the centre-field wall beyond it.

     EVERY OTHER PARK has the three the sheet lists — at the two foul lines and
     at centre — so it gets three zones, stepping at the power alleys. Nothing
     in three numbers says where a seam is, and +/-22.5 is the one choice the
     data itself suggests: it is where the other numbers are measured, and it
     gives left and right field the quarter of the outfield each that their own
     number describes. */
  const DEFAULT_HEIGHT = 8;

  function heightZones() {
    if (wall.some((p) => p.height != null)) {
      const fallback = heights.center ?? DEFAULT_HEIGHT;
      return wall.slice(0, -1).map((a, i) => ({
        from: a.theta,
        to: wall[i + 1].theta,
        height: wall[i + 1].height ?? a.height ?? fallback,
      }));
    }
    const left = heights.left ?? DEFAULT_HEIGHT;
    const center = heights.center ?? DEFAULT_HEIGHT;
    const right = heights.right ?? DEFAULT_HEIGHT;
    return [
      { from: -45, to: -22.5, height: left },
      { from: -22.5, to: 22.5, height: center },
      { from: 22.5, to: 45, height: right },
    ];
  }

  const zones = heightZones();

  /* Only the seams where the height actually changes. A park with one height
     all the way round has no steps, and must not get a seam drawn at a power
     alley just because the zones meet there. */
  const steps = zones
    .slice(1)
    .filter((z, i) => z.height !== zones[i].height)
    .map((z) => z.from);

  /** Wall height at any angle, in feet. Flat within a zone, by construction. */
  function fenceHeight(theta) {
    const t = clamp(theta, -45, 45);
    for (const z of zones) {
      if (t >= z.from && t <= z.to) return z.height;
    }
    return zones[zones.length - 1].height;
  }

  const backstop = data.backstop ?? GENERIC.backstop;
  const lineLeft = fenceDistance(-45);
  const lineRight = fenceDistance(45);

  /* --- The boundary ---------------------------------------------------- */

  /**
   * The whole playing surface, as one closed run of ground points: backstop
   * arc, both foul walls, then the outfield wall.
   *
   * Ordering is the contract the painter and the wall mesh both rely on — it
   * starts behind home on the third-base side, walks the long way around behind
   * the plate, out to the right-field pole, and back along the wall to the left.
   */
  function boundary(setback, step = 1) {
    const angleLeft = foulWallAngle(setback, lineLeft);
    const angleRight = foulWallAngle(setback, lineRight);
    const pts = [];

    // Behind home: from the third-base tangent point, backward through 180 and
    // on to the first-base one. Each half eases from its own tangent angle, so
    // a park with unequal foul lines gets the right shape on both sides.
    for (let a = -angleLeft; a > -360 + angleRight + 1e-9; a -= step) {
      const folded = wrap(a);
      const side = folded < 0 ? angleLeft : angleRight;
      pts.push(polar(a, foulRadius(Math.abs(folded), side, setback, backstop)));
    }
    pts.push(polar(angleRight, setback));
    pts.push(polar(45, lineRight)); // right-field foul pole
    for (const t of outfieldAngles(step)) pts.push(polar(t, fenceDistance(t)));
    pts.push(polar(-angleLeft, setback));
    return pts;
  }

  /* The angles the outfield wall is sampled at, from the right-field pole round
     to the left, plus a PAIR either side of every height step.

     The pair is what makes a step a step. The wall mesh is a ribbon joining
     consecutive samples, so two samples a half-degree apart with different
     heights would be joined by a quad that ramps between them — at 400 ft,
     a 3 ft long slope, which is the gradual change this is meant to remove.
     Bracketing the seam at +/-STEP_EPS puts the whole height change into one
     quad a couple of inches wide — Oracle Park's 17 ft step in right field
     comes out 1.7 in across — which is vertical to look at from anywhere a
     camera goes, and still real geometry rather than the degenerate zero-width
     quad that sharing one sample would give (whose normals come back as
     nothing and render as a dark seam). */
  function outfieldAngles(step = 0.5) {
    const angles = [];
    for (let t = 45; t >= -45 - 1e-9; t -= step) angles.push(t);
    for (const seam of steps) {
      if (seam <= -45 || seam >= 45) continue; // a seam at the pole has no riser
      angles.push(seam + STEP_EPS, seam - STEP_EPS);
    }
    return [...new Set(angles)].sort((a, b) => b - a);
  }

  /* --- Areas ----------------------------------------------------------- */

  /** Fair territory: 1/2 r^2 dtheta between the foul lines, in sq ft. */
  function fairArea(steps = 2000) {
    const span = Math.PI / 2;
    let total = 0;
    for (let i = 0; i < steps; i++) {
      const theta = -45 + (90 * (i + 0.5)) / steps;
      total += 0.5 * fenceDistance(theta) ** 2 * (span / steps);
    }
    return total;
  }

  /** Signed area of a closed ground polygon, by the shoelace. */
  function polygonArea(pts) {
    let total = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      total += a.x * b.z - b.x * a.z;
    }
    return Math.abs(total) / 2;
  }

  const fair = fairArea();
  const foulAreaFor = (setback) => polygonArea(boundary(setback, 2)) - fair;

  /**
   * Solve the setback against the listed foul area, by bisection.
   *
   * Foul ground grows monotonically with the setback, so this always converges.
   * A park with no listed area keeps the tangent-to-the-backstop construction
   * the engine used before, which is the setback equal to the backstop distance.
   */
  let setback = backstop;
  let foulSolved = false;
  if (data.foulArea) {
    let lo = 5;
    let hi = Math.min(lineLeft, lineRight) - 5;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (foulAreaFor(mid) < data.foulArea) lo = mid;
      else hi = mid;
    }
    setback = (lo + hi) / 2;
    foulSolved = Math.abs(foulAreaFor(setback) - data.foulArea) / data.foulArea < 0.01;
  }

  /* --- The sun ---------------------------------------------------------- */

  /* Compass bearing -> a world direction, given which way this park faces.
     Center field lies on `azimuth`, and world clockwise from center field seen
     from above is the same sense as compass clockwise from north, so the whole
     conversion is one rotation by the difference. */
  const azimuth = data.azimuth ?? GENERIC.azimuth;
  const phi = ((SUN.bearing - azimuth) * Math.PI) / 180;
  const elevation = (SUN.elevation * Math.PI) / 180;
  const sun = {
    x: Math.sin(phi) * SUN.distance * Math.cos(elevation),
    y: Math.sin(elevation) * SUN.distance,
    z: -Math.cos(phi) * SUN.distance * Math.cos(elevation),
  };

  return {
    key: data.key || 'generic',
    name: data.name || 'Ballpark',
    team: data.team ?? null,
    retired: data.retired === true,
    capacity: data.capacity ?? null,

    fenceDistance,
    fenceHeight,
    /* Where the wall's height changes, in engine degrees. Empty for a park of
       one height all the way round. */
    heightSteps: steps,
    boundary: (step) => boundary(setback, step),

    backstop,
    setback,
    azimuth,
    bearing: data.bearing ?? null,
    sun,

    /* What the geometry came out as, next to what the sheet listed. Kept on the
       park rather than computed by callers so the lab panel and the self-test
       read the same numbers the field was built from. */
    fairArea: fair,
    foulArea: foulAreaFor(setback),
    listedFairArea: data.fairArea ?? null,
    listedFoulArea: data.foulArea ?? null,
    foulSolved,
    authored,
  };
}

/* --- Lookup -------------------------------------------------------------- */

/* A hand-authored outline replaces the generated record's wall outright, and
   keeps everything else the sheet lists. See outlines.js for when that is
   worth doing. */
function withOutline(data) {
  const outline = OUTLINES[data.key];
  return outline ? { ...data, ...outline, authored: true } : data;
}

/** Every park, built, in name order. The lab's picker is the only real user. */
export function allParks() {
  return Object.values(PARKS)
    .map((data) => createPark(withOutline(data)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One park by its venue key, or null. */
export function parkByKey(key) {
  const data = PARKS[venueKey(key)];
  return data ? createPark(withOutline(data)) : null;
}

/**
 * The park a game is played in.
 *
 * Venue name first, since that is what the feed states outright; the home
 * club's park second, which covers a venue the sheet spells differently; and
 * the generic park last, so an unknown venue still renders something.
 */
export function parkFor(venue, teamAbbr) {
  const matched = venueMatch(venue);
  if (matched) return createPark(withOutline(PARKS[matched]));
  const key = teamAbbr && PARK_BY_TEAM[teamAbbr.toUpperCase()];
  if (key && PARKS[key]) return createPark(withOutline(PARKS[key]));
  return createPark(GENERIC);
}
