/* ---------------------------------------------------------------------------
   BALL — the mesh, its trail, and where it ends up.
   ---------------------------------------------------------------------------
   Everything here is display. The path it follows was already decided by
   trajectory.js, which knows nothing about Three.js; this file only reads it.
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import { BALL_RADIUS, sampleAt } from './trajectory.js';

/* The ball is drawn at one fixed size, a little over life-size, everywhere
   and from every camera.

   It used to be inflated with distance to hold a minimum on-screen size, the
   way a broadcast tracker does. That reads well for a lone dot in the sky and
   badly everywhere else, because the ball's size relative to the world then
   changes as it flies. From behind the plate a pitch left the hand at about
   2.5 times life-size (3.5 on a phone, where the stage is shorter) and came
   down to 1x by the plate, so next to the pitcher, the plate and the batter it
   visibly shrank on its way in, which is backwards. A ball of constant size
   gets bigger on screen as it comes at the camera and smaller as it goes away,
   which is the one cue the eye uses to read where it is.

   The scale stays above 1 so a pitch is still a visible dot at release on a
   small screen. */
const BALL_SCALE = 1.6;

/* Once it is hit, and only then, a ball far from the camera is allowed to grow
   so it never drops below FAR_MIN_PX across: at 300 ft from a following
   camera a ball of fixed size is a single pixel, and the eye loses it. This is
   the old distance boost, kept for the one place it earns its keep and turned
   well down (it used to hold 16 px and go to 3.5x life-size). The pitch never
   gets it: over sixty feet the ball is close enough to read, and a pitch that
   changed size on its way in was the bug the fixed size above fixed. */
const FAR_MIN_PX = 6; // smallest on-screen diameter of a batted ball, px
const FAR_MAX_SCALE = 3; // and never more than this, times life-size
const FAR_RAMP = 0.35; // s after contact over which the boost is let in

/* A home run has nowhere to land: past the wall there is only space. From the
   moment it comes down it keeps falling, through where the seats would be and
   on below the field, fading as it goes. The solved path still has it landing
   and stopping in the seats — that is the data, and the camera and the readout
   use it — so this is purely how the ball is drawn. */
const GONE_FADE = 0.9; // s to fade out after it passes the landing point
const GRAVITY = 32.17; // ft/s^2

/* ---------------------------------------------------------------------------
   The cover. A baseball is two figure-eight panels stitched together, and the
   seam between them is the curve that draws the two "horseshoes". On a unit
   sphere it is, for t in [0, 2pi):

     x = a cos t + b cos 3t
     y = a sin t - b sin 3t        a + b = 1
     z = 2 sqrt(ab) sin 2t

   which stays exactly on the sphere for any split of a and b. SEAM_B sets how
   deep the horseshoes bite: bigger pinches the panels' waists narrower.

   The texture is painted by distance on the SPHERE, not in texture space.
   Drawing a curve straight onto an equirectangular map stretches it toward the
   poles, and this curve runs close to both. So every texel is placed back on
   the ball, measured against the seam in 3D, and shaded from that — the
   stitches come out the same size wherever they sit.
--------------------------------------------------------------------------- */
const SEAM_B = 0.35;
const STITCHES = 108; // a regulation ball has 108 double stitches
const TEX_W = 1024;
const TEX_H = 512;

/* Stitch geometry, in ball radii (1 radius = 1.45 in). */
const SEAM_GROOVE = 0.035; // half-width of the recessed seam line
const STITCH_INNER = 0.05; // where a stitch leaves its hole, off the seam
const STITCH_OUTER = 0.15; // how far out the stitch reaches
const STITCH_RAKE = 0.085; // how far back along the seam the arm sweeps
const THREAD = 0.013; // half-thickness of the thread

const LEATHER = [244, 240, 229];
const GROOVE = [214, 205, 190];
const THREAD_RED = [196, 34, 42];

function seamPoint(t) {
  const a = 1 - SEAM_B;
  const c = 2 * Math.sqrt(a * SEAM_B);
  const x = a * Math.cos(t) + SEAM_B * Math.cos(3 * t);
  const y = a * Math.sin(t) - SEAM_B * Math.sin(3 * t);
  /* Turned 45 degrees about Z. As written the curve runs straight over the
     texture's poles, where a single point on the ball spans a whole row of
     texels — slow to paint and pinched on the mesh. Rotated, it never comes
     within 46 degrees of either pole. */
  return [(x + y) * Math.SQRT1_2, (y - x) * Math.SQRT1_2, c * Math.sin(2 * t)];
}

/** Distance from point (px, py) to segment (ax, ay)-(bx, by), in 2D. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const u = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - u * dx, py - ay - u * dy);
}

/* Painted once per page: every ball shares the same cover. */
let cachedCover = null;

function ballTexture() {
  if (cachedCover) return cachedCover;
  const W = TEX_W;
  const H = TEX_H;

  /* 1. Sample the seam densely with a local frame at each point: T along the
        seam, N across it on the ball's surface. `s` is arc length. */
  const N_SAMPLES = 1000;
  const pts = [];
  let s = 0;
  let prev = seamPoint(0);
  for (let i = 0; i < N_SAMPLES; i++) {
    const t = (i / N_SAMPLES) * Math.PI * 2;
    const p = seamPoint(t);
    if (i > 0) s += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
    pts.push({ p, s });
  }
  const seamLength = s + Math.hypot(...seamPoint(0).map((v, k) => v - prev[k]));
  for (let i = 0; i < N_SAMPLES; i++) {
    const a = pts[(i + N_SAMPLES - 1) % N_SAMPLES].p;
    const b = pts[(i + 1) % N_SAMPLES].p;
    const p = pts[i].p;
    let T = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const tl = Math.hypot(...T);
    T = T.map((v) => v / tl);
    // N = p x T lies in the tangent plane, perpendicular to the seam.
    pts[i].T = T;
    pts[i].N = [p[1] * T[2] - p[2] * T[1], p[2] * T[0] - p[0] * T[2], p[0] * T[1] - p[1] * T[0]];
  }

  /* 2. Splat each sample into the texels near it, keeping for every texel the
        nearest sample's local (along, across) coordinates. Texel -> sphere uses
        three.js SphereGeometry's own mapping, so the paint lands where it is
        computed. */
  const best = new Float32Array(W * H).fill(Infinity);
  const along = new Float32Array(W * H);
  const across = new Float32Array(W * H);
  const reach = STITCH_OUTER + THREAD * 3;
  const rowReach = Math.ceil((reach / Math.PI) * H) + 1;

  // Texel centres on the sphere, by row and by column, computed once.
  const rowSin = new Float32Array(H);
  const rowCos = new Float32Array(H);
  for (let row = 0; row < H; row++) {
    const th = ((row + 0.5) / H) * Math.PI;
    rowSin[row] = Math.sin(th);
    rowCos[row] = Math.cos(th);
  }
  const colSin = new Float32Array(W);
  const colCos = new Float32Array(W);
  for (let col = 0; col < W; col++) {
    const ph = ((col + 0.5) / W) * Math.PI * 2;
    colSin[col] = Math.sin(ph);
    colCos[col] = Math.cos(ph);
  }

  for (const { p, s: s0, T, N } of pts) {
    const theta = Math.acos(Math.max(-1, Math.min(1, p[1])));
    const phi = Math.atan2(p[2], -p[0]);
    const row0 = Math.round((theta / Math.PI) * H - 0.5);
    const col0 = Math.round((((phi + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * W - 0.5);
    for (let row = row0 - rowReach; row <= row0 + rowReach; row++) {
      if (row < 0 || row >= H) continue;
      const sinTh = rowSin[row];
      const qy = rowCos[row];
      const colReach = Math.min(W / 2, Math.ceil(((reach / Math.max(sinTh, 1e-3)) / (Math.PI * 2)) * W) + 1);
      for (let dc = -colReach; dc <= colReach; dc++) {
        const col = (((col0 + dc) % W) + W) % W;
        const qx = -colCos[col] * sinTh;
        const qz = colSin[col] * sinTh;
        const dx = qx - p[0];
        const dy = qy - p[1];
        const dz = qz - p[2];
        const d2 = dx * dx + dy * dy + dz * dz;
        const k = row * W + col;
        if (d2 >= best[k]) continue;
        best[k] = d2;
        along[k] = s0 + dx * T[0] + dy * T[1] + dz * T[2];
        across[k] = dx * N[0] + dy * N[1] + dz * N[2];
      }
    }
  }

  /* 3. Shade. Stitches are chevrons: each pair of arms leaves the seam at
        +-STITCH_INNER and sweeps back and out to +-STITCH_OUTER. */
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(W, H);
  const data = image.data;
  const spacing = seamLength / STITCHES;
  // An arm rakes back past its neighbours, so check every stitch that can reach.
  const reachSlots = Math.ceil(STITCH_RAKE / spacing) + 1;
  const texel = (Math.PI * 2) / W; // ~ one texel, in radii, for antialiasing
  const cover = (d, halfWidth) => Math.max(0, Math.min(1, (halfWidth - d) / texel + 0.5));

  for (let k = 0; k < W * H; k++) {
    // Leather, with faint mottling so it is not flat white under close light.
    const grain = 1 - Math.random() * 0.035;
    let r = LEATHER[0] * grain;
    let g = LEATHER[1] * grain;
    let b = LEATHER[2] * grain;

    if (best[k] !== Infinity) {
      const n = across[k];
      const groove = cover(Math.abs(n), SEAM_GROOVE) * 0.8;
      r += (GROOVE[0] - r) * groove;
      g += (GROOVE[1] - g) * groove;
      b += (GROOVE[2] - b) * groove;

      // Position within this stitch's slot, then distance to its two arms.
      const u = ((along[k] % spacing) + spacing) % spacing;
      let d = Infinity;
      for (let slot = 0; slot <= reachSlots; slot++) {
        const base = slot * spacing;
        for (const side of [1, -1]) {
          d = Math.min(
            d,
            segmentDistance(u, n, base, side * STITCH_INNER, base - STITCH_RAKE, side * STITCH_OUTER),
          );
        }
      }
      const thread = cover(d, THREAD);
      if (thread > 0) {
        // A touch darker along the thread's edge, so each stitch reads as round.
        const shade = 0.82 + 0.18 * Math.min(1, (THREAD - d) / THREAD + 0.3);
        r += (THREAD_RED[0] * shade - r) * thread;
        g += (THREAD_RED[1] * shade - g) * thread;
        b += (THREAD_RED[2] * shade - b) * thread;
      }
    }

    data[k * 4] = r;
    data[k * 4 + 1] = g;
    data[k * 4 + 2] = b;
    data[k * 4 + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  cachedCover = canvas;
  return canvas;
}

export function createBall() {
  const group = new THREE.Group();
  group.name = 'ball';

  const texture = new THREE.CanvasTexture(ballTexture());
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(BALL_RADIUS, 48, 32),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.5 }),
  );
  mesh.scale.setScalar(BALL_SCALE);
  mesh.castShadow = true;
  group.add(mesh);

  /* The whole flight, faint, and the part already flown, bright. Two
     geometries sharing one position buffer — the draw range is per-geometry,
     so a single shared geometry would force both lines to draw the same
     prefix and there would be no ghost ahead of the ball. */
  const ghostGeometry = new THREE.BufferGeometry();
  const trailGeometry = new THREE.BufferGeometry();
  const ghost = new THREE.Line(
    ghostGeometry,
    new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22 }),
  );
  const trail = new THREE.Line(
    trailGeometry,
    new THREE.LineBasicMaterial({ color: '#ffd34d', transparent: true, opacity: 0.95 }),
  );
  ghost.frustumCulled = false;
  trail.frustumCulled = false;
  group.add(ghost, trail);

  /* The point the tracked data pins down — the landing on a fly ball, where it
     was fielded on a grounder, the catch on a lineout. Deliberately NOT where
     the ball comes to rest: the roll past the landing is simulated, so marking
     it would put a confident ring on the one part that is not from the feed. */
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(1.6, 2.2, 32),
    new THREE.MeshBasicMaterial({
      color: '#ffd34d',
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.05;
  group.add(marker);

  /* Set by the engine on resize; the far-ball sizing needs it. */
  let viewportHeight = 810;
  const setViewportHeight = (px) => {
    if (px > 0) viewportHeight = px;
  };

  let path = null;
  let gone = null; // { index, t, at, vel, fade } for a home run — see GONE_FADE
  let spinAxis = new THREE.Vector3(1, 0, 0);
  let spinRate = 0; // rad/s

  function setPath(next) {
    path = next;
    group.visible = !!path;
    if (!path) return;

    const positions = new Float32Array(path.samples.length * 3);
    path.samples.forEach((s, i) => {
      positions[i * 3] = s.x;
      positions[i * 3 + 1] = s.y;
      positions[i * 3 + 2] = s.z;
    });
    const attribute = new THREE.BufferAttribute(positions, 3);
    for (const g of [ghostGeometry, trailGeometry]) {
      g.setAttribute('position', attribute);
      g.computeBoundingSphere();
    }
    gone = null;
    if (path.gone && path.hangTime != null) {
      const s = path.samples;
      let k = s.findIndex((q) => q.t >= path.hangTime);
      if (k < 0) k = s.length - 1;
      // Velocity over the last fiftieth of a second of flight, not the last
      // sample pair: the landing sample is interpolated and can sit a hair
      // after the one before it.
      let j = k - 1;
      while (j > 0 && s[k].t - s[j].t < 0.02) j--;
      const dt = Math.max(1e-3, s[k].t - s[j].t);
      gone = {
        index: k,
        t: s[k].t,
        at: new THREE.Vector3(s[k].x, s[k].y, s[k].z),
        vel: new THREE.Vector3((s[k].x - s[j].x) / dt, (s[k].y - s[j].y) / dt, (s[k].z - s[j].z) / dt),
        fade: Math.max(0.2, Math.min(GONE_FADE, (path.duration ?? Infinity) - s[k].t)),
      };
    }
    ghostGeometry.setDrawRange(0, gone ? gone.index + 1 : path.samples.length);

    marker.visible = !!path.tracked;
    if (path.tracked) marker.position.set(path.tracked.x, 0.05, path.tracked.z);

    /* Spin the ball about its real backspin axis at the rate the solve landed
       on. The axis is across the initial velocity — the same construction
       trajectory.js uses for the Magnus force, rebuilt here from the first two
       samples so the two cannot drift apart. */
    const a = path.samples[0];
    const b = path.samples[Math.min(1, path.samples.length - 1)];
    const launch = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
    spinAxis = launch.lengthSq() > 1e-9
      ? launch.normalize().cross(new THREE.Vector3(0, 1, 0)).normalize()
      : new THREE.Vector3(1, 0, 0);
    spinRate = ((Number.isFinite(path.spinRpm) ? path.spinRpm : 0) * 2 * Math.PI) / 60;
    mesh.quaternion.identity();
  }

  function update(t, camera) {
    if (!path) return;

    let opacity = 1;
    if (gone && t > gone.t) {
      const dt = t - gone.t;
      mesh.position.copy(gone.at).addScaledVector(gone.vel, dt);
      mesh.position.y -= 0.5 * GRAVITY * dt * dt;
      opacity = Math.max(0, 1 - dt / gone.fade);
    } else {
      const at = sampleAt(path, t);
      mesh.position.set(at.x, at.y, at.z);
    }
    const fading = opacity < 1;
    if (mesh.material.transparent !== fading) {
      mesh.material.transparent = fading;
      mesh.material.needsUpdate = true;
    }
    mesh.material.opacity = opacity;

    /* Gone once it is past the plate (or at the backstop, for a foul) — see
       vanishTime in play.js. Only the ball: the trail stays, so the break of a
       pitch can still be read while the play holds on its result. */
    mesh.visible = (path.vanishTime == null || t < path.vanishTime) && opacity > 0;
    mesh.scale.setScalar(scaleAt(t, camera));

    /* Spin stops when the flight does. A batted ball at rest in the outfield
       has no business turning over for the rest of the play. */
    const last = path.samples[path.samples.length - 1].t;
    mesh.quaternion.setFromAxisAngle(spinAxis, spinRate * Math.min(t, last));

    // Draw the trail up to the current sample.
    let n = 1;
    while (n < path.samples.length && path.samples[n].t <= t) n++;
    trailGeometry.setDrawRange(0, gone ? Math.min(n, gone.index + 1) : n);
  }

  /* Fixed size until contact. After it, the size that keeps the ball
     FAR_MIN_PX across from this camera, never below the fixed size and never
     above FAR_MAX_SCALE. Let in over FAR_RAMP so a camera that is already far
     away at contact (the broadcast shot) does not see the ball jump. */
  const scratch = new THREE.Vector3();
  function scaleAt(t, camera) {
    const contact = path.contactTime;
    if (contact == null || t <= contact || !camera) return BALL_SCALE;
    const span = 2 * Math.tan((camera.fov * Math.PI) / 360); // view height at unit depth
    const distance = camera.position.distanceTo(mesh.getWorldPosition(scratch));
    const needed = (FAR_MIN_PX * distance * span) / (2 * BALL_RADIUS * viewportHeight);
    const far = Math.min(FAR_MAX_SCALE, Math.max(BALL_SCALE, needed));
    const ramp = Math.min(1, (t - contact) / FAR_RAMP);
    return BALL_SCALE + (far - BALL_SCALE) * ramp;
  }

  /** Settings -> Replay -> Ball trail. The ball and its landing ring stay. */
  const setTrail = (on) => {
    ghost.visible = !!on;
    trail.visible = !!on;
  };

  /** The engine hides the ball between plays, while it waits on the feed. */
  const setVisible = (v) => {
    group.visible = !!v && !!path;
  };

  function dispose() {
    ghostGeometry.dispose();
    trailGeometry.dispose();
    mesh.geometry.dispose();
    mesh.material.map?.dispose();
    mesh.material.dispose();
    ghost.material.dispose();
    trail.material.dispose();
    marker.geometry.dispose();
    marker.material.dispose();
  }

  group.visible = false;
  return { group, setPath, update, setVisible, setTrail, setViewportHeight, dispose };
}
