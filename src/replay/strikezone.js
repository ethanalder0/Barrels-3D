/* ---------------------------------------------------------------------------
   STRIKE ZONE
   ---------------------------------------------------------------------------
   The zone is the width of home plate, and its top and bottom are per-batter
   and FIXED for the game: MLB's ABS zone, 53.5% and 27% of his height. The
   server hands each at-bat one `zone` {top, bottom} — tracked if the batter
   has seen a pitch, from his listed height if not (server/projection.py) — so
   the box is his from the moment he steps in and never moves while he is
   there. The default here is only for a payload with no zone at all.

   It is drawn FLAT, on the plane where pX / pZ are measured: the front edge of
   home plate. The zone is a two-dimensional judgement — a pitch is a strike on
   the strength of one crossing — and drawing it as a box invented a depth the
   rule does not have, which also made it read as a floating crate from any
   angle off the catcher's line.

   Width: the rulebook 17 in, NOT padded by a ball radius. A 2D plot would pad
   because its dots are markers; here the ball and its
   crossing ring are drawn at true size, so a pitch that clips the edge visibly
   overlaps the line. Padding the box as well counted the ball's radius twice,
   and it made the zone wider than it was tall for most batters.

   Height: drawn exactly as given, NOT stretched. It used to have a floor of
   1.3 plate widths, because a 1.6 ft zone on a 17 in plate looks nearly
   square. But that is what the zone really is, and the floor grew the
   average zone by 1.5 in at each end — enough that low pitches the plate
   umpire and ABS called balls drew clipping the bottom edge.
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import { PLATE_WIDTH, PLATE_DEPTH } from './field/spec.js';
import { BALL_RADIUS } from './ball/trajectory.js';

/* The league-average zone (3.20 / 1.62 ft over 2,299 pitches, Sept 2026). */
export const DEFAULT_ZONE = { top: 3.2, bottom: 1.62 };

/* Line weights, in feet. Real geometry rather than GL lines: WebGL draws every
   line one pixel wide whatever you ask for, which vanished against the grass at
   full screen and shimmered at small sizes. */
const EDGE = 0.015;
const EDGE_SHADOW = 0.035;

/* The plane pX / pZ are measured on: the 17 in edge facing the pitcher. */
const PLANE_Z = -PLATE_DEPTH;

/* How long the crossing mark lives, in seconds after the pitch arrives. */
const MARK_HOLD = 1.5;
const MARK_FADE = 1.2;

const flat = (color, opacity) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

export function createStrikeZone() {
  const group = new THREE.Group();
  group.name = 'strike-zone';

  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flat('#bfe6ff', 0.07));
  fill.renderOrder = 1;

  /* The border is bars: unit planes scaled into place. A dark, wider bar sits
     under each bright edge so the zone reads on dirt, grass and sky
     alike — the same trick a broadcast graphic uses. */
  const bar = new THREE.PlaneGeometry(1, 1);
  const shadowMat = flat('#0b1620', 0.28);
  const edgeMat = flat('#f2fbff', 0.92);

  const shadows = Array.from({ length: 4 }, () => new THREE.Mesh(bar, shadowMat));
  const edges = Array.from({ length: 4 }, () => new THREE.Mesh(bar, edgeMat));
  shadows.forEach((m) => (m.renderOrder = 2));
  edges.forEach((m) => (m.renderOrder = 4));

  /* Where the pitch actually crossed. Sits a hair in front of the zone plane
     so it cannot z-fight with it, and faces the same way. The ring's OUTER
     edge is the ball's edge: a ring that reached past it drew pitches that
     missed by a fraction of an inch touching the zone. */
  const mark = new THREE.Mesh(
    new THREE.RingGeometry(BALL_RADIUS * 0.7, BALL_RADIUS, 24),
    flat('#ffd34d', 0),
  );
  const markDot = new THREE.Mesh(new THREE.CircleGeometry(BALL_RADIUS * 0.7, 24), flat('#ffd34d', 0));
  mark.renderOrder = markDot.renderOrder = 5;
  mark.visible = false;
  markDot.visible = false;

  group.add(fill, ...shadows, ...edges, mark, markDot);

  /** Stretch a unit bar between two points on the zone plane. */
  function place(mesh, x0, y0, x1, y1, weight, zOffset = 0) {
    const horizontal = y0 === y1;
    const length = horizontal ? Math.abs(x1 - x0) + weight : Math.abs(y1 - y0) + weight;
    mesh.scale.set(horizontal ? length : weight, horizontal ? weight : length, 1);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, PLANE_Z + zOffset);
  }

  /** Size the zone to a batter. Pass a {top, bottom} in feet (zoneFor), or nothing. */
  function set(zone) {
    let top = num(zone?.top);
    let bottom = num(zone?.bottom);
    if (top === null || bottom === null || top <= bottom) ({ top, bottom } = DEFAULT_ZONE);
    const w = PLATE_WIDTH;
    const h = top - bottom;
    const midY = (top + bottom) / 2;
    const x = w / 2;

    fill.scale.set(w, h, 1);
    fill.position.set(0, midY, PLANE_Z);

    const sides = [
      [-x, bottom, -x, top],
      [x, bottom, x, top],
      [-x, top, x, top],
      [-x, bottom, x, bottom],
    ];
    sides.forEach((s, i) => {
      place(shadows[i], ...s, EDGE_SHADOW, 0.004);
      place(edges[i], ...s, EDGE, 0.008);
    });
  }

  /** Put the crossing mark where a pitch actually crossed the plate. */
  function setMark(crossing) {
    const on = !!crossing;
    mark.visible = on;
    markDot.visible = on;
    if (!on) return;
    for (const m of [mark, markDot]) {
      m.position.set(crossing.x, crossing.y, PLANE_Z + 0.02);
      m.material.opacity = 0;
    }
  }

  /**
   * Fade the mark by how long ago the pitch crossed. It is deliberately
   * temporary: a mark that stayed would still be sitting in the zone on the
   * next pitch, claiming to describe it.
   */
  function markAt(secondsSince) {
    if (!mark.visible) return;
    const a =
      secondsSince < 0
        ? 0
        : secondsSince <= MARK_HOLD
          ? 1
          : Math.max(0, 1 - (secondsSince - MARK_HOLD) / MARK_FADE);
    mark.material.opacity = a;
    markDot.material.opacity = a * 0.55;
  }

  set(null);

  return {
    group,
    set,
    setMark,
    markAt,
    setVisible: (v) => {
      group.visible = v;
    },
    dispose: () => {
      for (const o of [fill, mark, markDot]) {
        o.geometry.dispose();
        o.material.dispose();
      }
      bar.dispose();
      shadowMat.dispose();
      edgeMat.dispose();
    },
  };
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The zone to draw for an at-bat. The at-bat's own `zone` is the batter's, fixed
 * for the game; payloads from before the server sent it fall back to the
 * bounds any pitch carries, which are the same value on every pitch.
 */
export function zoneFor(atBat) {
  if (!atBat) return null;
  if (num(atBat.zone?.top) !== null && num(atBat.zone?.bottom) !== null) return atBat.zone;
  const pitches = Array.isArray(atBat.pitches) ? atBat.pitches : [atBat.pitch];
  const p = pitches.find((q) => num(q?.plate?.szTop) !== null && num(q?.plate?.szBottom) !== null);
  return p ? { top: p.plate.szTop, bottom: p.plate.szBottom } : null;
}
