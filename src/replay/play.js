/* ---------------------------------------------------------------------------
   A PLAY — the pitch, and what happened to it, on one clock.
   ---------------------------------------------------------------------------
   The engine plays one thing, not two. A pitch and a batted ball are the same
   ball on one continuous timeline: it leaves the hand, crosses the plate, and
   either finishes in the catcher's mitt or comes off the bat and flies. Making
   them one path means the trail is continuous, the transport scrubs across
   contact, and the camera has a real moment to cut on.

   Contact is the join. The batted ball is launched from the point where the
   pitch actually crossed the plate — including its height, so a ball hit at the
   knees starts at the knees. Distances are still measured from the world origin
   (the back point of the plate, which is what MLB measures from), so moving the
   launch point does not move the target the solver is aiming at.

   An at-bat with no batted ball is a perfectly good play: a called strike is
   the pitch alone, ending in the mitt.

   THE CLOCK STARTS BEFORE THE BALL DOES. t = 0 is the first frame of the
   wind-up and the ball is not released until `releaseTime`; the clock also runs
   on past the last sample so nothing freezes mid follow-through. Both are in
   tuning.js. Everything the play reports — contact, the crossing, hang — is an
   absolute time on that one clock, so the engine never adds an offset itself.
--------------------------------------------------------------------------- */

import { ballParamsFromAtBat } from './ball/fromAtBat.js';
import { solveTrajectory } from './ball/trajectory.js';
import { foulBack } from './ball/foul.js';
import { solvePitch, pitchParams } from './pitch/trajectory.js';
import { FINISH_TAIL, WINDUP_LEAD_IN } from './tuning.js';

/** The pitch to show for an at-bat: the last one, in either payload shape. */
export function lastPitch(atBat) {
  if (!atBat) return null;
  const list = Array.isArray(atBat.pitches) ? atBat.pitches : null;
  if (list?.length) {
    // Walk back to the last one that actually carries a plate location.
    for (let i = list.length - 1; i >= 0; i--) {
      if (Number.isFinite(list[i]?.plate?.x)) return list[i];
    }
    return null;
  }
  return Number.isFinite(atBat.pitch?.plate?.x) ? atBat.pitch : null;
}

/** The last pitch thrown, whether or not it carries a plate location. */
function finalPitch(atBat) {
  const list = Array.isArray(atBat?.pitches) ? atBat.pitches : null;
  if (list?.length) return list[list.length - 1];
  return atBat?.pitch ?? null;
}

/**
 * Was the ball put in play without the tracked detail having arrived yet?
 *
 * A ball in play reaches the feed as TWO updates, and the first one is a trap.
 * Captured from a real game (Yandy Diaz, TB @ ATL, 2026-09-10):
 *
 *   first   result "At bat", kind "live", eventType null
 *           exitVelo 94, launchAngle 8, distance 163
 *           hit.coordinates { x: null, y: null }, trajectory null
 *   second  result "Single", kind "hit"
 *           hit.coordinates { x: 83.49, y: 119.57 }, trajectory "ground_ball"
 *
 * The first update already carries exit velocity, launch angle and distance —
 * everything the solver needs to build a flight — and no landing coordinates.
 * So it builds a perfectly confident 163 ft ground ball to DEAD CENTRE, plays
 * it, and a second later the real update lands and it plays again, this time
 * to left field where the ball actually went. Two replays of two different
 * plays, one of them fiction.
 *
 * The discriminator is that the play is not complete. `kind` is "live" for
 * exactly as long as GUMBO has not closed the play out, and the outcome and
 * the coordinates both land when it does — so waiting for it is waiting for
 * the whole truth rather than for one field.
 *
 * Deliberately NOT keyed on the coordinates being absent: once a play IS
 * complete, missing coordinates mean the ball genuinely was not tracked, and
 * holding out for data that will never come would mean never showing it.
 */
export function isAwaitingDetail(atBat) {
  if (!atBat) return false;
  const p = finalPitch(atBat);
  const inPlay = p?.isInPlay === true || p?.outcome === 'inplay';
  return inPlay && atBat.kind === 'live';
}

/**
 * A signature of everything about an at-bat that changes the reconstruction.
 *
 * The app hands the engine a fresh at-bat OBJECT on every backend poll — the
 * snapshot is re-parsed JSON, so nothing survives by identity — and a live game
 * polls every eight seconds. Reloading on each of those restarted the replay
 * from the top, so a live game sat there playing the same pitch over and over
 * until the next one arrived. Comparing content rather than identity is what
 * makes a reload mean "something actually changed".
 *
 * Pitch count is in the key on purpose: during an at-bat the id stays the same
 * while pitches are appended, and a new pitch absolutely should replay.
 */
export function playKey(atBat) {
  if (!atBat) return 'none';
  const p = lastPitch(atBat);
  const h = atBat.hit;
  return [
    atBat.id,
    atBat.result,
    atBat.pitches?.length ?? 0,
    p?.number ?? '',
    p?.plate?.x ?? '',
    p?.plate?.z ?? '',
    p?.velo ?? '',
    h?.launchSpeed ?? '',
    h?.launchAngle ?? '',
    h?.totalDistance ?? '',
    h?.coordinates?.x ?? '',
    h?.coordinates?.y ?? '',
  ].join('|');
}

/**
 * What the batter did with the pitch being shown.
 *
 *   'inplay'  put in play: a batted ball the feed describes
 *   'foul'    swung and fouled it off (foul tips are NOT this — see below)
 *   'miss'    swung through it, including a foul tip, which the catcher held
 *   'take'    no swing: a ball, a called strike, a hit batter
 *   null      the payload does not say (the offline stub shape)
 *
 * A foul tip is scored as a swinging strike and plays as one: the bat barely
 * grazed it and it carried on into the mitt, which on screen is a swing and a
 * miss.
 */
export function swingOf(pitch) {
  const outcome = pitch?.outcome;
  if (pitch?.isInPlay === true || outcome === 'inplay') return 'inplay';
  if (outcome === 'foul') return 'foul';
  if (outcome === 'swinging') return 'miss';
  if (outcome === 'ball' || outcome === 'called' || outcome === 'hbp') return 'take';
  return null;
}

/**
 * Build the whole play. Returns null when there is nothing to show at all —
 * no pitch location and no batted ball — which is the engine's cue to sit idle
 * on the strike zone.
 *
 * `park` reaches only the batted ball, and only to place the wall. The pitch is
 * sixty feet of air that every park has in common.
 *
 * `leadIn` and `tail` are the wind-up and the follow-through, in seconds. They
 * default to the tuned values and are arguments only so a test can ask for the
 * bare ball clock.
 */
export function buildPlay(
  atBat,
  park,
  { leadIn = WINDUP_LEAD_IN, tail = FINISH_TAIL } = {},
) {
  const pitchInput = lastPitch(atBat);
  const params = pitchInput ? pitchParams(pitchInput, atBat) : null;
  const pitch = params ? solvePitch(params) : null;

  /* Contact happens where the pitch crossed the plate. Without a pitch there
     is nothing to inherit, so the batted ball falls back to launching from the
     origin at a nominal contact height. */
  const contactTime = pitch ? pitch.flightTime : 0;
  const origin = pitch
    ? [pitch.crossing.x, pitch.crossing.y, pitch.crossing.z]
    : null;

  /* A batted ball belongs to the pitch that was put in play and to no other.
     Mid at-bat the payload's `hit` is the most recent event that carried hit
     data — which can be an earlier FOUL, since Statcast tracks some of those —
     so without this a called strike after a tracked foul replayed as a ball
     flying into the outfield. The stub shape says nothing about the pitch and
     keeps the old behaviour. */
  const swing = swingOf(pitchInput);
  const ballParams = swing === 'inplay' || swing === null ? ballParamsFromAtBat(atBat) : null;
  const ball = ballParams ? solveTrajectory({ ...ballParams, origin }, park) : null;

  /* A foul off the bat: not in the feed as a flight, so flown here — back over
     the catcher, seeded by the pitch so it is the same foul every time. */
  const foul =
    !ball && swing === 'foul' && pitch
      ? foulBack(origin, `${atBat.id ?? ''}|${pitchInput.number ?? ''}`)
      : null;
  const after = ball ?? foul;

  if (!pitch && !ball) return null;

  /* Splice the two paths. The pitch is cut at the crossing when the ball was
     put in play — it never reaches the mitt — and the batted ball's clock is
     shifted so contact is the moment the pitch arrives. */
  const samples = [];
  if (pitch) {
    for (const s of pitch.samples) {
      if (after && s.t > contactTime) break;
      samples.push(s);
    }
    if (after) {
      samples.push({
        t: contactTime,
        x: pitch.crossing.x,
        y: pitch.crossing.y,
        z: pitch.crossing.z,
      });
    }
  }
  if (after) {
    for (const s of after.samples) {
      if (s.t === 0 && samples.length) continue; // the join is already there
      samples.push({ t: contactTime + s.t, x: s.x, y: s.y, z: s.z });
    }
  }

  /* Shift the whole thing onto the play's clock, which starts at the first
     frame of the wind-up. Done here, once, rather than by every consumer: the
     ball's samples, the crossing and contact all have to move together or the
     camera cuts on one clock while the ball flies on another. */
  for (const s of samples) s.t += leadIn;

  const end = samples[samples.length - 1];
  const crossingTime = pitch ? leadIn + pitch.flightTime : null;
  return {
    samples,
    /* The whole show, wind-up and follow-through included. The ball's own
       flight is `duration - releaseTime - tail`. */
    duration: end.t + tail,
    releaseTime: leadIn,
    /* When the pitch reaches the plate, whether or not it was hit. Contact is
       the same instant when there was contact, and null when there was not —
       the camera needs to know the difference, the strike-zone mark does not. */
    crossingTime,
    contactTime: after ? leadIn + contactTime : null,
    pitch,
    ball,
    /* True when the contact was a foul back. The camera holds on the zone for
       these instead of following the ball, and the contact sound takes its
       foul tier. There is no tracked landing, so no marker and no hang time. */
    foul: !!foul,
    /* When the ball leaves the picture. A pitch that was not put in play ends
       just past the plate, where a catcher's mitt would be — and with no
       catcher there it would otherwise sit in mid-air, spinning, through the
       whole follow-through and the hold on the result. A foul ends at the
       backstop, the same problem further away. Only a ball in play stays: it
       is lying on the field where the play left it. */
    vanishTime: ball ? null : end.t,
    /* What the batter did: 'inplay', 'foul', 'miss', 'take', or null when the
       payload does not say. The swing the batter plays is decided from this. */
    swing,

    /* Pass the batted ball's measurements up so the readout, the landing
       marker and the camera do not have to know about the composition. Times
       are shifted onto the play's clock; distances are unaffected. */
    tracked: ball?.tracked ?? null,
    /* What came off the bat, in mph. Carried through so whatever is playing
       the contact sound does not have to re-read the at-bat to find out how
       hard the ball was hit (see contactVariantFor in audio/crack.js). */
    exitVelo: ballParams?.exitVelo ?? foul?.exitVelo ?? null,
    trackedDistance: ball?.trackedDistance ?? null,
    carry: ball?.carry ?? null,
    apexHeight: ball?.apexHeight ?? null,
    hangTime: ball ? leadIn + contactTime + ball.hangTime : null,
    /* Came down past the wall: out of the park, and out of the world. */
    gone: !!ball?.gone,
    rollDistance: ball?.rollDistance ?? 0,
    endDistance: ball?.endDistance ?? null,
    endHeight: end.y,
    spinRpm: ball?.spinRpm ?? pitch?.spinRpm ?? 0,
    mode: ball?.mode ?? (foul ? 'foul' : 'pitch'),
    solved: ball ? ball.solved : (pitch?.error ?? 0) < 0.05,
  };
}
