/* ---------------------------------------------------------------------------
   BOOTSTRAP — find the mount, attach the engine, follow the app's events.
   ---------------------------------------------------------------------------
   The mount only exists while the live-game screen is on-screen, and React
   creates a fresh element each time. So rather than attaching once, watch the
   document and attach/detach as #replay-viewport comes and goes.

   This is the only file that knows anything about the host app. Everything it
   uses is in the contract at the top of components/ReplayViewport.jsx.
--------------------------------------------------------------------------- */

import { createEngine } from './engine.js';
import { parkFor } from './field/park.js';
import { contactVariantFor, playContact } from '../audio/crack.js';

const MOUNT_ID = 'replay-viewport';

let engine = null;
let attached = null;
let stopMoments = null;
let stopContact = null;

/* ---------------------------------------------------------------------------
   CONTACT SOUND

   The engine raises a cue before contact and says how long the pitch still has
   in the air; this turns that into one of the three recorded hits. Which one is
   decided entirely by exit velocity, in contactVariantFor() — the thresholds
   live in audio/crack.js and nothing about them is repeated here.

   Scheduled ahead rather than played on the frame of contact, because each
   recording has a lead-in before its transient: handed the delay, the audio
   clock can place the crack ON the moment the bat meets the ball instead of a
   fifth of a second after it.

   `sound` follows Settings -> Sound effects, over the same kind of DOM event
   the app already uses for render quality. It starts true so a replay is not
   silent before the first event arrives.
--------------------------------------------------------------------------- */
let sound = true;
let cancelContact = null;

function onContactCue(cue) {
  // Withdrawn (paused, scrubbed, another at-bat): call the hit back off.
  cancelContact?.();
  cancelContact = null;
  if (!cue || !sound) return;
  cancelContact = playContact(contactVariantFor({ exitVelo: cue.exitVelo, isFoul: cue.isFoul }), {
    delay: cue.delay,
  });
}

function onSound(e) {
  sound = e.detail !== false;
  if (!sound) {
    cancelContact?.();
    cancelContact = null;
  }
}

function onAtBat(e) {
  engine?.load(e.detail);
}
/* Who is up now, while following live: shown between plays, never played. */
function onStage(e) {
  engine?.stage(e.detail);
}
/* Following the live game means plays arrive on the feed's schedule and queue;
   not following means the viewer picked one and it plays now. Fires before the
   at-bat that goes with it — see ReplayViewport. */
function onFollow(e) {
  engine?.setFollowLive(e.detail !== false);
}
function onQuality(e) {
  engine?.setQuality(e.detail);
}
function onCamera(e) {
  engine?.setCamera(e.detail);
}
function onZoom(e) {
  engine?.setZoom(e.detail);
}
function onNight(e) {
  engine?.setNight(e.detail);
}
/* The venue is on the game, so this arrives separately from the at-bat and can
   arrive either side of it. setPark() re-solves whatever play is loaded, so the
   order does not matter. */
function onPark(e) {
  engine?.setPark(parkFor(e.detail?.venue, e.detail?.home));
}

function attach(mount) {
  engine = createEngine();
  engine.attach(mount);
  mount.addEventListener('barrels:atbat', onAtBat);
  mount.addEventListener('barrels:stage', onStage);
  mount.addEventListener('barrels:quality', onQuality);
  mount.addEventListener('barrels:camera', onCamera);
  mount.addEventListener('barrels:zoom', onZoom);
  mount.addEventListener('barrels:night', onNight);
  mount.addEventListener('barrels:park', onPark);
  mount.addEventListener('barrels:sound', onSound);
  mount.addEventListener('barrels:follow', onFollow);
  attached = mount;

  stopContact = engine.onContact(onContactCue);

  /* The other direction: tell the page what the play has revealed, so the HUD
     can hold a pitch's result until the ball actually gets there. */
  stopMoments = engine.onMoment((detail) => {
    mount.dispatchEvent(new CustomEvent('barrels:moment', { detail, bubbles: true }));
  });

  /* The at-bat and the park that were already selected: both events fire from
     React effects and this attach runs off a MutationObserver, so either may
     have gone out before we were listening. Read them off the handle rather
     than waiting for the next one. The park goes first — it decides where the
     wall is, and load() solves the batted ball against it. */
  const at = window.BarrelsReplay?.getCurrentPark?.();
  engine.setPark(parkFor(at?.venue, at?.home));
  const following = window.BarrelsReplay?.isFollowingLive?.() !== false;
  engine.setFollowLive(following);
  // Camera, zoom and night are Settings, so likewise decided before we came up.
  const look = window.BarrelsReplay?.getView?.();
  engine.setCamera(look?.camera ?? 'catcher');
  engine.setZoom(look?.zoom ?? 1);
  engine.setNight(!!look?.night);
  /* Following live, opening the viewer plays NOTHING: whatever is in the feed
     already happened before you got here. It stands the current batter in and
     waits for the next pitch. A play picked by hand is the opposite — it was
     asked for, so it plays. */
  if (following) engine.stage(window.BarrelsReplay?.getStagedAtBat?.() ?? null);
  else engine.load(window.BarrelsReplay?.getCurrentAtBat?.() ?? null);
  window.BarrelsReplay?.setEngineReady?.(true);

  // Dev handle for the field lab: lets a console (or a capture script) drive
  // the camera and pull a frame out. Stripped from production builds.
  if (import.meta.env.DEV) window.__replay = engine;
}

function detach() {
  attached?.removeEventListener('barrels:atbat', onAtBat);
  attached?.removeEventListener('barrels:stage', onStage);
  attached?.removeEventListener('barrels:quality', onQuality);
  attached?.removeEventListener('barrels:camera', onCamera);
  attached?.removeEventListener('barrels:zoom', onZoom);
  attached?.removeEventListener('barrels:night', onNight);
  attached?.removeEventListener('barrels:park', onPark);
  attached?.removeEventListener('barrels:sound', onSound);
  attached?.removeEventListener('barrels:follow', onFollow);
  stopMoments?.();
  stopMoments = null;
  stopContact?.();
  stopContact = null;
  cancelContact?.();
  cancelContact = null;
  engine?.detach();
  engine = null;
  attached = null;
}

function sync() {
  const mount = document.getElementById(MOUNT_ID);
  if (mount === attached) return;
  if (attached) detach();
  if (mount) attach(mount);
}

/** Start watching for the mount. Safe to call more than once. */
export function startReplayEngine() {
  if (startReplayEngine.started) return;
  startReplayEngine.started = true;

  new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
  sync();
}
