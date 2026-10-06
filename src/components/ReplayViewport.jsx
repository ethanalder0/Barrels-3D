import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { createFollowTracker } from '../replay/follow.js';
import { IconCube } from './Icons.jsx';
import ReplayHud, { CameraToast } from './ReplayHud.jsx';
import ReplayInterlude from './ReplayInterlude.jsx';
import { interludeFor } from '../replay/interlude.js';

/* ---------------------------------------------------------------------------
   REPLAY ENGINE MOUNT POINT
   ---------------------------------------------------------------------------
   Nothing in this file draws anything inside #replay-viewport, and nothing
   should. The div is handed over whole to the Three.js engine.

   Contract for the engine:

     const mount = document.getElementById('replay-viewport');
       · absolutely positioned, fills a 16:9 stage, `overflow: hidden` —
         wider than 16:9 when the window is too short to show it whole
       · always empty on the React side — React never writes children into it,
         so the engine can append a canvas and own it for the app's lifetime
       · size it from getBoundingClientRect() / a ResizeObserver on the mount;
         the surrounding layout never depends on the engine's own size

     window.BarrelsReplay
       · .getMount()          → the mount element (or null before first paint)
       · .getStage()          → the wrapper element, for fullscreen/overlays
       · .getCurrentAtBat()   → the at-bat object currently selected
       · .getStagedAtBat()    → while following live, the at-bat in progress:
                                who should be standing in the box
       · .getCurrentPark()    → { venue, home } for the game on screen
       · .isFollowingLive()   → whether the app is following the live game
       · .getView()           → { camera, zoom, night, trail, zone } from
                                Settings, as
                                the events below carry them
       · .setEngineReady(bool)→ hides/shows the "engine not mounted" placeholder

     Events (dispatched on the mount element, bubbling):
       · 'barrels:atbat'   detail = at-bat object — the engine's cue to PLAY.
                           Not following: the play picked by hand, on every
                           change of selection. Following live: one event per
                           NEW pitch, as the at-bat cut off at that pitch, once
                           its data is complete — never the at-bat already in
                           progress when the viewer opened (see replay/follow.js).
                           Every one carries an `eventId`, which the engine
                           echoes back on its moments.
       · 'barrels:stage'   detail = at-bat object — following live, who is up
                           now. Shown standing in between plays; never played.
       · 'barrels:quality' detail = 'low' | 'medium' | 'high' — render quality
                           from Settings
       · 'barrels:sound'   detail = boolean — whether Settings has sound on.
                           The engine schedules a recorded bat crack at
                           contact, so it has to be told when to stay quiet.
       · 'barrels:camera'  detail = 'catcher' | 'centerfield' — the shot every
                           play starts from: behind the plate, or the
                           broadcast shot from centre field.
       · 'barrels:zoom'    detail = number — how far Settings zooms that
                           shot. 1 is the stock framing, above 1 tighter,
                           below 1 wider.
       · 'barrels:night'   detail = boolean — night game: dark sky, field
                           under lights.
       · 'barrels:trail'   detail = boolean — whether to draw the ball's
                           flight path behind and ahead of it.
       · 'barrels:zone'    detail = boolean — whether to draw the strike zone
                           and the pitch's crossing mark.
       · 'barrels:follow'  detail = boolean — whether the app is following the
                           live game. Following, plays arrive on the feed's
                           schedule and the engine queues them so each one runs
                           to its end; not following, the viewer picked this
                           play by hand and it replaces whatever is on screen.
       · 'barrels:park'    detail = { venue, home } — which ballpark the game is
                           in, by venue name and home club abbreviation. Fires
                           on mount and whenever the game changes. The venue is
                           a property of the GAME, not of an at-bat, which is
                           why it needs an event of its own.
       · 'barrels:cyclecamera'  no detail — the HUD's camera button: move to
                           the next camera mode, exactly as the L key does.

     Events the engine sends back (also on the mount, bubbling):
       · 'barrels:moment'  detail = { pitch, contact, landed, awaiting, id,
                           busy } — what the play on screen has revealed so
                           far, which play that is (its eventId), and whether
                           anything is still playing or waiting its turn. The
                           HUD holds each readout until its moment, so the
                           result is not printed before the ball arrives.
       · 'barrels:cameramode'  detail = { mode, tracking } — the camera mode,
                           'catcher' | 'centerfield' | 'free', and whether free
                           roam is following the ball. Sent when either changes.

   The stage (not the mount) goes full screen, so the HUD overlay — a sibling
   of the mount — comes with it.

   The at-bat payload carries real tracked data when the game is live (see
   server/projection.py). The fields a replay actually needs:

     hit.launchSpeed / launchAngle / totalDistance   mph, degrees, feet
     hit.trajectory                                  'fly_ball' | 'line_drive' | …
     hit.coordinates {x, y}                          MLB landing grid, ~250x250,
                                                     home plate near (125.4, 203.5),
                                                     ≈2.29 ft per unit
     pitches[]                                       every pitch in the at-bat
     pitch.plate {x, z, szTop, szBottom}             plate location + strike zone
     batSide / pitchHand                             'L' | 'R'

   `hasReplay` is true only when a batted ball has landing coordinates, so it is
   a safe gate for offering playback.

   Because the mount is a plain DOM node addressed by id and event, the engine
   needs no React import and no change to this layout.
--------------------------------------------------------------------------- */

export const MOUNT_ID = 'replay-viewport';

/**
 * An at-bat with what the replay needs to dress both players: which clubs are
 * playing, and the numbers on the batter's and the pitcher's backs.
 *
 * Both are already in the snapshot — the `players` map is keyed by the same
 * ids the at-bat names — so this is a join, not a fetch. A player the map has
 * not got yet resolves to null and the jersey is left blank, which is the
 * right answer: an invented number on a real player is worse than none.
 */
export function forReplay(atBat, game, players) {
  if (!atBat) return null;
  const number = (id) => {
    const n = players?.[id]?.number;
    return n && n !== '—' ? n : null;
  };
  return {
    ...atBat,
    homeTeam: game?.home?.abbr ?? null,
    awayTeam: game?.away?.abbr ?? null,
    batterNumber: number(atBat.batterId),
    pitcherNumber: number(atBat.pitcherId),
  };
}

/* The panel around the stage. Addressed by id rather than a ref because the
   callers are siblings two levels away (the play picker, the leader boards). */
const PANEL_ID = 'replay-panel';

const prefersReducedMotion = () =>
  document.documentElement.dataset.reduceMotion === 'always' ||
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Scrolling is animated by hand rather than with `behavior: 'smooth'`, which
   some embedders (the desktop app's own browser pane among them) simply drop.
   Doing it on a rAF loop also lets a flick of the wheel take over mid-glide,
   which a native smooth scroll does not always allow. */
let scrollFrame = 0;

function glideTo(target) {
  cancelAnimationFrame(scrollFrame);
  const start = window.scrollY;
  const delta = target - start;
  if (Math.abs(delta) < 2) return;

  if (prefersReducedMotion()) {
    window.scrollTo(0, target);
    return;
  }

  const duration = Math.min(650, 200 + Math.abs(delta) * 0.4);
  const begun = performance.now();
  const stop = () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
    detach();
  };
  const detach = () => {
    for (const type of ['wheel', 'touchstart', 'keydown']) {
      window.removeEventListener(type, stop);
    }
  };
  for (const type of ['wheel', 'touchstart', 'keydown']) {
    window.addEventListener(type, stop, { passive: true });
  }

  const frame = (now) => {
    const u = Math.min(1, (now - begun) / duration);
    const eased = u < 0.5 ? 2 * u * u : 1 - ((-2 * u + 2) ** 2) / 2;
    window.scrollTo(0, start + delta * eased);
    if (u < 1) scrollFrame = requestAnimationFrame(frame);
    else detach();
  };
  scrollFrame = requestAnimationFrame(frame);
}

/**
 * Bring the replay into view, for anything that starts a replay from further
 * down the page — picking a play, or tapping a game leader. Without it the
 * play runs off screen and you have to scroll up and catch it.
 *
 * Centres the panel when it fits under the sticky header, otherwise pins its
 * top just below the header so the stage takes as much of the screen as it
 * can. Does nothing when the panel is already fully in view, so working down a
 * leader board does not nudge the page on every row.
 */
export function scrollReplayIntoView() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  const header =
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0;
  const rect = panel.getBoundingClientRect();
  if (rect.top >= header && rect.bottom <= window.innerHeight) return;

  /* Centre it in the space under the header when the whole panel fits, even
     barely — the stage is 16:9 and on a wide window it very nearly fills the
     screen on its own. When it cannot fit, pin the top just below the header. */
  const available = window.innerHeight - header;
  const slack = rect.height <= available ? (available - rect.height) / 2 : 12;
  glideTo(Math.max(0, rect.top + window.scrollY - header - slack));
}

/**
 * The HUD's view of the game around a picked play: score, inning, count, outs
 * and runners from the at-bat's own `situation` (see _situations in
 * server/projection.py) — `before` its last pitch until the play has reached
 * its result on screen, `after` from then on. With no engine reporting
 * (`reveal` null) there is nothing to wait for, so it is `after`.
 *
 * The matchup is that at-bat's, and on deck is whoever actually batted next
 * for the same side — the feed's own "on deck" belongs to the game now.
 */
function situationView(atBat, reveal, live) {
  const game = live.game;
  if (!game) return null;
  const done = !reveal || (reveal.landed && !reveal.awaiting);
  const s = atBat.situation[done ? 'after' : 'before'];
  if (!s) return null;

  let next = null;
  for (const ab of live.atBats ?? []) {
    if (ab.half === atBat.half && ab.atBatIndex > atBat.atBatIndex) {
      if (!next || ab.atBatIndex < next.atBatIndex) next = ab;
    }
  }

  return {
    game: {
      ...game,
      status: 'live',
      away: { ...game.away, runs: s.away },
      home: { ...game.home, runs: s.home },
      state: { inning: atBat.inning, half: atBat.half, balls: s.balls, strikes: s.strikes, outs: s.outs },
    },
    bases: s.bases,
    matchup: { batter: atBat.batter, pitcher: atBat.pitcher, onDeck: next?.batter ?? null },
  };
}

export default function ReplayViewport({
  atBat,
  quality,
  camera,
  zoom,
  night,
  trail,
  zone,
  units,
  sound,
  venue,
  homeTeam,
  followLatest,
  onFollowLatest,
  highlights,
  onHighlightNext,
}) {
  const stageRef = useRef(null);
  const mountRef = useRef(null);
  const atBatRef = useRef(atBat);
  atBatRef.current = atBat;
  const parkRef = useRef(null);
  parkRef.current = { venue, home: homeTeam };
  const followRef = useRef(true);
  const viewRef = useRef(null);
  viewRef.current = {
    camera: camera ?? 'catcher',
    zoom: zoom ?? 1,
    night: !!night,
    trail: trail !== false,
    zone: zone !== false,
  };
  followRef.current = followLatest !== false;
  const [moment, setMoment] = useState(null);
  /* The same, but current the instant the engine says it. Effects in the
     commit that hands the engine a play run with the render's `moment`, which
     is the one from BEFORE that play started; anything deciding on it there
     would be deciding on the previous play. */
  const momentRef = useRef(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [cameraMode, setCameraMode] = useState(null);

  const live = useLiveData();
  const following = followLatest !== false;

  /* --- Following live, pitch by pitch -----------------------------------
     See replay/follow.js for the rules. The tracker is per mount, so every
     time the viewer opens it takes a fresh baseline and plays nothing that
     happened before you got here. */
  const trackerRef = useRef(null);
  if (!trackerRef.current) trackerRef.current = createFollowTracker();
  // Every at-bat handed to the engine, by eventId, with the game as it stood
  // once that pitch was in: what the HUD shows once the play has shown it.
  const eventsRef = useRef(new Map());
  const stagedRef = useRef(null);
  const stageKeyRef = useRef('');

  /* --- Holding the HUD back ---------------------------------------------
     The feed knows how a pitch ended the instant it is in; the picture does
     not until the ball has been thrown. So while following, the moment the
     feed has something the picture has not shown yet, the score, count, outs,
     runners and matchup the HUD draws are held at how they stood BEFORE it,
     and move on only as each play reaches its result on screen. When nothing
     is playing, queued or waiting on data, the HUD is simply live again. */
  const hudRef = useRef(null);
  hudRef.current = { game: live.game, bases: live.bases, matchup: live.matchup };
  const prevHudRef = useRef(null);
  const [held, setHeld] = useState(null);
  const heldRef = useRef(null);
  heldRef.current = held;
  const hold = (value) => {
    heldRef.current = value;
    setHeld(value);
  };

  /* Layout effect, not a passive one: the engine attaches from a
     MutationObserver microtask as soon as the mount hits the DOM and reports
     its first moment straight away. A passive effect can run after that and
     miss it; a layout effect runs inside the commit, before any microtask. */
  useLayoutEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const onMoment = (e) => {
      momentRef.current = e.detail;
      setMoment(e.detail);
    };
    const onCamera = (e) => setCameraMode(e.detail);
    mount.addEventListener('barrels:moment', onMoment);
    mount.addEventListener('barrels:cameramode', onCamera);
    return () => {
      mount.removeEventListener('barrels:moment', onMoment);
      mount.removeEventListener('barrels:cameramode', onCamera);
    };
  }, []);

  const cycleCamera = useCallback(() => {
    mountRef.current?.dispatchEvent(new CustomEvent('barrels:cyclecamera', { bubbles: true }));
  }, []);

  /* Native full screen where the browser allows it. Where it does not — an
     iPhone, which has no element full screen, or an embedding frame without
     permission — the stage expands to fill the window instead, which is the
     same view minus the browser chrome. */
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return undefined;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden'; // the page must not scroll under it
    return () => {
      root.style.overflow = previous;
    };
  }, [expanded]);

  const toggleFullscreen = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const current = document.fullscreenElement ?? document.webkitFullscreenElement;
    if (current) {
      (document.exitFullscreen ?? document.webkitExitFullscreen)?.call(document);
      return;
    }
    if (stage.dataset.expanded === 'true') {
      setExpanded(false);
      return;
    }
    const request = stage.requestFullscreen ?? stage.webkitRequestFullscreen;
    if (!request) {
      setExpanded(true);
      return;
    }
    try {
      Promise.resolve(request.call(stage)).catch(() => setExpanded(true));
    } catch {
      setExpanded(true);
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const current = document.fullscreenElement ?? document.webkitFullscreenElement;
      setFullscreen(!!current && current === stageRef.current);
    };
    // F toggles, as in every video player. Not while typing somewhere.
    const onKey = (e) => {
      if (e.key === 'Escape' && stageRef.current?.dataset.expanded === 'true') {
        setExpanded(false);
        return;
      }
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      toggleFullscreen();
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      window.removeEventListener('keydown', onKey);
    };
  }, [toggleFullscreen]);

  // Publish the imperative handle the engine picks up.
  useEffect(() => {
    window.BarrelsReplay = {
      getMount: () => mountRef.current,
      getStage: () => stageRef.current,
      getCurrentAtBat: () => atBatRef.current,
      getStagedAtBat: () => stagedRef.current,
      getCurrentPark: () => parkRef.current,
      isFollowingLive: () => followRef.current,
      getView: () => viewRef.current,
      setEngineReady: (ready) => {
        if (stageRef.current) stageRef.current.dataset.engine = ready ? 'ready' : 'idle';
      },
    };
    return () => {
      delete window.BarrelsReplay;
    };
  }, []);

  /* Which mode the engine is in has to reach it BEFORE the at-bat does, or the
     first play of a hand-picked selection queues behind the live one. Same
     effect, one statement earlier: effects run in order. */
  useEffect(() => {
    mountRef.current?.dispatchEvent(
      new CustomEvent('barrels:follow', { detail: followLatest !== false, bubbles: true }),
    );
  }, [followLatest]);

  /* What to play. Broadcast as DOM events, not props.

     Not following, it is the play picked by hand, re-sent as it changes; the
     engine ignores a copy that has not changed.

     Following, it is never the selection. The newest at-bat is re-sent on
     every poll and changes under you — it is the at-bat in progress when you
     open the viewer, then the next batter with no pitch in it — and playing
     it is what opened a live game on replays of things that had already
     happened. Instead each new pitch goes over once, when it is complete, and
     the at-bat in progress is STAGED: its batter stands in, waiting. */
  const { atBats: feedAtBats, game: feedGame, players: feedPlayers, ready: feedReady } = live;

  /* The eventId a picked play goes out under. Minted when the pick changes —
     not on every poll, or the engine would restart it each time — and, while
     highlights run, unique to that run: starting highlights on the play that
     is already on screen has to play it again, and the engine only replays a
     play it is handed under a new id. Stopping them keeps the id, so the play
     on screen carries on rather than starting over. */
  const pickRef = useRef({ id: null, run: null, eventId: null });
  if (!following && atBat) {
    const p = pickRef.current;
    if (p.id !== atBat.id || (highlights && p.run !== highlights)) {
      pickRef.current = {
        id: atBat.id,
        run: highlights ?? null,
        eventId: highlights ? `pick:${atBat.id}#${highlights}` : `pick:${atBat.id}`,
      };
    }
  }

  useEffect(() => {
    const send = (type, detail) =>
      mountRef.current?.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
    const tracker = trackerRef.current;

    if (!following) {
      tracker.reset();
      stageKeyRef.current = '';
      if (heldRef.current) hold(null);
      if (!atBat) return;
      const picked = { ...atBat, eventId: pickRef.current.eventId };
      eventsRef.current.set(picked.eventId, { atBat: picked, after: null });
      send('barrels:atbat', picked);
      return;
    }

    /* Wait for the game's own snapshot. Until it lands the at-bat list is
       empty (or the demo's), and a baseline taken on that would make every
       pitch of the game "new" the moment the real list arrived. */
    if (!feedReady) return;
    const gameKey = feedGame?.id ?? null;

    if (!tracker.isFor(gameKey)) {
      tracker.baseline(feedAtBats, gameKey);
      // Keep only what may still be on screen: a picked play finishing up.
      for (const id of eventsRef.current.keys()) if (!id.startsWith('pick:')) eventsRef.current.delete(id);
      if (heldRef.current) hold(null);
    } else {
      const { ready, unseen } = tracker.update(feedAtBats);
      if (unseen && !heldRef.current) hold(prevHudRef.current ?? hudRef.current);
      for (const e of ready) {
        const ev = { ...forReplay(e.atBat, feedGame, feedPlayers), eventId: e.id };
        eventsRef.current.set(e.id, { atBat: ev, after: hudRef.current });
        send('barrels:atbat', ev);
      }
    }

    /* Who is up. Re-sent only when that changes — a new batter, or this one's
       plate appearance ending — not on every poll. */
    const current = forReplay(feedAtBats[0] ?? null, feedGame, feedPlayers);
    const stageKey = current ? `${current.id}|${current.kind}|${current.batterNumber}` : 'none';
    if (stageKey !== stageKeyRef.current) {
      stageKeyRef.current = stageKey;
      stagedRef.current = current;
      send('barrels:stage', current);
    }
    prevHudRef.current = hudRef.current;
  }, [following, atBat, highlights, feedAtBats, feedGame, feedPlayers, feedReady]);

  /* --- Highlights --------------------------------------------------------
     Every play in the picker, oldest first, each one played to its end before
     the next is picked. "Its end" is the engine's word for it: the moment
     that names this play's eventId and says nothing is busy any more — so a
     pause pauses the highlights too, and a play with nothing to draw moves
     straight on. The list is read fresh each time, so in a live game plays
     that happen while the highlights run are reached as well.

     onHighlightNext gets the next play's id, or null after the newest one —
     where the screen decides between following live and simply stopping.

     The timer is for an engine that never takes the play up at all (no
     WebGL, or a play still waiting on its tracked data): rather than stall,
     the highlights move on. */
  const advancedRef = useRef(null);
  const atBatId = atBat?.id ?? null;
  useEffect(() => {
    if (!highlights || following || !atBatId) return undefined;
    const expected = pickRef.current.eventId;
    const next = () => {
      if (advancedRef.current === expected) return;
      advancedRef.current = expected;
      const at = feedAtBats.findIndex((ab) => ab.id === atBatId);
      onHighlightNext?.(at > 0 ? feedAtBats[at - 1].id : null);
    };
    const m = momentRef.current;
    if (m?.id === expected) {
      if (!m.busy && !m.awaiting) next();
      return undefined;
    }
    const timer = setTimeout(() => {
      if (momentRef.current?.id !== expected) next();
    }, 8000);
    return () => clearTimeout(timer);
  }, [highlights, following, atBatId, moment, feedAtBats, onHighlightNext]);

  /* Let the HUD move on as the picture does: to the state after each play once
     that play has reached its result, and back to live once there is nothing
     left to show.

     Each play's result is applied ONCE, while it is on screen. Without both
     conditions a play that had long finished could reach back and overwrite a
     newer hold: with the engine idle on the last out of an inning, the first
     pitch of the next half started a hold at 0-0, and the finished third out —
     still the engine's last word, and still "landed" — put its own 1-2 back
     over it for the whole of the new pitch. */
  useEffect(() => {
    const m = momentRef.current;
    if (!following || !held || !m) return;
    if (!m.busy && trackerRef.current.waiting === 0) {
      hold(null);
      return;
    }
    const ev = eventsRef.current.get(m.id);
    if (ev?.after && m.busy && m.landed && !ev.applied) {
      ev.applied = true;
      hold(ev.after);
    }
  }, [following, held, moment]);

  /* --- Before the game, between innings, and the end ---------------------
     While following, once the picture has CAUGHT UP — the third out has been
     played, nothing is queued, nothing is waiting on data, the HUD is live
     again — the game is asked whether it is on a break or over (see
     replay/interlude.js). Asking any earlier would put the break screen up
     over the very pitch that ended the half.

     A break stays up until the next pitch actually starts playing, not until
     the feed says the next half has begun: the next batter's at-bat appears
     a minute before he sees a pitch, and dropping the screen then would just
     bring back the empty wait it exists to cover. That pitch goes straight
     to an idle engine, so it plays the moment it is in; anything behind it
     queues as usual. A picked play, or turning Follow live off, clears it. */
  const [interlude, setInterlude] = useState(null);
  const liveGame = live.game;
  useEffect(() => {
    if (!following) {
      if (interlude) setInterlude(null);
      return;
    }
    const m = momentRef.current;
    if (!m) return;
    const playing = m.busy && m.id != null && !String(m.id).startsWith('pick:');
    if (playing) {
      if (interlude) setInterlude(null);
      return;
    }
    const caughtUp = !m.busy && trackerRef.current.waiting === 0 && !held;
    if (!caughtUp) return;
    const started = feedAtBats.some((ab) => ab.pitches?.length > 0);
    const next = interludeFor(liveGame, { started });
    // Keys are per game: two games' final screens are both 'final', and
    // without the id, switching games kept the first one's label (Final/10).
    const key = next && `${liveGame?.gamePk}|${next.key}`;
    if (next && key !== interlude?.key) setInterlude({ ...next, key });
  }, [following, moment, held, liveGame, feedAtBats, interlude]);

  /* The play the HUD describes is the one the ENGINE is showing, named by the
     eventId on its moments — never simply the newest at-bat, which can be a
     pitch or two ahead of the picture. */
  let shown = null;
  let reveal = moment;
  if (!moment) {
    shown = following ? null : atBat; // no engine: nothing to wait for
  } else if (!following && moment.awaiting) {
    shown = atBat;
    reveal = { pitch: false, contact: false, landed: false, awaiting: true };
  } else {
    shown = eventsRef.current.get(moment.id)?.atBat ?? null;
    /* A play picked by hand that is still finishing when Follow live is
       pressed keeps its card until it ends; after that, following shows who
       is up rather than a play that is not part of the live game. */
    if (following && shown?.eventId?.startsWith('pick:') && !moment.busy) shown = null;
  }
  /* A play picked by hand shows the game as it stood THEN, not as it stands
     now: an old play under a bug reading "Final" says nothing. The backend
     records each at-bat's situation just before its last pitch and once the
     play is over; the HUD shows the first while the pitch is on its way and
     moves to the second as the play reaches its result, exactly as it does
     following live. */
  const picked = !following && shown?.situation ? situationView(shown, reveal, live) : null;
  const hud = picked ?? (following && held ? held : hudRef.current);
  const highlightAt = highlights && atBat ? live.atBats.findIndex((ab) => ab.id === atBat.id) : -1;

  useEffect(() => {
    mountRef.current?.dispatchEvent(
      new CustomEvent('barrels:quality', { detail: quality, bubbles: true }),
    );
  }, [quality]);

  useEffect(() => {
    mountRef.current?.dispatchEvent(
      new CustomEvent('barrels:camera', { detail: camera ?? 'catcher', bubbles: true }),
    );
  }, [camera]);

  useEffect(() => {
    mountRef.current?.dispatchEvent(
      new CustomEvent('barrels:zoom', { detail: zoom ?? 1, bubbles: true }),
    );
  }, [zoom]);

  useEffect(() => {
    mountRef.current?.dispatchEvent(
      new CustomEvent('barrels:night', { detail: !!night, bubbles: true }),
    );
  }, [night]);

  useEffect(() => {
    mountRef.current?.dispatchEvent(
      new CustomEvent('barrels:trail', { detail: trail !== false, bubbles: true }),
    );
  }, [trail]);

  useEffect(() => {
    mountRef.current?.dispatchEvent(
      new CustomEvent('barrels:zone', { detail: zone !== false, bubbles: true }),
    );
  }, [zone]);

  useEffect(() => {
    mountRef.current?.dispatchEvent(
      new CustomEvent('barrels:sound', { detail: sound !== false, bubbles: true }),
    );
  }, [sound]);

  useEffect(() => {
    mountRef.current?.dispatchEvent(
      new CustomEvent('barrels:park', {
        detail: { venue, home: homeTeam },
        bubbles: true,
      }),
    );
  }, [venue, homeTeam]);

  return (
    <section className="panel" id={PANEL_ID} aria-label="3D replay">
      <div className="panel__head viewport__head">
        <div className="panel__title">
          <IconCube />
          <h3>Replay</h3>
        </div>
        <div className="panel__title">
          {/* Only for a play picked by hand: following live, what is on screen
              is simply the game, and the HUD already names the batter. */}
          {highlights && highlightAt >= 0 ? (
            <span className="chip viewport__status u-num">
              Highlights {live.atBats.length - highlightAt} / {live.atBats.length}
            </span>
          ) : (
            !following &&
            atBat?.hasReplay && <span className="chip viewport__status">Tracked data ready</span>
          )}
          {followLatest ? (
            <span className="chip chip--live chip--dot">Following live</span>
          ) : (
            <button type="button" className="btn btn--ghost btn--sm" onClick={onFollowLatest}>
              Follow live
            </button>
          )}
        </div>
      </div>

      <div className="viewport__stage" ref={stageRef} data-engine="idle" data-expanded={expanded}>
        <div className="viewport__grid" aria-hidden="true" />

        {/* ↓↓↓ The mount point. Keep it empty. ↓↓↓ */}
        <div id={MOUNT_ID} ref={mountRef} />
        {/* ↑↑↑ The mount point. Keep it empty. ↑↑↑ */}

        <div className="viewport__placeholder">
          <span className="viewport__badge">
            <IconCube size={14} /> 3D Replay
          </span>
          <p className="viewport__title">Viewport reserved</p>
          <p className="viewport__note">
            The replay engine mounts into <code className="viewport__mountid">#{MOUNT_ID}</code> and
            fills this stage. Selection updates arrive as{' '}
            <code className="viewport__mountid">barrels:atbat</code> events.
          </p>
          {atBat?.hasReplay && (
            <p className="viewport__note viewport__note--data">
              {atBat.batter} · {atBat.result} — {atBat.exitVelo} mph off the bat at{' '}
              {atBat.launchAngle}°, {atBat.distance} ft
              {atBat.hit?.trajectory ? ` (${atBat.hit.trajectory.replace('_', ' ')})` : ''}
            </p>
          )}
        </div>

        {/* Free roam is for looking round the park, break or not: the card
            would sit in the middle of the view and swallow every drag. */}
        {interlude && cameraMode?.mode !== 'free' ? (
          <ReplayInterlude
            interlude={interlude}
            game={liveGame}
            lineScore={live.lineScore}
            fullscreen={fullscreen || expanded}
            onToggleFullscreen={toggleFullscreen}
          />
        ) : (
          <ReplayHud
            atBat={shown}
            waiting={following ? (stagedRef.current ?? null) : null}
            view={hud}
            tag={
              highlights && atBat
                ? `Highlights · ${atBat.inningLabel}`
                : !following && !!atBat && live.atBats[0]?.id !== atBat.id
                  ? `Replay · ${atBat.inningLabel}`
                  : null
            }
            camera={cameraMode}
            onCycleCamera={cycleCamera}
            moment={reveal}
            units={units}
            fullscreen={fullscreen || expanded}
            onToggleFullscreen={toggleFullscreen}
          />
        )}

        <div className="hud hud--toasts">
          <CameraToast camera={cameraMode} />
        </div>
      </div>

      {/* A closing rail under the stage, matching the banner above it: the same
          surface and the same hairline, half the height and deliberately empty.
          Without it the canvas runs straight into the panel's bottom edge and
          the stage reads as unfinished on one side only. */}
      <div className="viewport__foot" aria-hidden="true" />
    </section>
  );
}
