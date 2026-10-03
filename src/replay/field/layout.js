/* ---------------------------------------------------------------------------
   FIELD LAYOUT — the playing surface, painted top-down in real feet.
   ---------------------------------------------------------------------------
   Why a painted texture instead of one mesh per surface:

   Grass, dirt, chalk and the warning track are not separate objects on a real
   field. They are one graded plane with different material on top of it. Model
   them as overlapping coplanar meshes and you inherit z-fighting on every
   boundary, seams wherever two arcs are tessellated differently, and a CSG
   problem at the base cutouts. Painted in 2D they are just fills in the right
   order, and the boundaries are exact by construction.

   It also means the layout is inspectable: `paintField` draws into any 2D
   context, so the same code that textures the ground can dump a PNG you can
   look at and check against a photograph.

   The one thing that is NOT flat is the mound, and that is real geometry
   (see field.js) driven by spec.moundHeight().

   Canvas mapping: px = (x - X_MIN) * k, py = (Z_MAX - z) * k. Home plate ends
   up near the top of the image and center field at the bottom. The ground mesh
   samples this with `flipY = false` so uv (0,0) is the top-left — see field.js.
--------------------------------------------------------------------------- */

import * as S from './spec.js';
import { createPark } from './park.js';

/* Painting with no park named gets the generic one, so a caller that only
   wants to look at the rulebook geometry need not invent a stadium. */
const DEFAULT_PARK = createPark();

/* The whole park. A region is any square of world feet the painter should
   cover; painting a smaller one at the same pixel size is how the detail
   texture near home plate gets its resolution (see field.js). */
export const FULL_REGION = {
  centerX: 0,
  centerZ: S.GROUND.centerZ,
  span: S.GROUND.span,
};

/** Build the drawing helpers for a canvas of `size` px covering `region`. */
function frame(ctx, size, region) {
  const k = size / region.span;
  const xMin = region.centerX - region.span / 2;
  const zMax = region.centerZ + region.span / 2;
  const px = (x) => (x - xMin) * k;
  const py = (z) => (zMax - z) * k;
  const ft = (f) => f * k;

  /** Trace a list of {x, z} points as a path. */
  const trace = (pts, close = true) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(px(p.x), py(p.z)) : ctx.moveTo(px(p.x), py(p.z))));
    if (close) ctx.closePath();
  };

  const circle = (x, z, r) => {
    ctx.beginPath();
    ctx.arc(px(x), py(z), ft(r), 0, Math.PI * 2);
  };

  return { k, px, py, ft, trace, circle };
}

/* --- Shapes, all in world feet ------------------------------------------ */

/* The outfield wall, the foul walls and the backstop are no longer built here.
   They are the park, not the layout, and park.js owns them — `park.boundary()`
   returns the same closed run of ground points this file used to construct, in
   the same order, so everything below is unchanged apart from being handed the
   shape instead of deriving it. */

/** The four dirt paths between the bases: 6 ft wide, centered on the baseline. */
function basePaths() {
  const c = S.CORNER;
  const legs = [
    [c.home, c.first],
    [c.first, c.second],
    [c.second, c.third],
    [c.third, c.home],
  ];
  const h = S.BASE_PATH_WIDTH / 2;
  return legs.map(([a, b]) => {
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const d = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
    const n = { x: d.z, z: -d.x };
    // Stop exactly at the corner points. Overrunning them squares the corner
    // off, which reads as a tab of dirt poking across the foul line past the
    // bag; every corner a leg ends at is already inside the skin or the home
    // circle, so there is nothing for the overrun to cover.
    return [
      { x: a.x + n.x * h, z: a.z + n.z * h },
      { x: b.x + n.x * h, z: b.z + n.z * h },
      { x: b.x - n.x * h, z: b.z - n.z * h },
      { x: a.x - n.x * h, z: a.z - n.z * h },
    ];
  });
}

/** The infield skin: the 95 ft arc, closed off by the two foul lines. */
function infieldSkin() {
  const R = S.INFIELD_ARC_RADIUS;
  const cz = S.INFIELD_ARC_CENTER_Z;
  // Where the arc crosses a foul line: t^2 + sqrt(2)*cz*t + cz^2 - R^2 = 0.
  const t = (-Math.SQRT2 * cz + Math.sqrt(4 * R * R - 2 * cz * cz)) / 2;

  const end = S.polar(45, t);
  const a1 = Math.atan2(end.z - cz, end.x); // right-field end of the arc
  const a0 = Math.PI - a1 - Math.PI * 2; // its mirror, going the outfield way

  const pts = [S.CORNER.home, S.polar(-45, t)];
  for (let a = a0; a <= a1 + 1e-9; a += Math.PI / 180) {
    pts.push({ x: Math.cos(a) * R, z: cz + Math.sin(a) * R });
  }
  pts.push(end);
  return pts;
}

/**
 * The infield grass: the 90 ft square inset by half a base path. On a real
 * field the base paths are 6 ft wide and centered on the baselines, and
 * everything outside the square is skin already — so the grass is exactly the
 * square pulled in 3 ft. For a square, insetting each edge by d moves each
 * corner d*sqrt(2) along its own diagonal.
 */
function infieldGrass() {
  const c = S.CORNER;
  const center = { x: 0, z: (c.home.z + c.second.z) / 2 };
  const pull = S.GRASS_INSET * Math.SQRT2;
  return [c.home, c.first, c.second, c.third].map((p) => {
    const dx = center.x - p.x;
    const dz = center.z - p.z;
    const len = Math.hypot(dx, dz);
    return { x: p.x + (dx / len) * pull, z: p.z + (dz / len) * pull };
  });
}

/* --- Painting ----------------------------------------------------------- */

/* One mow width for the whole field, infield grass included. */
const MOW_WIDTH = 18;

/** Alternating mow bands, perpendicular to the center-field line. */
function mowStripes(ctx, f, width, light, dark) {
  for (let z = 60, i = 0; z > -470; z -= width, i++) {
    ctx.fillStyle = i % 2 ? light : dark;
    ctx.fillRect(0, f.py(z), ctx.canvas.width, f.ft(width) + 1);
  }
}

/** A stroked chalk line through a list of world points. */
function chalk(ctx, f, pts, close = false) {
  ctx.strokeStyle = S.COLORS.chalk;
  ctx.lineWidth = f.ft(S.CHALK_WIDTH);
  ctx.lineCap = 'butt';
  f.trace(pts, close);
  ctx.stroke();
}

function paintChalk(ctx, f, park) {
  // Batter's boxes: 4 x 6, their inside edge 6 in off the plate, centered on
  // the midpoint of the plate's depth (not on its apex).
  const b = S.BATTERS_BOX;
  const inner = S.PLATE_WIDTH / 2 + b.offsetFromPlate;
  const zf = S.PLATE_CENTER_Z + b.length / 2;
  const zb = S.PLATE_CENTER_Z - b.length / 2;

  /* Foul lines: out to the fence, but starting where they clear the batter's
     box rather than at the apex of the plate.

     Run at 45 degrees from the origin and the line cuts straight through the
     corner of both boxes, which no groundskeeper draws — the box is the chalk
     in that area and the foul line picks up outside it. The ray is inside the
     box between x = inner and x = inner + width, and above z = zb; whichever
     of those it leaves first is where the line starts. */
  const exit = Math.min((inner + b.width) * Math.SQRT2, -zb * Math.SQRT2);
  for (const sign of [-1, 1]) {
    chalk(ctx, f, [
      S.polar(sign * 45, exit),
      S.polar(sign * 45, park.fenceDistance(sign * 45)),
    ]);
  }
  for (const sign of [-1, 1]) {
    chalk(
      ctx,
      f,
      [
        { x: sign * inner, z: zf },
        { x: sign * (inner + b.width), z: zf },
        { x: sign * (inner + b.width), z: zb },
        { x: sign * inner, z: zb },
      ],
      true,
    );
  }

  // Catcher's box: 43 in wide, 8 ft deep, open toward the plate.
  const cb = S.CATCHERS_BOX;
  chalk(ctx, f, [
    { x: -cb.width / 2, z: zf },
    { x: -cb.width / 2, z: zf + cb.length },
    { x: cb.width / 2, z: zf + cb.length },
    { x: cb.width / 2, z: zf },
  ]);

  // Runner's lane: 3 ft outside the first-base line, from the midpoint to the
  // bag, with a connector at each end. The foul line is its inside edge.
  const rl = S.RUNNERS_LANE;
  const dir = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
  const out = { x: Math.SQRT1_2, z: Math.SQRT1_2 };
  const lane = (t, w) => ({ x: dir.x * t + out.x * w, z: dir.z * t + out.z * w });
  chalk(ctx, f, [lane(rl.start, 0), lane(rl.start, rl.width)]);
  chalk(ctx, f, [lane(rl.start, rl.width), lane(rl.end, rl.width)]);
  chalk(ctx, f, [lane(rl.end, rl.width), lane(rl.end, 0)]);

  // Coach's boxes, both sides.
  const cx = S.COACH_BOX;
  for (const sign of [-1, 1]) {
    const d = { x: sign * Math.SQRT1_2, z: -Math.SQRT1_2 };
    const o = { x: sign * Math.SQRT1_2, z: Math.SQRT1_2 };
    const at = (t, w) => ({ x: d.x * t + o.x * w, z: d.z * t + o.z * w });
    chalk(
      ctx,
      f,
      [
        at(cx.start, cx.offsetFromLine),
        at(cx.start + cx.length, cx.offsetFromLine),
        at(cx.start + cx.length, cx.offsetFromLine + cx.width),
        at(cx.start, cx.offsetFromLine + cx.width),
      ],
      true,
    );
  }
}

/** Fine mottling, so nothing reads as a flat vector fill up close. */
function paintNoise(ctx, size) {
  const tile = document.createElement('canvas');
  tile.width = tile.height = 256;
  const tctx = tile.getContext('2d');
  const img = tctx.createImageData(256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 110 + Math.random() * 36;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

/**
 * Paint the whole surface. Order is the whole trick — each fill is simply
 * drawn over the last, so no boolean geometry is ever needed:
 *
 *   beyond -> grass + mow -> warning track -> infield skin -> infield grass
 *   -> home circle -> mound circle -> on-deck circles -> chalk -> noise
 */
export function paintField(ctx, size, region = FULL_REGION, park = DEFAULT_PARK) {
  const f = frame(ctx, size, region);

  ctx.fillStyle = S.COLORS.beyond;
  ctx.fillRect(0, 0, size, size);

  const bounds = park.boundary();

  // Everything inside the walls is grass to begin with, mown in bands.
  ctx.save();
  f.trace(bounds);
  ctx.clip();
  mowStripes(ctx, f, MOW_WIDTH, S.COLORS.grassLight, S.COLORS.grassDark);

  // The warning track is a band on the inside of the wall. Stroking the
  // boundary at twice its width and letting the clip discard the outer half
  // gives an exact 15 ft inset around an arbitrary shape.
  ctx.strokeStyle = S.COLORS.warningTrack;
  ctx.lineWidth = f.ft(S.WARNING_TRACK * 2);
  ctx.lineJoin = 'round';
  f.trace(bounds);
  ctx.stroke();
  ctx.restore();

  // Infield skin.
  ctx.fillStyle = S.COLORS.dirt;
  f.trace(infieldSkin());
  ctx.fill();

  // The grass diamond inside it. Same mow width and phase as the outfield, so
  // the bands run unbroken across the dirt — which is what mowing one field in
  // one pass produces, and reads wrong the moment it does not line up.
  ctx.save();
  f.trace(infieldGrass());
  ctx.clip();
  ctx.fillStyle = S.COLORS.infieldGrass;
  ctx.fillRect(0, 0, size, size);
  mowStripes(ctx, f, MOW_WIDTH, S.COLORS.grassLight, S.COLORS.grassDark);
  ctx.restore();

  // Dirt cut back into that grass. The base paths are 6 ft wide and centered on
  // the baselines, so half of each lies outside the 90 ft square — for the legs
  // to first and third that half is in foul ground, and it belongs there.
  ctx.fillStyle = S.COLORS.dirt;
  for (const path of basePaths()) {
    f.trace(path);
    ctx.fill();
  }
  // Home and the mound. The home circle is why the infield grass has no corner
  // at the plate.
  f.circle(0, 0, S.HOME_CIRCLE_RADIUS);
  ctx.fill();
  f.circle(0, S.MOUND_CENTER_Z, S.MOUND_RADIUS);
  ctx.fill();

  // On-deck circles, in foul territory either side of the plate.
  for (const sign of [-1, 1]) {
    f.circle(sign * 38, 6, S.ON_DECK_RADIUS);
    ctx.fill();
  }

  paintChalk(ctx, f, park);
  paintNoise(ctx, size);
}

/** The painted surface as a canvas, ready for CanvasTexture. */
export function fieldCanvas(size = S.GROUND.texture, region = FULL_REGION, park = DEFAULT_PARK) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  paintField(canvas.getContext('2d'), size, region, park);
  return canvas;
}

/**
 * Fade a canvas out towards its edges.
 *
 * A detail texture laid over the base one has a hard border where the sharp
 * pixels stop, and the eye finds that edge instantly. Fading the alpha over
 * the outer fifth hides the join: the middle is entirely the detail texture,
 * the rim is entirely the base, and nothing in between announces itself.
 */
export function fadeEdges(canvas, inner = 0.3, outer = 0.5) {
  const ctx = canvas.getContext('2d');
  const s = canvas.width;
  const gradient = ctx.createRadialGradient(s / 2, s / 2, s * inner, s / 2, s / 2, s * outer);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, s, s);
  ctx.restore();
  return canvas;
}
