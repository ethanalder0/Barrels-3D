/* ---------------------------------------------------------------------------
   FREE ROAM — fly the camera anywhere in the park.
   ---------------------------------------------------------------------------
   The third camera mode, after the two the director drives (see engine.js).
   It is a fly camera rather than an orbit: an orbit always circles one point,
   and the point of free roam is to stand somewhere — in the on-deck circle,
   on top of the foul pole, behind the shortstop — and watch the play from
   there.

     W A S D / arrows   move, level with the ground, whichever way you face
     Space              up
     Shift + Space      down
     drag               look around (grab-the-world, as in a street-level map)
     wheel              zoom — the lens, not the camera, as in the director
     B                  turn to the ball and keep turning with it, from
                        wherever you are, until B again or a drag

   Moving keeps tracking on: strafing round a fly ball while the camera holds
   it is half the fun. Only taking the view back with the mouse, or B, ends it.

   It owns its own input and listens only while it is enabled, so the director
   modes keep Space for play/pause and the page keeps its scroll wheel.
--------------------------------------------------------------------------- */

import * as THREE from 'three';

const FOV = { min: 8, max: 80, enter: [30, 60] };
const PITCH_LIMIT = Math.PI / 2 - 0.001;
const HEIGHT = [1.5, 900]; // ft — never under the grass, never out of the sky
const RADIUS = 1500; // ft from home plate before the fog has swallowed the park
const RESPONSE = 9; // 1/s — how quickly movement reaches speed and stops
const TRACK_RESPONSE = 12; // 1/s — how tightly B keeps the ball in the middle

/* Faster the higher you are, so a walk round the infield is a walk and getting
   across the outfield from the upper deck does not take a minute. */
const speedAt = (height) => THREE.MathUtils.clamp(45 + height * 0.5, 45, 250);
const vertical = 40; // ft/s

const MOVE = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

const typing = (e) =>
  !!e.target?.closest?.('input, textarea, select, [contenteditable="true"]');

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * @param camera   the engine's camera, which this moves while enabled
 * @param element  the canvas, for drag and wheel
 * @param ballAt   () => THREE.Vector3 — where B should look right now
 * @param onChange called when tracking turns on or off
 */
export function createFreeRoam({ camera, element, ballAt, onChange }) {
  let enabled = false;
  let tracking = false;
  let yaw = 0;
  let pitch = 0;
  const velocity = new THREE.Vector3();
  const want = new THREE.Vector3();
  const held = new Set(); // 'forward' | 'back' | 'left' | 'right' | 'up'
  let shift = false;
  let drag = null; // { id, x, y, moved }
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const scratch = new THREE.Vector3();

  function setTracking(next) {
    if (tracking === !!next) return;
    tracking = !!next;
    onChange?.();
  }

  /** Face a direction, as yaw (0 = towards centre field) and pitch. */
  function face(dir) {
    const d = scratch.copy(dir).normalize();
    pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    /* Straight down (the `top` preset) has no heading of its own; face centre
       field so the overhead reads like a photograph, home at the bottom. */
    yaw = Math.hypot(d.x, d.z) > 1e-6 ? Math.atan2(-d.x, -d.z) : 0;
  }

  function orient() {
    pitch = THREE.MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
    euler.set(pitch, yaw, 0);
    camera.quaternion.setFromEuler(euler);
  }

  function setFov(fov) {
    camera.fov = THREE.MathUtils.clamp(fov, FOV.min, FOV.max);
    camera.updateProjectionMatrix();
  }

  /**
   * Take the camera. With a pose, from there; without one, from exactly where
   * the camera already is, so switching to free roam never jumps the picture.
   * The lens is the exception: the broadcast shot is on a 2.6° lens, which is
   * a telescope, not something to walk around with.
   */
  function enable(pose = null) {
    if (pose) {
      camera.position.fromArray(pose.position);
      face(scratch.fromArray(pose.target).sub(camera.position));
    } else {
      face(camera.getWorldDirection(new THREE.Vector3()));
    }
    camera.up.set(0, 1, 0);
    camera.near = 0.5;
    setFov(pose?.fov ?? THREE.MathUtils.clamp(camera.fov, ...FOV.enter));
    velocity.set(0, 0, 0);
    held.clear();
    enabled = true;
    element.style.touchAction = 'none'; // a drag on a phone looks, not scrolls
    orient();
  }

  function disable() {
    enabled = false;
    element.style.touchAction = '';
    held.clear();
    drag = null;
    velocity.set(0, 0, 0);
    setTracking(false);
  }

  function update(dt) {
    if (!enabled) return;

    if (tracking) {
      const at = ballAt();
      const dir = scratch.copy(at).sub(camera.position);
      if (dir.lengthSq() > 1e-6) {
        dir.normalize();
        const targetPitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
        const targetYaw = Math.atan2(-dir.x, -dir.z);
        const k = 1 - Math.exp(-TRACK_RESPONSE * dt);
        yaw = wrap(yaw + wrap(targetYaw - yaw) * k);
        pitch += (targetPitch - pitch) * k;
      }
    }
    orient();

    /* Movement is level whichever way the camera points: looking down at the
       infield and pressing W walks you towards second, not into the dirt. */
    const speed = speedAt(camera.position.y);
    const forward = (held.has('forward') ? 1 : 0) - (held.has('back') ? 1 : 0);
    const right = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
    const up = held.has('up') ? (shift ? -1 : 1) : 0;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    want.set(-sin * forward + cos * right, 0, -cos * forward - sin * right);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(speed);
    want.y = up * vertical;

    velocity.lerp(want, 1 - Math.exp(-RESPONSE * dt));
    camera.position.addScaledVector(velocity, dt);

    const p = camera.position;
    p.y = THREE.MathUtils.clamp(p.y, HEIGHT[0], HEIGHT[1]);
    const r = Math.hypot(p.x, p.z);
    if (r > RADIUS) {
      p.x *= RADIUS / r;
      p.z *= RADIUS / r;
    }
  }

  /* --- Input ------------------------------------------------------------- */

  function onKeyDown(e) {
    if (!enabled || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    shift = e.shiftKey;
    const move = MOVE[e.code];
    if (move) {
      e.preventDefault(); // arrows would otherwise scroll the page
      held.add(move);
    } else if (e.code === 'Space') {
      e.preventDefault();
      held.add('up');
    } else if (e.code === 'KeyB' && !e.repeat) {
      setTracking(!tracking);
    }
  }

  function onKeyUp(e) {
    shift = e.shiftKey;
    const move = MOVE[e.code];
    if (move) held.delete(move);
    else if (e.code === 'Space') {
      held.delete('up');
      /* A focused button fires on Space's keyup. In free roam Space is a
         direction, never a click on whatever was last pressed. */
      if (enabled && !typing(e)) e.preventDefault();
    }
  }

  // Keys released while the window is not looking would otherwise stick.
  function onBlur() {
    held.clear();
    shift = false;
  }

  function onPointerDown(e) {
    if (!enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    element.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e) {
    if (!enabled || !drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return; // a click is not a drag
    drag.moved = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
    setTracking(false);
    /* Grab the world: the field moves with the pointer, one pixel of drag
       moving the scene one pixel on screen whatever the zoom — so a long lens
       is fine to aim, not twitchy. */
    const perPixel = THREE.MathUtils.degToRad(camera.fov) / (element.clientHeight || 1);
    yaw += dx * perPixel;
    pitch += dy * perPixel;
    orient();
  }

  function onPointerUp(e) {
    if (drag && e.pointerId === drag.id) drag = null;
  }

  function onWheel(e) {
    if (!enabled) return;
    e.preventDefault(); // in free roam the wheel is the lens, not the page
    const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    setFov(camera.fov * Math.exp(e.deltaY * lines * 0.0012));
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerUp);
  element.addEventListener('wheel', onWheel, { passive: false });

  function dispose() {
    disable();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerUp);
    element.removeEventListener('wheel', onWheel);
  }

  return {
    enable,
    disable,
    update,
    dispose,
    setTracking,
    get enabled() {
      return enabled;
    },
    get tracking() {
      return tracking;
    },
  };
}
