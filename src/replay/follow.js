/* ---------------------------------------------------------------------------
   FOLLOWING LIVE — which pitches to show, and when.
   ---------------------------------------------------------------------------
   Following a live game used to mean "play whatever the newest at-bat is", and
   the newest at-bat is the wrong unit. It is re-sent on every poll, it changes
   while you watch it (a pitch lands, then its result fills in), and the moment
   the next batter steps in it is an at-bat with no pitch in it at all. Played
   as a stream of at-bats, a live game opened on a replay of something that
   happened before you arrived, then on the middle of the current at-bat, then
   on repeats of pitches already shown.

   The unit is the PITCH. Every pitch in the feed has an identity — its at-bat
   and its number — and this tracks which ones have been dealt with:

     · Opening the viewer takes a BASELINE: every pitch already in the feed
       counts as seen. Nothing plays until something happens after you arrived.
     · After that, each new pitch is handed over exactly once, as the at-bat
       cut off at that pitch, and never again however many times the feed
       re-sends it with more detail.
     · A pitch is handed over only once its data is all there. A ball in play
       waits for the at-bat to close (see isAwaitingDetail in play.js for the
       trap that avoids); any other pitch waits for its plate location, which
       is what the strike zone and the flight are built from.
     · A pitch that never completes cannot hold up the game. As soon as a later
       pitch is ready, anything still waiting ahead of it is dropped.

   Pure: no DOM, no Three.js, no React. ReplayViewport owns one and feeds it
   every snapshot; the selftest drives it with fabricated ones.
--------------------------------------------------------------------------- */

/** A pitch's identity: its at-bat and its number within it. */
export function pitchId(atBat, index) {
  const number = atBat.pitches[index]?.number;
  return `${atBat.id}#${number ?? index + 1}`;
}

const isInPlay = (pitch) => pitch?.isInPlay === true || pitch?.outcome === 'inplay';

/** Has this pitch got everything a replay of it needs? */
export function pitchReady(atBat, index) {
  const pitch = atBat.pitches[index];
  if (isInPlay(pitch)) return atBat.kind !== 'live';
  return Number.isFinite(pitch?.plate?.x) && Number.isFinite(pitch?.plate?.z);
}

/**
 * Balls and strikes going into each pitch: [before, after] for `index`.
 *
 * A foul with two strikes leaves the count alone; the display caps at 3-2,
 * the way a scorebug does (ball four and strike three are the result, not a
 * count).
 */
export function countAt(pitches, index) {
  let balls = 0;
  let strikes = 0;
  const apply = (p) => {
    if (p?.isBall || p?.outcome === 'ball') balls += 1;
    else if (p?.isStrike && !(p.outcome === 'foul' && strikes >= 2)) strikes += 1;
  };
  for (let i = 0; i < index; i++) apply(pitches[i]);
  const before = { balls: Math.min(balls, 3), strikes: Math.min(strikes, 2) };
  apply(pitches[index]);
  return [before, { balls: Math.min(balls, 3), strikes: Math.min(strikes, 2) }];
}

/**
 * The at-bat as it stood the instant this pitch was thrown.
 *
 * The engine shows the last pitch of whatever at-bat it is given, so replaying
 * pitch two of a seven-pitch at-bat means handing it the at-bat with two
 * pitches in it. Anything the at-bat only knew later — how it ended, the
 * batted ball it ended with, the count it ended on — belongs to the final
 * pitch and is stripped from every earlier one. The count is recounted from
 * the pitches before it, so the scorebug over pitch two does not read the
 * full count the at-bat finished on.
 */
export function atBatAtPitch(atBat, index) {
  const pitches = atBat.pitches.slice(0, index + 1);
  const pitch = pitches[index];
  if (index === atBat.pitches.length - 1) return { ...atBat, pitches, pitch };
  const [before, after] = countAt(atBat.pitches, index);
  const at = atBat.situation?.before;
  return {
    ...atBat,
    pitches,
    pitch,
    situation: at ? { before: { ...at, ...before }, after: { ...at, ...after } } : atBat.situation,
    kind: 'live',
    live: true,
    result: 'At bat',
    eventType: null,
    rbi: 0,
    isScoringPlay: false,
    exitVelo: null,
    launchAngle: null,
    distance: null,
    hit: null,
    hasReplay: false,
  };
}

/** Every pitch in the feed, oldest first. `atBats` arrives newest first. */
export function pitchEvents(atBats) {
  const out = [];
  for (let a = atBats.length - 1; a >= 0; a--) {
    const atBat = atBats[a];
    const pitches = Array.isArray(atBat?.pitches) ? atBat.pitches : [];
    for (let i = 0; i < pitches.length; i++) {
      out.push({ id: pitchId(atBat, i), atBat, index: i, ready: pitchReady(atBat, i) });
    }
  }
  return out;
}

export function createFollowTracker() {
  let scope = null; // which game the baseline belongs to
  let seen = null; // Set of pitch ids, null until a baseline is taken
  const waiting = new Set();

  return {
    /** Whether a baseline has been taken for `key` (the game). */
    isFor: (key) => seen !== null && scope === key,

    /** Forget everything. The next update takes a fresh baseline. */
    reset() {
      scope = null;
      seen = null;
      waiting.clear();
    },

    /** Everything in the feed right now counts as already seen. */
    baseline(atBats, key) {
      scope = key;
      seen = new Set(pitchEvents(atBats).map((e) => e.id));
      waiting.clear();
    },

    /** Pitches seen in the feed but not complete enough to show yet. */
    get waiting() {
      return waiting.size;
    },

    /**
     * Take a snapshot's at-bats and return what is new in it.
     *
     *   ready   pitches to show now, oldest first, each as { id, atBat } with
     *           the at-bat cut off at that pitch
     *   unseen  how many pitches the feed has that have not been shown — ready
     *           or not. Non-zero means something has happened on the field
     *           that the picture has not caught up with yet.
     */
    update(atBats) {
      if (!seen) throw new Error('follow tracker: update() before baseline()');
      const fresh = pitchEvents(atBats).filter((e) => !seen.has(e.id));

      let lastReady = -1;
      fresh.forEach((e, i) => {
        if (e.ready) lastReady = i;
      });

      const ready = [];
      waiting.clear();
      fresh.forEach((e, i) => {
        if (e.ready) {
          seen.add(e.id);
          ready.push({ id: e.id, atBat: atBatAtPitch(e.atBat, e.index) });
        } else if (i < lastReady) {
          seen.add(e.id); // overtaken by a later pitch that is ready: skip it
        } else {
          waiting.add(e.id);
        }
      });

      return { ready, unseen: fresh.length };
    },
  };
}
