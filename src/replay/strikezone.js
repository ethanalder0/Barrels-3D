/* ---------------------------------------------------------------------------
   STRIKE ZONE
   ---------------------------------------------------------------------------
   The zone is the width of home plate, and its top and bottom are per-batter —
   the feed carries them on every pitch as `plate.szTop` / `plate.szBottom`
   (server/projection.py). Defaults here are a typical zone, used until a pitch
   says otherwise.

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

   Height: the feed's szTop / szBottom are measured off the batter's stance and
   run short — 1.5 ft is common — which on a 17 in plate draws a square. So the
   height has a floor of MIN_ASPECT times the width, grown evenly about the
   batter's own midpoint. A tall batter's zone is still taller than a short
   batter's; nobody's zone collapses into a square.
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import { PLATE_WIDTH, PLATE_DEPTH } from './field/spec.js';
import { BALL_RADIUS } from './ball/trajectory.js';

export const DEFAULT_ZONE = { szTop: 3.45, szBottom: 1.55 };

/* Height is at least this many plate widths. */
const MIN_ASPECT = 1.3;

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
     so it cannot z-fight with it, and faces the same way. */
  const mark = new THREE.Mesh(
    new THREE.RingGeometry(BALL_RADIUS * 0.92, BALL_RADIUS * 1.25, 24),
    flat('#ffd34d', 0),
  );
  const markDot = new THREE.Mesh(new THREE.CircleGeometry(BALL_RADIUS * 0.9, 24), flat('#ffd34d', 0));
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

  /** Size the zone to a batter. Pass a pitch's `plate` object, or nothing. */
  function set(plate) {
    const top = num(plate?.szTop) ?? DEFAULT_ZONE.szTop;
    const bottom = num(plate?.szBottom) ?? DEFAULT_ZONE.szBottom;
    const w = PLATE_WIDTH;
    const h = Math.max(top - bottom, w * MIN_ASPECT);
    const midY = (top + bottom) / 2;
    const x = w / 2;
    const yTop = midY + h / 2;
    const yBot = midY - h / 2;

    fill.scale.set(w, h, 1);
    fill.position.set(0, midY, PLANE_Z);

    const sides = [
      [-x, yBot, -x, yTop],
      [x, yBot, x, yTop],
      [-x, yTop, x, yTop],
      [-x, yBot, x, yBot],
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
