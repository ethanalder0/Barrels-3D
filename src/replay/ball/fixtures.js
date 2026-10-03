/* ---------------------------------------------------------------------------
   LIVE-SHAPED FIXTURES
   ---------------------------------------------------------------------------
   src/data/stubs.js carries the app's offline fallback, which is the FLAT
   at-bat shape: exitVelo / launchAngle / distance and nothing else. That shape
   has no hit coordinates, so every ball reconstructed from it flies to dead
   center — fine for checking carry and hang time, useless for checking
   direction, and it never touches the `hit` branch of the adapter at all.

   These are the other shape: what server/projection.py actually emits for a
   live game, with `hit.coordinates` on the MLB grid and `pitches[].plate` for
   the strike zone. Used by the selftest to cover the live path, and by the lab
   so there is something on screen that is not hit straight up the middle.

   The coordinates are hand-placed to put each ball somewhere recognisable;
   the exit velocities and distances are the kind of numbers the feed carries.
--------------------------------------------------------------------------- */

const pitch = (type, velo, x, z, szTop = 3.38, szBottom = 1.62) => ({
  type,
  velo,
  plate: { x, z, szTop, szBottom },
});

export const liveAtBats = [
  {
    id: 'live-hr-rf',
    inningLabel: 'B6',
    batter: 'Pulled home run (right field)',
    result: 'Home Run',
    kind: 'hr',
    batSide: 'L',
    pitchHand: 'R',
    exitVelo: 106.2,
    launchAngle: 29,
    distance: 421,
    hit: {
      launchSpeed: 106.2,
      launchAngle: 29,
      totalDistance: 421,
      trajectory: 'fly_ball',
      hardness: 'hard',
      // Well into right field: coordX above home's 125.42, coordY well out.
      coordinates: { x: 188.0, y: 40.4 }, // right field, 400 ft out at +21 deg
    },
    pitches: [pitch('Four-Seam Fastball', 94.6, 0.42, 2.55)],
    hasReplay: true,
  },
  {
    id: 'live-double-lf',
    inningLabel: 'T5',
    batter: 'Double into the left-field corner',
    result: 'Double',
    kind: 'hit',
    batSide: 'R',
    pitchHand: 'L',
    exitVelo: 102.8,
    launchAngle: 21,
    distance: 338,
    hit: {
      launchSpeed: 102.8,
      launchAngle: 21,
      totalDistance: 338,
      trajectory: 'line_drive',
      hardness: 'hard',
      coordinates: { x: 49.1, y: 81.3 }, // left-field corner, 330 ft at -32 deg
    },
    pitches: [pitch('Slider', 85.1, -0.63, 1.94)],
    hasReplay: true,
  },
  {
    id: 'live-flyout-cf',
    inningLabel: 'T5',
    batter: 'Deep fly out to center',
    result: 'Flyout',
    kind: 'out',
    batSide: 'R',
    pitchHand: 'R',
    exitVelo: 99.4,
    launchAngle: 33,
    distance: 372,
    hit: {
      launchSpeed: 99.4,
      launchAngle: 33,
      totalDistance: 372,
      trajectory: 'fly_ball',
      hardness: 'medium',
      coordinates: { x: 133.9, y: 41.3 }, // center field, 372 ft at +3 deg
    },
    pitches: [pitch('Changeup', 87.3, 0.05, 2.21)],
    hasReplay: true,
  },
  {
    id: 'live-groundout-ss',
    inningLabel: 'B4',
    batter: 'Ground out to shortstop',
    result: 'Groundout',
    kind: 'out',
    batSide: 'L',
    pitchHand: 'R',
    exitVelo: 91.7,
    launchAngle: -6,
    distance: 68,
    hit: {
      launchSpeed: 91.7,
      launchAngle: -6,
      totalDistance: 68,
      trajectory: 'ground_ball',
      hardness: 'medium',
      coordinates: { x: 102.0, y: 145.6 }, // the shortstop, 143 ft at -22 deg
    },
    pitches: [pitch('Sinker', 93.9, -0.31, 1.77)],
    hasReplay: true,
  },
  {
    id: 'live-single-cf',
    inningLabel: 'T5',
    batter: 'Ground ball single up the middle',
    result: 'Single',
    kind: 'hit',
    batSide: 'L',
    pitchHand: 'R',
    exitVelo: 97.6,
    launchAngle: -1,
    distance: 58,
    hit: {
      launchSpeed: 97.6,
      launchAngle: -1,
      totalDistance: 58,
      trajectory: 'ground_ball',
      hardness: 'hard',
      /* The centre fielder fields it 232 ft out. Note the disagreement with
         totalDistance above: 58 ft is a projected carry and this ball never
         carried — it was through the infield and still going. The adapter
         takes the larger of the two for exactly this case. */
      coordinates: { x: 129.0, y: 102.3 },
    },
    pitches: [pitch('Four-Seam Fastball', 96.1, 0.11, 2.42)],
    hasReplay: true,
  },
  {
    id: 'live-lineout-3b',
    inningLabel: 'B4',
    batter: 'Line out to third',
    result: 'Lineout',
    kind: 'out',
    batSide: 'R',
    pitchHand: 'R',
    exitVelo: 104.1,
    launchAngle: 6,
    distance: 104,
    hit: {
      launchSpeed: 104.1,
      launchAngle: 6,
      totalDistance: 104,
      trajectory: 'line_drive',
      hardness: 'hard',
      coordinates: { x: 95.3, y: 165.0 }, // third base, 112 ft at -38 deg
    },
    pitches: [pitch('Cutter', 90.2, -0.48, 2.86)],
    hasReplay: true,
  },
];

/* ---------------------------------------------------------------------------
   THE TWO-UPDATE PAIR
   ---------------------------------------------------------------------------
   Captured verbatim off the replay stream for TB @ ATL on 2026-09-10 — Yandy
   Diaz, first at-bat of the game. A ball put in play reaches the feed twice,
   and these are the two payloads, in order.

   The first one is the dangerous one. It already carries exit velocity, launch
   angle and distance — everything the solver needs — and its coordinates are
   a pair of nulls. Built as-is it makes a confident 163 ft ground ball to dead
   centre. The ball actually went to left field, 224 ft away, which only the
   second payload knows.

   Both share the same final pitch, which is the point: the pitch count does
   not change between them, so nothing about the pitch tells you to wait. Only
   `kind` does.
--------------------------------------------------------------------------- */

const DIAZ_IN_PLAY_PITCH = {
  number: 8,
  type: 'Changeup',
  code: 'CH',
  velo: 80,
  call: 'In play, no out',
  callCode: 'D',
  outcome: 'inplay',
  isInPlay: true,
  isStrike: false,
  isBall: false,
  plate: {
    x: 0.2733159938469568,
    z: 0.942284286110308,
    szTop: 3.228,
    szBottom: 1.629,
    halfWidth: 0.7083333333333334,
    ballRadius: 0.12083333333333333,
  },
};

/** What the feed says first: in play, nothing resolved. */
export const inPlayVague = {
  id: 'ab-0',
  atBatIndex: 0,
  inningLabel: 'T1',
  batter: 'Yandy Díaz',
  pitcher: 'Martín Pérez',
  batSide: 'R',
  pitchHand: 'L',
  result: 'At bat',
  eventType: null,
  kind: 'live',
  detail: '3-2 count, 0 out',
  exitVelo: 94,
  launchAngle: 8,
  distance: 163,
  hit: {
    launchSpeed: 94,
    launchAngle: 8,
    totalDistance: 163,
    trajectory: null,
    hardness: null,
    location: null,
    coordinates: { x: null, y: null },
  },
  pitch: DIAZ_IN_PLAY_PITCH,
  pitches: [DIAZ_IN_PLAY_PITCH],
  hasReplay: false,
  live: true,
};

/** What the feed says a moment later, and what the replay should show. */
export const inPlayDetailed = {
  ...inPlayVague,
  result: 'Single',
  eventType: 'single',
  kind: 'hit',
  detail: 'Yandy Díaz singles on a ground ball to left fielder Brewer Hicklen.',
  hit: {
    launchSpeed: 94,
    launchAngle: 8,
    totalDistance: 163,
    trajectory: 'ground_ball',
    hardness: 'medium',
    location: '7',
    coordinates: { x: 83.49, y: 119.57 },
  },
  hasReplay: true,
  live: false,
};
