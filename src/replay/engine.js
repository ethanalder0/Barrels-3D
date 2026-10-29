/* ---------------------------------------------------------------------------
   ENGINE — renderer, camera, playback loop.
   ---------------------------------------------------------------------------
   Owns #replay-viewport outright: appends its canvas, sizes from a
   ResizeObserver on the mount, and cleans up after itself on detach. It holds
   no React and imports nothing from the app.

   It renders the field, the strike zone, and a ball on a solved flight path.
   Characters are not here yet; when they arrive they hang off the same clock,
   because the flight is what defines the timing (see ball/trajectory.js).
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import { buildField } from './field/field.js';
import { createPark, parkFor } from './field/park.js';
import { createStrikeZone } from './strikezone.js';
import { createFreeRoam } from './freeroam.js';
import { createBall } from './ball/ball.js';
import { createSky } from './sky/sky.js';
import { PITCH_VELOCITY } from './tuning.js';
import { sampleAt } from './ball/trajectory.js';
import { buildPlay, isAwaitingDetail, lastPitch, playKey } from './play.js';
import { CLIPS, MOMENT, batterStance, pitcherStance, createPlayers } from './player/player.js';

/* ---------------------------------------------------------------------------
   THE DIRECTOR
   ---------------------------------------------------------------------------
   While the camera is locked it is not parked — it works the play the way a
   broadcast does. It holds the catcher's view through contact so you see the
   ball leave the bat, then swings back to a high camera behind home and tracks
   the ball, zooming in as it goes so it stays readable all the way out.

   The zoom is a real zoom: the camera stops moving once it reaches the anchor
   and narrows its field of view instead, which is what a camera operator does
   and what keeps the shot stable. Flying the camera along with the ball looks
   like a video game and loses all sense of how far the ball went.

   Two shots can start the play (Settings -> Replay -> Camera): the catcher's,
   and the centre-field broadcast shot. The catcher's GLIDES round to the high
   camera; the broadcast shot CUTS to it, as television does — gliding from
   centre field would fly the camera the length of the park.
--------------------------------------------------------------------------- */

const DIRECTOR = {
  hold: 0.22, // s at the catcher's view after contact
  blend: 0.55, // s to swing round to the high camera
  anchor: [0, 48, 96], // where it settles: high behind home plate
  frameFeet: 55, // feet of scene to keep around the ball
  fovRange: [15, 46],
};

/* How long to hold on the finished play before going back to the zone. */
const DWELL = 1.8;

/* ---------------------------------------------------------------------------
   THE QUEUE
   ---------------------------------------------------------------------------
   Plays arrive on the feed's schedule and are watched on their own. A live game
   polls every few seconds and a play takes longer than that to run — wind-up,
   pitch, swing, follow-through — so a second pitch lands while the first is
   still in the air. Loading it there and then cuts the play off mid-swing,
   which is what made a live game look like a slideshow of half-pitches.

   So arrivals queue and each play runs to its end before the next one starts.

   The cap is small on purpose. If the animation ever falls behind the game by
   more than this, the right thing is to skip forward to what is happening NOW
   rather than to work through a backlog of pitches that are already history —
   this is a live companion, and the oldest waiting play is the one worth
   losing.
--------------------------------------------------------------------------- */
const QUEUE_MAX = 4;

/**
 * Did this play end the plate appearance?
 *
 * The feed says so directly: an at-bat in progress carries kind 'live' and no
 * outcome, and the moment it is over it carries what happened instead. So a
 * strikeout, a walk and a double all answer true, and the fourth pitch of a
 * seven-pitch at-bat answers false.
 */
function endsPlateAppearance(atBat) {
  if (!atBat) return false;
  if (atBat.kind) return atBat.kind !== 'live';
  return !!atBat.result && atBat.result !== 'At bat' && atBat.result !== '—';
}

/* ---------------------------------------------------------------------------
   PITCH SLOW MOTION
   ---------------------------------------------------------------------------
   A real pitch is 0.4 s from hand to plate. That is accurate and nearly
   useless: the break happens in the last third of it, and a 95 mph fastball
   and an 84 mph slider both read as "a blur, then it's there".

   So the pitch plays at a fixed fraction of real time. One rate for every
   pitch, never a fixed duration — the same scale is what keeps a changeup
   visibly slower than the heater before it. After the ball reaches the plate
   the clock eases back to real time, because a batted ball's hang time is
   already long enough to follow and slowing it only makes a fly ball drag.

   THE WIND-UP IS NOT SLOWED. It is not part of the thing that is hard to see,
   and a leg kick at 0.7x looks like an injury. So the clock runs at life speed
   until the ball is released and the slow motion starts with the pitch.

   The rate itself is PITCH_VELOCITY in tuning.js.
--------------------------------------------------------------------------- */
export const PITCH_RATE = PITCH_VELOCITY;
const RATE_RECOVERY = 0.35; // s of play time to ease from PITCH_RATE back to 1

/** Playback speed at a point on the play's clock. */
function rateAt(path, t) {
  if (t < path.releaseTime) return 1; // the wind-up, at life speed
  /* Slow all the way to the plate whether or not it was hit: a called strike
     is watched for the break, and the break is in the last few feet. */
  const anchor = path.contactTime ?? path.crossingTime;
  if (anchor == null || t < anchor) return PITCH_RATE;
  const u = clamp((t - anchor) / RATE_RECOVERY, 0, 1);
  return PITCH_RATE + (1 - PITCH_RATE) * smoothstep(u);
}

/**
 * How many real seconds a stretch of the play's clock takes to watch.
 *
 * The clock no longer runs at one rate — life speed through the wind-up, slow
 * motion for the pitch — so converting play time to wall time is an integral
 * rather than a division. Only the contact cue needs it, and it needs it to be
 * right: the crack of the bat is scheduled ahead on the audio clock, and being
 * wrong by the length of a wind-up would put it a second and a half early.
 *
 * Integrated numerically because rateAt is the definition of the curve and
 * differentiating it by hand every time it changes is how the two drift apart.
 */
function wallSecondsBetween(path, from, to) {
  if (!(to > from)) return 0;
  const steps = 256;
  const dt = (to - from) / steps;
  let seconds = 0;
  for (let i = 0; i < steps; i++) {
    seconds += dt / rateAt(path, from + (i + 0.5) * dt);
  }
  return seconds;
}

const scratch = {
  ball: new THREE.Vector3(),
  position: new THREE.Vector3(),
  target: new THREE.Vector3(),
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (u) => u * u * (3 - 2 * u);

/* Camera presets, in world feet.

   `catcher` is the default and is locked: it is the one view where the camera
   position is meaningful rather than decorative — behind the plate at a
   crouching catcher's eye height, framing the strike zone with the pitcher
   beyond it. Letting the mouse drift it turns a calibrated view into an
   arbitrary one, so the mouse does nothing until you switch to free roam.

   The rest are starting points for free roam (see freeroam.js). `top` is how
   you check the field layout. */
export const VIEWS = {
  /* Aimed at the zone itself, not at the rubber. Aiming down the field looks
     like the right idea and does not work: the camera sits above a zone only
     eight feet away, so the direction to the zone and the direction to the
     mound differ by about 12 degrees, and framing the mound pushes the bottom
     of the zone off the screen. Targeting the zone centres it and leaves the
     pitcher high in frame, which is exactly how the broadcast shot looks. */
  catcher: {
    position: [0, 3.4, 7.5],
    target: [0, 2.5, -0.71], // the middle of the strike zone
    fov: 34,
    locked: true,
  },
  /* The broadcast shot: the camera out beyond the centre-field wall, high,
     on a very long lens, looking in over the pitcher's shoulder at the batter.
     Set a little to left-centre so the pitcher stands to one side of the
     plate rather than in front of it. A lens this long compresses sixty feet
     into nothing, which is exactly the look — pitcher and batter in one frame.

     `near` is raised because at 440 ft through a 2-degree lens the default
     half-foot near plane leaves the depth buffer too coarse to keep the chalk
     off the dirt. `cut` makes the director cut rather than glide (see above). */
  centerfield: {
    position: [-13, 38, -440],
    target: [0, 3.4, -1],
    fov: 2.6,
    near: 40,
    locked: true,
    cut: true,
  },
  home: { position: [0, 62, 118], target: [0, 0, -120], fov: 38 },
  broadcast: { position: [0, 32, -415], target: [0, 4, -50], fov: 38 },
  first: { position: [168, 16, -18], target: [0, 4, -70], fov: 38 },
  /* Straight down, high enough to hold the whole park. `up` is the important
     part: looking down -Y with the default up of +Y, the projection puts left
     field on the RIGHT of the image, mirrored against the painted layout —
     which makes the one view that exists for checking the field actively
     misleading. Pointing up at -Z (centre field) lands it the way an overhead
     photograph reads: home at the bottom, left field on the left. */
  top: {
    position: [0, 760, -160],
    target: [0, 0, -160],
    up: [0, 0, -1],
    fov: 38,
  },
};

/* Behind the sky dome, for the frame before it paints. There is no fog: it was
   only there to fade out the far edge of the ground, and the ground now ends
   at the wall. See sky/sky.js. */
const BACKDROP = '#05070f';

/* How far Settings can zoom the catcher's shot either way. */
const ZOOM_RANGE = [0.6, 2];

const QUALITY = {
  low: { pixelRatio: 1, shadows: false },
  medium: { pixelRatio: 1.5, shadows: true },
  high: { pixelRatio: 2, shadows: true },
};

export function createEngine() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKDROP);
  const sky = createSky();
  scene.add(sky.group);

  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 2000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = 'display:block;width:100%;height:100%';

  let park = createPark();
  let field = buildField(park);
  const zone = createStrikeZone();
  const ball = createBall();
  scene.add(field, zone.group, ball.group);

  let roam = null;
  let observer = null;
  let mount = null;
  let frame = 0;
  let onKey = null;

  let view = 'catcher';
  let locked = true;
  let path = null;
  let playhead = 0;
  let last = 0;

  /* 'idle' is the resting state and the one the engine spends most of its life
     in: the strike zone, framed from the catcher, nothing moving, waiting for
     the next pitch to arrive on the feed. A play runs, holds on its result for
     a beat, then drops back to it. */
  let phase = 'idle'; // 'idle' | 'play' | 'paused' | 'dwell'
  let dwell = 0;
  let loadedKey = 'none';
  let awaiting = false; // holding for the detailed update on a ball in play
  let loadedAtBat = null;
  let stagedAtBat = null; // who is up now, shown in the box while idle — see stage()
  let queue = [];        // plays waiting their turn — see load()
  let following = false; // true while the app is following the live game
  let players = null;          // resolves asynchronously; null until the GLB lands
  let batterClip = CLIPS.batterIdle;
  const listeners = new Set();

  const emit = () => listeners.forEach((fn) => fn(status()));

  /* --- Moments ----------------------------------------------------------
     What the play has revealed so far, for anything drawn over the replay.
     A HUD that printed "Slider 84 mph, called strike" the instant the at-bat
     loaded would give the result away before the ball left the hand, so it
     waits for these instead: the pitch crossing the plate, contact, and the
     ball reaching the point the tracked data describes. Fired only when one
     of them changes, never per frame.

     Two more fields say what the flags are ABOUT, because a flag on its own
     is only half an answer. `id` is the `eventId` the app put on the at-bat
     now on screen: without it, a HUD handed the next at-bat while the engine
     was still showing the last one read the last one's "landed" as the new
     one's and printed the result before the pitch was thrown. `busy` is true
     while anything is on screen or waiting its turn, which is how the app
     knows the picture has caught up with the game. */
  const momentListeners = new Set();
  let moment = { pitch: true, contact: true, landed: true, awaiting: false, id: null, busy: false };

  function moments() {
    const id = loadedAtBat?.eventId ?? null;
    const busy = phase !== 'idle' || queue.length > 0;
    if (!path) return { pitch: true, contact: true, landed: true, awaiting, id, busy };
    // Idle has shown the whole play; scrubbing back hides what has not happened.
    const t = phase === 'idle' ? Infinity : playhead;
    const crossed = path.crossingTime != null ? t >= path.crossingTime : true;
    const contact = path.contactTime != null ? t >= path.contactTime : crossed;
    const landed = path.hangTime != null ? t >= path.hangTime : contact;
    return { pitch: crossed, contact, landed, awaiting, id, busy };
  }

  /* --- The contact cue ---------------------------------------------------
     Sound, unlike everything else here, cannot be drawn one frame at a time:
     a recorded hit has a lead-in before its transient, so it has to be handed
     over BEFORE contact with the time remaining, not at the instant of it.

     Hence a cue rather than a moment. It fires once per play, when playback
     starts from anywhere before contact, and carries how long the ball still
     has in the air — real seconds, so whatever plays it can schedule against
     the audio clock. The engine itself makes no sound and knows nothing about
     what a cue turns into; see replay/index.js.

     The conversion is wallSecondsBetween(), not a division: the run-up to
     contact is part wind-up at life speed and part pitch in slow motion. */
  const contactListeners = new Set();
  let contactCued = false;

  function cueContact() {
    if (contactCued || !path || path.contactTime == null) return;
    if (playhead > path.contactTime) return; // already past it — nothing to cue
    contactCued = true;
    const detail = {
      exitVelo: path.exitVelo ?? null,
      isFoul: !!path.foul,
      delay: wallSecondsBetween(path, playhead, path.contactTime),
    };
    contactListeners.forEach((fn) => fn(detail));
  }

  /* Anything that leaves the run-up to contact — pausing, scrubbing, loading
     another at-bat — takes the cue back, so a hit that was scheduled for a
     swing no longer on screen never sounds. */
  function dropContactCue() {
    if (!contactCued) return;
    contactCued = false;
    contactListeners.forEach((fn) => fn(null));
  }

  function emitMoment() {
    const next = moments();
    if (
      next.pitch === moment.pitch &&
      next.contact === moment.contact &&
      next.landed === moment.landed &&
      next.awaiting === moment.awaiting &&
      next.id === moment.id &&
      next.busy === moment.busy
    ) {
      return;
    }
    moment = next;
    momentListeners.forEach((fn) => fn(moment));
  }

  /* --- Players -----------------------------------------------------------
     Which swing a pitch gets, decided by what the batter did with THAT pitch
     (play.js swingOf) rather than by how the at-bat ended. Keying it on the
     at-bat result is what left every foul and every swinging strike before
     strike three standing in his stance: the result mid at-bat is "At bat".

       in play   a swing that connected; the solved flight says whether it
                 left the park
       foul      the same connecting swing — the ball goes back, not out
       miss      a swing and a miss, and a foul tip, which plays as one
       take      no swing: a ball, a called strike, a hit batter

     Only a payload that does not say (the offline stub shape) falls back to
     the result: a strikeout there is taken to be a swinging one.

     batter_hit ends in the first steps toward first base, and a left-hander is
     a MIRRORED right-hander — so mirrored, those steps head up the third-base
     line. A lefty gets batter_hit_lefty instead: the same swing, stopped before
     the run. So does every foul, from either side: nobody runs on a foul. */
  function chooseBatterClip(atBat, solved) {
    const swing = solved?.swing ?? null;
    const mirrored = batterStance(atBat?.batSide).mirror;
    if (solved?.contactTime != null && !solved.foul) {
      const gone = /home ?run/i.test(atBat?.result ?? '') || solved.mode === 'homer';
      if (gone) return CLIPS.batterHomerun;
      return mirrored ? CLIPS.batterHitLefty : CLIPS.batterHit;
    }
    if (swing === 'foul') return CLIPS.batterHitLefty;
    if (swing === 'miss') return CLIPS.batterMiss;
    if (swing === null && /strikeout/i.test(atBat?.result ?? '')) return CLIPS.batterMiss;
    return CLIPS.batterIdle;
  }

  /**
   * Put both players where the play's clock says they are.
   *
   * Driven by absolute time rather than by advancing a mixer, for the same
   * reason the ball is: the pitch runs in slow motion and the transport can be
   * scrubbed, and anything integrating its own dt drifts out of the play within
   * a pitch. Seeking every frame costs nothing and cannot drift.
   *
   * EACH CLIP IS PINNED BY ITS OWN MOMENT and otherwise plays at its own rate.
   * The pitching clip is pinned at release, the swing at contact, and the play
   * gives them room on both sides (see tuning.js): the wind-up has the lead-in
   * to itself and the follow-throughs have the tail. So a pitcher winds up,
   * kicks and throws, and the bat arrives on the ball — none of it stretched.
   *
   * They still slow down together, because the rate is a property of the clock
   * and not of any one of them: a pitch in slow motion is a swing in slow
   * motion, which is what makes them look like one event rather than two.
   *
   * The swing is not on screen until it starts. A batter cannot hold the first
   * frame of a swing for a second and a half, so until his clip reaches zero he
   * is in the idle stance.
   */
  function syncPlayers(dt = 0) {
    if (!players) return;

    /* An idle stance is a loop and wants real time; a clip pinned to the
       playhead is seeked and wants none. Both kinds are in play at once — a
       batter stands in his stance through the whole wind-up — so the two go
       through here together and each player is advanced only if it is looping.
       Miss this and the man in the idle stance is a statue. */
    if (!path || phase === 'idle') {
      players.batter.play(CLIPS.batterIdle);
      players.pitcher.play(CLIPS.pitcherIdle);
      players.update(dt);
      return;
    }

    players.pitcher.seek(
      CLIPS.pitcherPitch,
      MOMENT[CLIPS.pitcherPitch] + (playhead - path.releaseTime),
    );

    /* Contact for a swing that missed is when the ball crossed the plate: the
       bat still has to be through the zone as the ball goes by, or it reads as
       a swing at nothing. */
    const contact = path.contactTime ?? path.crossingTime ?? path.releaseTime;
    const swing = MOMENT[batterClip] ?? 0;
    const t = swing + (playhead - contact);
    if (batterClip === CLIPS.batterIdle || t < 0) {
      players.batter.play(CLIPS.batterIdle);
      players.batter.update(dt);
      return;
    }
    players.batter.seek(batterClip, t);
  }

  /* --- Camera ----------------------------------------------------------- */

  /** Place the camera for the current instant. Only runs while locked. */
  function direct() {
    const shot = VIEWS[shotName];
    if (camera.up.y !== 1) camera.up.set(0, 1, 0);
    scratch.position.fromArray(shot.position);
    scratch.target.fromArray(shot.target);
    const base = shotFov(shotName);
    let fov = base;
    let near = shot.near ?? 0.5;

    /* Idle sits on the zone. A pitch that was never put in play has no
       contact time, so the camera stays on the zone for the whole thing —
       which is exactly right: a called strike is watched from behind the
       plate, not chased into the outfield. */
    /* A foul is not followed. It goes back over the camera and out of the
       park's interest, and the next pitch is coming to the zone — so the shot
       holds on the zone and lets the ball leave the frame. */
    if (path && view === shotName && phase !== 'idle' && path.contactTime != null && !path.foul) {
      const at = sampleAt(path, playhead);
      scratch.ball.set(at.x, at.y, at.z);

      const since = playhead - (path.contactTime + DIRECTOR.hold);
      const u = shot.cut
        ? (since >= 0 ? 1 : 0)
        : smoothstep(clamp(since / DIRECTOR.blend, 0, 1));
      if (u > 0) {
        near = 0.5;
        scratch.position.lerp(scratch.a.fromArray(DIRECTOR.anchor), u);
        scratch.target.lerp(scratch.ball, u);

        /* Zoom, not dolly: narrow the view as the ball gets further away.

           The frame has to hold the ball AND where it is going, not just the
           ball. Sizing it on the ball alone zooms hard the moment the ball is
           far away, and at the apex of a fly ball that fills the screen with
           empty sky — no wall, no ground, nothing to judge the flight against.
           Including the destination makes the shot open wide off the bat and
           tighten as the ball comes down to meet it, which is what a camera
           operator does and what makes the distance readable. */
        const distance = scratch.position.distanceTo(scratch.ball);
        scratch.b.set(path.tracked?.x ?? scratch.ball.x, 0, path.tracked?.z ?? scratch.ball.z);
        const span = Math.max(DIRECTOR.frameFeet, scratch.ball.distanceTo(scratch.b) * 0.55);
        const tracking = clamp(
          (2 * Math.atan(span / distance) * 180) / Math.PI,
          ...DIRECTOR.fovRange,
        );
        fov = base + (tracking - base) * u;
      }
    }

    camera.position.copy(scratch.position);
    camera.lookAt(scratch.target);
    if (Math.abs(camera.fov - fov) > 0.01 || camera.near !== near) {
      camera.fov = fov;
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }

  /**
   * Where free roam's B points: the ball while it is in the picture, the
   * pitcher's hand before it is thrown, and the strike zone between plays —
   * where the next one is coming.
   */
  const PLATE = new THREE.Vector3(...VIEWS.catcher.target);
  const ballPoint = new THREE.Vector3();
  function ballAt() {
    if (!path || phase === 'idle') return PLATE;
    const at = sampleAt(path, Math.max(playhead, path.releaseTime ?? 0));
    return ballPoint.set(at.x, at.y, at.z);
  }

  /* --- Camera and zoom --------------------------------------------------
     Settings -> Replay -> Camera picks the shot the director starts every play
     from: 'catcher' (behind the plate) or 'centerfield' (the broadcast shot).

     Settings -> Replay -> Zoom works whichever it is, and it is a real zoom —
     the lens narrows or widens, the camera stays where it is — because where
     the camera sits is the calibrated part of each shot. 1 is the stock
     framing; 2 is twice as tight. */
  let shotName = 'catcher';
  let zoom = 1;

  /* Each shot is framed for 16:9. A narrower stage — a phone, which runs the
     replay at 4:3 — keeps that WIDTH and gains height, rather than keeping the
     height and losing the sides: held at the same vertical angle, the batter
     ended up filling half of a phone's frame. Wider than 16:9 is left alone;
     that is simply more field at the edges. */
  const FRAMED_ASPECT = 16 / 9;

  function shotFov(name) {
    const half = (VIEWS[name].fov * Math.PI) / 360;
    const fit = Math.max(1, FRAMED_ASPECT / camera.aspect);
    return (Math.atan((Math.tan(half) * fit) / zoom) * 360) / Math.PI;
  }

  function setZoom(next) {
    const z = Number(next);
    zoom = Number.isFinite(z) && z > 0 ? clamp(z, ZOOM_RANGE[0], ZOOM_RANGE[1]) : 1;
    if (locked) direct();
  }

  function setCamera(name) {
    shotName = VIEWS[name]?.locked ? name : 'catcher';
    // Only take the camera over if the director has it; a free orbit stays put.
    if (locked) {
      view = shotName;
      direct();
      emit();
    }
  }

  /* --- Night games ------------------------------------------------------
     Settings -> Replay -> Night games. The dust gives way to stars and the
     moon, and the field is lit from the light towers instead of the sun. The
     lights belong to the field (they turn with each park), so the field
     applies it — and is told again whenever setPark() builds a new one. */
  let night = false;

  function applyNight() {
    sky.setNight(night);
    renderer.toneMappingExposure = night ? 0.92 : 1.08;
    field.userData.setNight?.(night);
  }

  function setNight(next) {
    night = !!next;
    applyNight();
  }

  /* --- Overlays ---------------------------------------------------------
     Settings -> Replay -> Ball trail and Strike zone. Both are drawn over the
     play rather than part of it, so turning them off changes nothing else:
     the ball still flies the same path and the camera still frames the zone. */
  function setTrail(next) {
    ball.setTrail(next !== false);
  }

  function setStrikeZone(next) {
    zone.setVisible(next !== false);
  }

  /**
   * Jump to a preset. A locked one becomes the director's shot; any other is
   * a place to start free roam from.
   */
  function setView(name) {
    const v = VIEWS[name] || VIEWS.catcher;
    view = VIEWS[name] ? name : 'catcher';
    if (v.locked) {
      shotName = view;
      setCameraLock(true);
      return;
    }
    locked = false;
    roam?.enable(v);
    emit();
  }

  /**
   * Hand the camera to the director, or take it into free roam. Free roam
   * starts from wherever the director had it, so switching never jumps.
   */
  function setCameraLock(next) {
    const was = locked;
    locked = !!next;
    if (locked) {
      roam?.disable();
      view = shotName; // the director drives the chosen shot
      direct();
    } else if (was) {
      view = 'free';
      roam?.enable();
    }
    emit();
  }

  /* --- Camera modes -----------------------------------------------------
     L cycles them, in this order:

       catcher      behind home plate, director at the wheel
       centerfield  the broadcast shot, director at the wheel
       free         free roam — see freeroam.js

     Settings still decide which shot the app opens on and which one it goes
     back to when Settings change; L is for the game in front of you. */
  const MODES = ['catcher', 'centerfield', 'free'];

  function cameraMode() {
    return locked ? shotName : 'free';
  }

  function cycleCamera() {
    const next = MODES[(MODES.indexOf(cameraMode()) + 1) % MODES.length];
    if (next === 'free') setCameraLock(false);
    else setView(next);
  }

  function setQuality(level) {
    const q = QUALITY[level] || QUALITY.high;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    renderer.shadowMap.enabled = q.shadows;
    scene.traverse((o) => {
      if (o.isMesh) o.material.needsUpdate = true;
    });
  }

  /* --- Playback --------------------------------------------------------- */

  /**
   * Take an at-bat and either start it or put it in the queue.
   *
   * While the app is following the live game, a play that arrives on top of one
   * already running waits its turn — see THE QUEUE above. When it is not
   * following, the viewer has picked a play by hand and means now, so it
   * replaces whatever is on screen.
   */
  function load(atBat) {
    /* The awaiting-detail hold has to happen before anything else, queue
       included: this is the first of two updates for the same ball in play and
       the one that is wrong about where it went. */
    if (isAwaitingDetail(atBat)) {
      awaiting = true;
      emit();
      emitMoment();
      return path;
    }

    if (!following || phase === 'idle' || !path) return start(atBat);

    const key = playKey(atBat);
    if (key === loadedKey) {
      /* Already on screen. Still worth a moment pass: this may be the update
         that clears `awaiting` on a play that did not otherwise change. */
      awaiting = false;
      emitMoment();
      return path;
    }

    /* The app re-broadcasts its selection on every poll, so the same waiting
       play arrives again and again. Replace it in place rather than queueing it
       twice — and replacing rather than ignoring matters, because the newer
       copy may be the one that finally carries the tracked landing point. */
    const at = queue.findIndex((q) => playKey(q) === key);
    if (at >= 0) queue[at] = atBat;
    else queue.push(atBat);

    if (queue.length > QUEUE_MAX) queue = queue.slice(-QUEUE_MAX);
    awaiting = false;
    emit();
    emitMoment(); // `busy` may have just changed
    return path;
  }

  /**
   * The play is over: take the next one, or go back to waiting.
   *
   * Going back to waiting is also when the batter leaves. The screen cuts to
   * the empty strike zone between plays, and if the plate appearance is over
   * the man who was in the box has struck out or is standing on first — so he
   * comes off with the ball. The next play puts whoever is up now back in.
   */
  function finish() {
    if (advance()) return;
    phase = 'idle';
    updateBallVisibility();
    if (players && endsPlateAppearance(loadedAtBat)) players.batter.setVisible(false);
    applyStage();
    emit();
    emitMoment();
  }

  /**
   * Who is up now, for the picture between plays.
   *
   * Following a live game, the engine is told who is in the box separately from
   * being told to play anything — opening the viewer mid at-bat should show
   * that batter standing in, waiting on the next pitch, not replay a pitch he
   * has already seen. It only reaches the screen between plays: a play on
   * screen, or waiting its turn, belongs to whoever was up when it happened,
   * and the next batter walks up when it is done.
   */
  function stage(atBat) {
    stagedAtBat = atBat ?? null;
    if (phase === 'idle' && !queue.length) applyStage();
  }

  function applyStage() {
    if (!following || !players) return;
    /* Nobody named yet — before the game, or before the feed has said who is
       up — leaves the box empty rather than showing the model's placeholder
       batter in no uniform at all. */
    if (!stagedAtBat) {
      players.batter.setVisible(false);
      return;
    }
    dressPlayers(stagedAtBat);
    /* An at-bat that is over has nobody in the box — he is out, or on base,
       and the next batter has not stepped in yet. The copy staged may also be
       older than the play that just ended his plate appearance. */
    const over =
      endsPlateAppearance(stagedAtBat) ||
      (stagedAtBat.id === loadedAtBat?.id && endsPlateAppearance(loadedAtBat));
    players.batter.setVisible(!over);
    zone.set(lastPitch(stagedAtBat)?.plate ?? null);
  }

  /** Start the next queued play, if there is one. */
  function advance() {
    const next = queue.shift();
    if (next) start(next);
    return !!next;
  }

  /**
   * Whether the app is following the live game.
   *
   * It decides what an arriving play means. Following, plays are coming off the
   * feed on their own and each one waits its turn. Not following, the viewer is
   * picking plays out of the list and every pick means now — so the queue is
   * dropped on the way out, or a play chosen by hand would sit behind whatever
   * the feed pushed in while they were reading.
   */
  function setFollowLive(next) {
    following = !!next;
    if (!following) queue = [];
    emitMoment();
  }

  /**
   * Solve an at-bat's flight and arm the transport.
   *
   * An at-bat with no batted ball (a walk, a strikeout) is not an error — the
   * ball simply has nothing to draw, and the strike zone stays.
   */
  function start(atBat) {
    awaiting = false;

    /* Same at-bat, same data: do nothing. The app re-broadcasts the selection
       on every poll of a live game, and rebuilding here would restart the
       replay each time — the same pitch on a loop until the next one lands.

       A new eventId on the same play is a new request to see it — highlights
       reaching the play that was already on screen — so that plays again. */
    const key = playKey(atBat);
    if (key === loadedKey && atBat?.eventId === loadedAtBat?.eventId) {
      emitMoment(); // may be clearing `awaiting` on a play that did not change
      return path;
    }
    loadedKey = key;
    loadedAtBat = atBat;

    path = buildPlay(atBat, park);
    ball.setPath(path);

    // Zone bounds are per-batter and ride on the pitch, in either payload shape.
    zone.set(lastPitch(atBat)?.plate ?? null);
    zone.setMark(path?.pitch?.crossing ?? null);

    playhead = 0;
    dwell = 0;
    batterClip = chooseBatterClip(atBat, path);
    dressPlayers(atBat);
    dropContactCue(); // a different play: whatever was scheduled is not this one
    phase = path ? 'play' : 'idle';
    updateBallVisibility();
    if (locked) direct();
    ball.update(0, camera);
    updateMark();
    if (phase === 'play') cueContact();
    emit();
    emitMoment();
    /* Nothing to play (an at-bat with no pitch in it yet) is not a reason to
       stall. Before this, a play like that stopped here with the rest of the
       queue behind it; the next arrival skipped past it, and the stranded
       plays ran later, out of order — replays of pitches long since shown. */
    if (!path) {
      applyStage();
      advance();
    }
    return path;
  }


  /**
   * Put both sides in the right kit.
   *
   * The batting side is the away club in the top of an inning, and the at-bat
   * carries which half it is. Numbers are whatever the feed actually gave us -
   * no number is drawn rather than a plausible one invented, because a wrong
   * number on a real player's back is worse than a blank jersey.
   */
  function dressPlayers(atBat) {
    if (!players || !atBat) return;
    const top = atBat.half ? atBat.half === 'top' : atBat.inningLabel?.startsWith('T');
    const batting = top ? atBat.awayTeam : atBat.homeTeam;
    const fielding = top ? atBat.homeTeam : atBat.awayTeam;
    /* Placement first: it decides whether the player is mirrored, and a
       mirrored player needs his number drawn backwards so the mirror turns it
       the right way round again (see stance.js). */
    const batStance = batterStance(atBat.batSide);
    const pitchStance = pitcherStance(atBat.pitchHand);
    players.batter.place(batStance);
    players.pitcher.place(pitchStance);
    /* Whoever is up now is in the box, even if the last plate appearance
       ended and took its batter off. */
    players.batter.setVisible(true);

    if (batting) {
      players.batter.setUniform(batting, {
        side: top ? 'away' : 'home',
        number: atBat.batterNumber ?? null,
        mirrored: batStance.mirror,
      });
    }
    if (fielding) {
      players.pitcher.setUniform(fielding, {
        side: top ? 'home' : 'away',
        number: atBat.pitcherNumber ?? null,
        mirrored: pitchStance.mirror,
      });
    }
  }

  /**
   * Move the replay to another ballpark.
   *
   * The field is rebuilt rather than adjusted: the playing surface is a painted
   * texture and the walls are one welded ribbon, so there is nothing in either
   * to nudge — a park is a different texture and a different mesh. The old one
   * is disposed on the way out, which matters because each field owns two
   * multi-megabyte canvas textures.
   *
   * The loaded play is re-solved afterwards, because the wall it was solved
   * against has moved. A ball that cleared the fence in one park need not in the
   * next, and leaving the old path up would draw a home run landing in front of
   * a wall.
   */
  function setPark(next) {
    const chosen = typeof next === 'string' ? parkFor(next) : next || createPark();
    if (chosen.key === park.key) return park;

    scene.remove(field);
    field.userData.dispose?.();
    park = chosen;
    field = buildField(park);
    scene.add(field);
    applyNight(); // a new field comes up in daylight

    /* Re-solved in place, not restarted. Restarting it — which this used to
       do, through load() — replayed the play from the wind-up whenever the
       venue arrived after it, which is how a game could open on the same
       replay twice. */
    if (loadedAtBat) {
      path = buildPlay(loadedAtBat, park);
      ball.setPath(path);
      zone.setMark(path?.pitch?.crossing ?? null);
      batterClip = chooseBatterClip(loadedAtBat, path);
      if (path) playhead = Math.min(playhead, path.duration);
      else phase = 'idle';
      updateBallVisibility();
      ball.update(playhead, camera);
      updateMark();
    }
    emit();
    return park;
  }

  /* The crossing mark is temporary: it appears when the pitch arrives and
     fades, so it is never still sitting there describing the previous pitch. */
  function updateMark() {
    if (path?.crossingTime == null) return;
    zone.markAt(phase === 'idle' ? Infinity : playhead - path.crossingTime);
  }

  /* The ball does not exist until it is thrown. Before release it would
     otherwise sit in mid-air at the release point for the whole wind-up, which
     is worse than nothing — the pitcher has it, and his hand is where the
     viewer is looking. */
  function updateBallVisibility() {
    const shown =
      !!path && phase !== 'idle' && (path.releaseTime == null || playhead >= path.releaseTime);
    ball.setVisible(shown);
  }

  function play() {
    if (!path) return;
    if (phase === 'idle' || playhead >= path.duration) playhead = 0;
    dwell = 0;
    phase = 'play';
    updateBallVisibility();
    /* Drop before cueing: replaying the same at-bat has to be able to sound
       the same hit again, and a cue already spent would swallow it. */
    dropContactCue();
    cueContact();
    emit();
    emitMoment();
  }
  function pause() {
    if (phase === 'play' || phase === 'dwell') phase = 'paused';
    dropContactCue();
    emit();
  }
  function seek(t) {
    if (!path) return;
    playhead = Math.max(0, Math.min(path.duration, t));
    /* Scrubbing RE-ARMS rather than just cancelling: the hit that was scheduled
       is for a moment the playhead has just left, but if the scrub lands back
       before contact and the replay is still running, it has to sound again at
       its new time. Dropping without re-cueing would leave the rest of that
       play silent. */
    dropContactCue();
    if (phase === 'idle') phase = 'paused'; // scrubbing brings the ball back
    if (phase === 'play') cueContact();
    updateBallVisibility();
    // Order matters: the director reads the playhead to place the camera, and
    // a batted ball sizes itself from the camera. Also runs while paused, so
    // scrubbing the transport moves the shot instead of freezing it.
    if (locked) direct();
    ball.update(playhead, camera);
    updateMark();
    emit();
    emitMoment();
  }

  function status() {
    return {
      view,
      locked,
      camera: cameraMode(),
      tracking: !!roam?.tracking,
      phase,
      awaiting,
      playing: phase === 'play',
      t: playhead,
      duration: path?.duration ?? 0,
      queued: queue.length,
      path,
      park,
    };
  }

  /** Subscribe to playback/camera changes. Returns an unsubscribe. */
  function subscribe(fn) {
    listeners.add(fn);
    fn(status());
    return () => listeners.delete(fn);
  }

  /** Subscribe to what the play has revealed. Returns an unsubscribe. */
  function onMoment(fn) {
    momentListeners.add(fn);
    fn(moment);
    return () => momentListeners.delete(fn);
  }

  /**
   * Subscribe to the contact cue. Returns an unsubscribe.
   *
   * Called with { exitVelo, isFoul, delay } when a play starts with contact
   * still ahead of it, and with null when that cue is withdrawn. A foul is
   * contact and gets a cue (flagged, so it sounds like one); a take or a swing
   * and a miss has no contact and gets none.
   */
  function onContact(fn) {
    contactListeners.add(fn);
    return () => contactListeners.delete(fn);
  }

  /* --- Loop ------------------------------------------------------------- */

  function resize() {
    if (!mount) return;
    const { width, height } = mount.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    ball.setViewportHeight(height);
  }

  function tick(now) {
    frame = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;

    if (path) {
      if (phase === 'play') {
        playhead += dt * rateAt(path, playhead);
        if (playhead >= path.duration) {
          playhead = path.duration;
          phase = 'dwell';
          dwell = 0;
          emit();
        }
      } else if (phase === 'dwell') {
        // Hold on the result, then hand the screen back to the strike zone.
        dwell += dt;
        if (dwell >= DWELL) finish();
      }
      ball.update(playhead, camera);
      updateBallVisibility();
      updateMark();
      emitMoment();
    }

    syncPlayers(dt);

    if (locked) direct();
    else roam?.update(dt);
    sky.update(now / 1000, camera, renderer.getPixelRatio());
    renderer.render(scene, camera);
  }

  function attach(el) {
    mount = el;
    mount.appendChild(renderer.domElement);

    roam = createFreeRoam({ camera, element: renderer.domElement, ballAt, onChange: emit });
    setView(shotName);
    setQuality('high');

    observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const preset = { 1: shotName, 2: 'home', 3: 'broadcast', 4: 'first', 5: 'top' }[e.key];
      if (preset) setView(preset);
      else if (e.key === 'l' || e.key === 'L') {
        if (!e.repeat) cycleCamera();
      } else if (e.code === 'Space' && locked) {
        // In free roam Space is up — freeroam.js has it.
        e.preventDefault();
        phase === 'play' ? pause() : play();
      }
    };
    window.addEventListener('keydown', onKey);

    /* Asynchronous on purpose: the field, the zone and the ball are all up and
       running before the character model has finished downloading, and a replay
       with no players is the engine's previous behaviour rather than an error. */
    createPlayers()
      .then((built) => {
        if (!mount) {            // detached while the model was in flight
          built.dispose();
          return;
        }
        players = built;
        scene.add(built.group);
        if (loadedAtBat) {
          batterClip = chooseBatterClip(loadedAtBat, path);
          dressPlayers(loadedAtBat);
        }
        if (phase === 'idle') applyStage();
        syncPlayers();
        emit();
      })
      .catch((err) => console.warn('[replay] players unavailable:', err.message));

    last = 0;
    frame = requestAnimationFrame(tick);
  }

  function detach() {
    queue = [];
    cancelAnimationFrame(frame);
    window.removeEventListener('keydown', onKey);
    observer?.disconnect();
    roam?.dispose();
    roam = null;
    renderer.domElement.remove();
    field.userData.dispose();
    sky.dispose();
    players?.dispose();
    players = null;
    zone.dispose();
    ball.dispose();
    renderer.dispose();
    listeners.clear();
    momentListeners.clear();
    contactListeners.clear();
    mount = null;
  }

  return {
    attach,
    detach,
    load,
    stage,
    setFollowLive,
    setPark,
    currentPark: () => park,
    players: () => players,
    play,
    pause,
    seek,
    status,
    subscribe,
    onMoment,
    onContact,
    setView,
    setCameraLock,
    cycleCamera,
    setQuality,
    setZoom,
    setCamera,
    setNight,
    setTrail,
    setStrikeZone,
    scene,
    camera,
    renderer,
  };
}
