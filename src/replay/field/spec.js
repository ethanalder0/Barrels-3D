/* ---------------------------------------------------------------------------
   FIELD SPEC — every dimension of a major-league field, in one place.
   ---------------------------------------------------------------------------
   Units are FEET. Not meters. Every number the backend sends is already
   feet / mph / degrees (see server/projection.py), so converting anywhere in
   this engine only creates places to drop a factor.

   WORLD AXES  (fixed for the whole engine — do not re-derive this elsewhere)

     origin  = the back point (apex) of home plate, at field level
     +Y      = up
     -Z      = toward center field
     +X      = toward the first-base / right-field side
     +Z      = toward the backstop

   That makes a camera behind home plate look down its own -Z, which is the
   broadcast shot, and it makes MLB's hit grid a direct conversion:

     worldX = (coordX - 125.42) * 2.29
     worldZ = (coordY - 203.50) * 2.29      // coordY grows toward the backstop

   Angles: `theta` is measured from the center-field line, positive toward
   first base. The foul lines are exactly +/- 45 degrees.

   SOURCES for the numbers below: MLB Official Baseball Rules 2.01 ("Layout of
   the Field") and the appended field diagrams. Anything the rulebook leaves to
   the groundskeeper (base-path width, arc radius, warning-track width, mowing)
   is marked GROUNDSKEEPING and carries the value most parks use.
--------------------------------------------------------------------------- */

export const IN = 1 / 12; // one inch, in feet

/* --- The diamond ------------------------------------------------------- */

export const BASELINE = 90; // home->1B, 1B->2B, 2B->3B, 3B->home
// Home to second is the diagonal: 127 ft 3 3/8 in. It is NOT 90*sqrt(2)
// exactly (that is 127.279); the rulebook rounds to the nearest 1/8 inch.
export const HOME_TO_SECOND = 127 + 3.375 * IN;

/* Base-corner positions: the points the 90 ft is measured to. 1B and 3B lie
   wholly inside the diamond with their outer edges on the foul lines; 2B is
   centered on its corner point. */
const DIAG = BASELINE / Math.SQRT2; // 63.64 ft
export const CORNER = {
  home: { x: 0, z: 0 },
  first: { x: DIAG, z: -DIAG },
  second: { x: 0, z: -HOME_TO_SECOND },
  third: { x: -DIAG, z: -DIAG },
};

export const BASE_SIDE = 18 * IN; // 18 in square as of the 2023 rules (was 15)
export const BASE_THICK = 3 * IN;

/* --- Home plate --------------------------------------------------------- */

/* A pentagon: a 17 in edge facing the pitcher, two 8.5 in sides, and two 12 in
   sides that meet at the apex. The apex is the origin and the plate extends
   toward -Z (toward the mound). The two 12 in sides meet at a right angle, so
   each covers 12/sqrt(2) = 8.485 in of depth and of width — which is where the
   17 in front edge comes from. */
export const PLATE_WIDTH = 17 * IN;
const PLATE_POINT_DEPTH = (12 * IN) / Math.SQRT2; // 8.485 in
export const PLATE_DEPTH = PLATE_POINT_DEPTH + 8.5 * IN;
export const PLATE_OUTLINE = [
  { x: 0, z: 0 }, // apex — the origin, and what every distance is measured from
  { x: PLATE_WIDTH / 2, z: -PLATE_POINT_DEPTH },
  { x: PLATE_WIDTH / 2, z: -PLATE_DEPTH },
  { x: -PLATE_WIDTH / 2, z: -PLATE_DEPTH },
  { x: -PLATE_WIDTH / 2, z: -PLATE_POINT_DEPTH },
];
/* The "center of home plate" the batter's boxes are laid out from is the
   midpoint of its depth, not the apex. */
export const PLATE_CENTER_Z = -PLATE_DEPTH / 2;

/* --- The mound ---------------------------------------------------------- */

export const RUBBER_FRONT = 60.5; // home apex -> front edge of the rubber
export const RUBBER_WIDTH = 24 * IN;
export const RUBBER_DEPTH = 6 * IN;

export const MOUND_RADIUS = 9; // 18 ft diameter circle
export const MOUND_CENTER_Z = -59; // 59 ft from home: the rubber sits 18 in behind it
export const MOUND_HEIGHT = 10 * IN; // above the level of home plate

/* The level table the rubber is set into: 5 ft wide, 34 in deep, starting
   6 in in front of the rubber's front edge. */
export const TABLE_HALF_WIDTH = 2.5;
export const TABLE_FRONT_Z = -(RUBBER_FRONT - 6 * IN); // -60.0
export const TABLE_BACK_Z = TABLE_FRONT_Z - 34 * IN; // -62.833

/* Rule 2.01: from 6 in in front of the rubber, the mound falls 1 in per foot
   toward home for 6 ft. Extended at that same grade it reaches field level at
   exactly 10 ft — which is precisely the front rim of the 18 ft circle. The
   front of a mound really is one 1:12 plane; that is not an approximation.
   moundHeight() below is built on it. */

/* --- Dirt / grass boundaries (GROUNDSKEEPING) --------------------------- */

/* The outer edge of the infield skin: an arc struck from the pitcher's plate,
   meeting both foul lines. 95 ft is the standard, and it puts the grass line
   about 38 ft past first base down the line. */
export const INFIELD_ARC_RADIUS = 95;
export const INFIELD_ARC_CENTER_Z = -RUBBER_FRONT;

/* The dirt path between bases: 6 ft wide, centered on the baseline. Half of it
   lies inside the 90 ft square, which is why the infield grass reads as that
   square inset by 3 ft. Everything outside the square is skin already. */
export const BASE_PATH_WIDTH = 6;
export const GRASS_INSET = BASE_PATH_WIDTH / 2;

/* The dirt circle around home. 26 ft across; it genuinely spills into foul
   territory on both sides, which is why it is drawn as a full circle. */
export const HOME_CIRCLE_RADIUS = 13;

export const ON_DECK_RADIUS = 2.5; // 5 ft circles, in foul territory
export const WARNING_TRACK = 15; // ft, inside every wall

/* --- Chalk -------------------------------------------------------------- */

export const CHALK_WIDTH = 4 * IN;
export const BATTERS_BOX = { width: 4, length: 6, offsetFromPlate: 6 * IN };
export const CATCHERS_BOX = { width: 43 * IN, length: 8 };
/* The runner's lane: 3 ft wide, in foul territory, from the midpoint of the
   home-to-first line to the base. */
export const RUNNERS_LANE = { width: 3, start: 45, end: BASELINE };
export const COACH_BOX = { length: 20, width: 10, offsetFromLine: 15, start: 68 };

/* --- The park ----------------------------------------------------------- */

/* Everything above this line is the rulebook and is the same in all thirty
   parks. The outfield wall, its height, the backstop distance and the amount of
   foul ground are not — they live in park.js, built from the measured
   dimensions in src/data/parks.js, and reach this engine as a park object
   passed to buildField(). Nothing here may hardcode them.

   Two heights stay here because the sheet measures neither and every park
   looks the same in both: a foul pole, and the low wall along the sides of foul
   ground. A park's tall wall stops at its foul pole. */
export const FOUL_POLE_HEIGHT = 45;
export const FOUL_WALL_HEIGHT = 8;

/* --- The ground texture ------------------------------------------------- */

/* One square of canvas covers the whole park, painted top-down in field units.
   Home plate is at world (0,0), so the square runs from behind the backstop to
   past the center-field wall. */
export const GROUND = { span: 520, centerZ: -200, texture: 4096 };

/* --- Palette ------------------------------------------------------------ */

export const COLORS = {
  grass: '#4a8b3d',
  grassLight: '#53984a',
  grassDark: '#407b36',
  infieldGrass: '#4a8b3d',
  dirt: '#a2623a',
  dirtLight: '#ad6d45',
  warningTrack: '#8b5233',
  chalk: '#f4f2ec',
  base: '#f2f0ea',
  rubber: '#f2f0ea',
  wall: '#23472f',
  wallTop: '#e8c53a',
  beyond: '#2b3a2e',
};

/* ---------------------------------------------------------------------------
   Derived helpers. Anything that needs one of the numbers above should call
   these rather than recompute — one source is the whole point of the file.
--------------------------------------------------------------------------- */

/** theta (deg, 0 = center field, + toward first base) + distance -> world point. */
export function polar(thetaDeg, distance) {
  const r = (thetaDeg * Math.PI) / 180;
  return { x: Math.sin(r) * distance, z: -Math.cos(r) * distance };
}

/** World ground point -> theta in degrees. */
export function thetaOf(x, z) {
  return (Math.atan2(x, -z) * 180) / Math.PI;
}

/** MLB hit-grid coordinates -> world ground point. */
export function fromHitGrid(coordX, coordY) {
  return { x: (coordX - 125.42) * 2.29, z: (coordY - 203.5) * 2.29 };
}

/**
 * Height of the mound surface above field level at a world ground point.
 * Returns 0 everywhere outside the 18 ft circle.
 *
 * The front (home-plate side) is the rulebook's 1 in per foot plane. The sides
 * and back fall away from the edges of the level table over whatever run each
 * has left to the rim, which is what a groundskeeper's slope board produces.
 */
export function moundHeight(x, z) {
  const dz = z - MOUND_CENTER_Z;
  if (x * x + dz * dz > MOUND_RADIUS * MOUND_RADIUS) return 0;

  // How far past each edge of the level table this point lies.
  const front = Math.max(0, z - TABLE_FRONT_Z); // toward home (+Z)
  const back = Math.max(0, TABLE_BACK_Z - z);
  const side = Math.max(0, Math.abs(x) - TABLE_HALF_WIDTH);

  const FRONT_RUN = MOUND_CENTER_Z + MOUND_RADIUS - TABLE_FRONT_Z; // 10 ft -> 1 in/ft
  const BACK_RUN = TABLE_BACK_Z - (MOUND_CENTER_Z - MOUND_RADIUS); // 5.17 ft
  const SIDE_RUN = MOUND_RADIUS - TABLE_HALF_WIDTH; // 6.5 ft

  const fall = front / FRONT_RUN + back / BACK_RUN + side / SIDE_RUN;
  return MOUND_HEIGHT * Math.max(0, 1 - fall);
}

/**
 * Center of each bag, as world points.
 *
 * A bag's sides run parallel to the two baselines that meet at it, and every
 * baseline is at 45 degrees, so every bag is rotated 45 degrees from the world
 * axes — its corners point along +/-X and +/-Z. First and third are placed
 * with that outward-pointing corner ON the 90 ft corner point and the rest of
 * the bag inside the diamond, which pulls their centers half a diagonal in
 * along X. Second is centered on its corner point and straddles it.
 */
export const BASE_ROTATION = Math.PI / 4;
export function basePositions() {
  const half = (BASE_SIDE * Math.SQRT2) / 2; // half the bag's diagonal
  return {
    first: { x: CORNER.first.x - half, z: CORNER.first.z },
    second: { x: CORNER.second.x, z: CORNER.second.z },
    third: { x: CORNER.third.x + half, z: CORNER.third.z },
  };
}
