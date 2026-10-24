/* ---------------------------------------------------------------------------
   Placeholder data. Nothing here is wired to a backend yet — the shapes below
   are the contract the real feed should eventually satisfy, so swapping in a
   fetch layer means replacing this module and nothing else.
--------------------------------------------------------------------------- */

export const games = [
  {
    id: 'g-2451',
    status: 'live', // 'live' | 'final' | 'scheduled'
    startsAt: '7:10 PM',
    venue: 'Cedar Park',
    away: { id: 'rvr', abbr: 'RVR', name: 'River Kings', record: '61-48', runs: 3 },
    home: { id: 'orc', abbr: 'ORC', name: 'Orchard Nine', record: '58-51', runs: 4 },
    state: { inning: 7, half: 'bottom', outs: 1, balls: 2, strikes: 1 },
  },
  {
    id: 'g-2452',
    status: 'live',
    startsAt: '7:05 PM',
    venue: 'Foundry Field',
    away: { id: 'grn', abbr: 'GRN', name: 'Granite Bay', record: '55-54', runs: 1 },
    home: { id: 'hlw', abbr: 'HLW', name: 'Hollow Ridge', record: '62-47', runs: 1 },
    state: { inning: 5, half: 'top', outs: 2, balls: 0, strikes: 2 },
  },
  {
    id: 'g-2453',
    status: 'final',
    startsAt: '1:05 PM',
    venue: 'Kettle Yard',
    away: { id: 'mrn', abbr: 'MRN', name: 'Marina Salts', record: '49-60', runs: 2 },
    home: { id: 'pnr', abbr: 'PNR', name: 'Pioneer Rail', record: '53-56', runs: 7 },
    state: { inning: 9, half: 'bottom', outs: 3, balls: 0, strikes: 0 },
  },
  {
    id: 'g-2454',
    status: 'scheduled',
    startsAt: '9:40 PM',
    venue: 'Sunbelt Park',
    away: { id: 'cnd', abbr: 'CND', name: 'Canyon Dust', record: '57-52', runs: null },
    home: { id: 'brw', abbr: 'BRW', name: 'Bay Rowers', record: '64-45', runs: null },
    state: null,
  },
  {
    id: 'g-2455',
    status: 'scheduled',
    startsAt: '10:10 PM',
    venue: 'Harborlight',
    away: { id: 'tmb', abbr: 'TMB', name: 'Timber Falls', record: '44-65', runs: null },
    home: { id: 'gld', abbr: 'GLD', name: 'Gilded Coast', record: '51-58', runs: null },
    state: null,
  },
  {
    id: 'g-2456',
    status: 'final',
    startsAt: '4:07 PM',
    venue: 'Millstone',
    away: { id: 'nrt', abbr: 'NRT', name: 'North Range', record: '60-49', runs: 5 },
    home: { id: 'stl', abbr: 'STL', name: 'Stillwater', record: '46-63', runs: 4 },
    state: null,
  },
];

export const defaultGameId = 'g-2451';

export function getGame(id) {
  return games.find((g) => g.id === id) ?? games[0];
}

/* Line score — one entry per inning played. `null` = not yet batted. */
/* Team batting totals for the live page's comparison panel, in the shape
   server/projection.py's _team_stats() emits. */
export const teamStats = {
  away: {
    hits: 5, walks: 3, strikeOuts: 8, stolenBases: 1, risp: { h: 1, ab: 6 },
    atBats: 29, xBA: 0.214, xSLG: 0.341, avgExitVelo: 88.9,
  },
  home: {
    hits: 7, walks: 2, strikeOuts: 6, stolenBases: 0, risp: { h: 3, ab: 7 },
    atBats: 30, xBA: 0.268, xSLG: 0.452, avgExitVelo: 92.4,
  },
};

export const lineScore = {
  gameId: 'g-2451',
  innings: [
    { inning: 1, away: 0, home: 1 },
    { inning: 2, away: 2, home: 0 },
    { inning: 3, away: 0, home: 0 },
    { inning: 4, away: 0, home: 2 },
    { inning: 5, away: 1, home: 0 },
    { inning: 6, away: 0, home: 0 },
    { inning: 7, away: 0, home: null },
    { inning: 8, away: null, home: null },
    { inning: 9, away: null, home: null },
  ],
  totals: {
    away: { r: 3, h: 7, e: 0 },
    home: { r: 4, h: 9, e: 1 },
  },
};

/* Batters currently in the box score — trimmed to what the panel shows. */
export const boxScoreBatters = [
  { id: 'p-11', name: 'D. Ortega', pos: 'CF', ab: 4, r: 1, h: 2, rbi: 1, bb: 0, k: 1, avg: '.301' },
  { id: 'p-12', name: 'A. Whitfield', pos: '2B', ab: 3, r: 1, h: 1, rbi: 0, bb: 1, k: 0, avg: '.274' },
  { id: 'p-13', name: 'R. Nakamura', pos: 'RF', ab: 4, r: 0, h: 2, rbi: 2, bb: 0, k: 1, avg: '.288' },
  { id: 'p-14', name: 'J. Castellanos', pos: '1B', ab: 4, r: 1, h: 1, rbi: 1, bb: 0, k: 2, avg: '.259' },
  { id: 'p-15', name: 'M. Boone', pos: 'LF', ab: 3, r: 0, h: 1, rbi: 0, bb: 1, k: 0, avg: '.243' },
  { id: 'p-16', name: 'T. Halvorsen', pos: 'C', ab: 3, r: 1, h: 1, rbi: 0, bb: 0, k: 1, avg: '.266' },
];

export const boxScorePitchers = [
  { id: 'p-31', name: 'K. Feldman', ip: '5.2', h: 6, r: 3, er: 3, bb: 2, k: 7, era: '3.44' },
  { id: 'p-32', name: 'L. Abara', ip: '1.1', h: 1, r: 0, er: 0, bb: 0, k: 2, era: '2.19' },
];

/* At-bats, newest first. `hasReplay` gates the 3D replay affordance. */
export const atBats = [
  {
    id: 'ab-118',
    inningLabel: 'B7',
    batterId: 'p-13',
    batter: 'R. Nakamura',
    pitcher: 'K. Feldman',
    result: 'Home Run',
    kind: 'hr',
    detail: '2-run shot to right-center',
    exitVelo: 108.4,
    launchAngle: 27,
    distance: 428,
    pitch: { type: 'Slider', velo: 84.1, zone: 'Down, middle' },
    hasReplay: true,
    live: true,
  },
  {
    id: 'ab-117',
    inningLabel: 'B7',
    batterId: 'p-12',
    batter: 'A. Whitfield',
    pitcher: 'K. Feldman',
    result: 'Walk',
    kind: 'bb',
    detail: '6-pitch battle',
    exitVelo: null,
    launchAngle: null,
    distance: null,
    pitch: { type: 'Fastball', velo: 95.8, zone: 'High, away' },
    hasReplay: false,
  },
  {
    id: 'ab-116',
    inningLabel: 'B7',
    batterId: 'p-11',
    batter: 'D. Ortega',
    pitcher: 'K. Feldman',
    result: 'Lineout',
    kind: 'out',
    detail: 'Sharp liner to short',
    exitVelo: 99.2,
    launchAngle: 8,
    distance: 121,
    pitch: { type: 'Sinker', velo: 93.4, zone: 'Middle, in' },
    hasReplay: true,
  },
  {
    id: 'ab-115',
    inningLabel: 'T7',
    batterId: 'p-21',
    batter: 'S. Vance',
    pitcher: 'L. Abara',
    result: 'Strikeout',
    kind: 'k',
    detail: 'Swinging, 3 pitches',
    exitVelo: null,
    launchAngle: null,
    distance: null,
    pitch: { type: 'Curveball', velo: 79.6, zone: 'Low, away' },
    hasReplay: false,
  },
  {
    id: 'ab-114',
    inningLabel: 'T7',
    batterId: 'p-22',
    batter: 'E. Ruiz',
    pitcher: 'L. Abara',
    result: 'Double',
    kind: 'hit',
    detail: 'Gap shot to left-center',
    exitVelo: 103.7,
    launchAngle: 19,
    distance: 331,
    pitch: { type: 'Changeup', velo: 86.2, zone: 'Middle, middle' },
    hasReplay: true,
  },
  {
    id: 'ab-113',
    inningLabel: 'B6',
    batterId: 'p-16',
    batter: 'T. Halvorsen',
    pitcher: 'K. Feldman',
    result: 'Flyout',
    kind: 'out',
    detail: 'Deep to center, warning track',
    exitVelo: 101.1,
    launchAngle: 34,
    distance: 389,
    pitch: { type: 'Fastball', velo: 96.3, zone: 'Up, middle' },
    hasReplay: true,
  },
  {
    id: 'ab-112',
    inningLabel: 'B6',
    batterId: 'p-15',
    batter: 'M. Boone',
    pitcher: 'K. Feldman',
    result: 'Single',
    kind: 'hit',
    detail: 'Ground ball through the hole',
    exitVelo: 94.8,
    launchAngle: -2,
    distance: 96,
    pitch: { type: 'Slider', velo: 85.0, zone: 'Low, in' },
    hasReplay: true,
  },
  {
    id: 'ab-111',
    inningLabel: 'T6',
    batterId: 'p-23',
    batter: 'C. Delacroix',
    pitcher: 'K. Feldman',
    result: 'Groundout',
    kind: 'out',
    detail: '4-3, routine',
    exitVelo: 88.3,
    launchAngle: -8,
    distance: 42,
    pitch: { type: 'Sinker', velo: 94.1, zone: 'Low, middle' },
    hasReplay: false,
  },
];

/* Player detail — keyed by the ids referenced from at-bats / box score. */
export const players = {
  'p-11': {
    id: 'p-11', name: 'Diego Ortega', number: 27, pos: 'Center Field', bats: 'L', throws: 'L',
    team: 'Orchard Nine', height: "5'11\"", weight: '188 lb', age: 26,
    season: { avg: '.301', obp: '.368', slg: '.489', ops: '.857', hr: 19, rbi: 61, sb: 22 },
    batted: { avgExitVelo: 91.2, hardHitPct: 44.1, barrelPct: 9.8, maxDistance: 441 },
  },
  'p-12': {
    id: 'p-12', name: 'Aaron Whitfield', number: 4, pos: 'Second Base', bats: 'R', throws: 'R',
    team: 'Orchard Nine', height: "5'9\"", weight: '176 lb', age: 29,
    season: { avg: '.274', obp: '.351', slg: '.402', ops: '.753', hr: 8, rbi: 44, sb: 11 },
    batted: { avgExitVelo: 88.4, hardHitPct: 36.7, barrelPct: 5.2, maxDistance: 402 },
  },
  'p-13': {
    id: 'p-13', name: 'Ren Nakamura', number: 31, pos: 'Right Field', bats: 'L', throws: 'R',
    team: 'Orchard Nine', height: "6'2\"", weight: '210 lb', age: 24,
    season: { avg: '.288', obp: '.359', slg: '.541', ops: '.900', hr: 31, rbi: 88, sb: 6 },
    batted: { avgExitVelo: 93.6, hardHitPct: 51.3, barrelPct: 14.2, maxDistance: 468 },
  },
  'p-14': {
    id: 'p-14', name: 'Julio Castellanos', number: 45, pos: 'First Base', bats: 'R', throws: 'R',
    team: 'Orchard Nine', height: "6'4\"", weight: '236 lb', age: 31,
    season: { avg: '.259', obp: '.340', slg: '.498', ops: '.838', hr: 27, rbi: 79, sb: 1 },
    batted: { avgExitVelo: 92.8, hardHitPct: 49.0, barrelPct: 12.6, maxDistance: 455 },
  },
  'p-15': {
    id: 'p-15', name: 'Marcus Boone', number: 18, pos: 'Left Field', bats: 'R', throws: 'R',
    team: 'Orchard Nine', height: "6'0\"", weight: '195 lb', age: 27,
    season: { avg: '.243', obp: '.318', slg: '.395', ops: '.713', hr: 12, rbi: 40, sb: 14 },
    batted: { avgExitVelo: 89.1, hardHitPct: 38.2, barrelPct: 6.9, maxDistance: 418 },
  },
  'p-16': {
    id: 'p-16', name: 'Tobias Halvorsen', number: 9, pos: 'Catcher', bats: 'L', throws: 'R',
    team: 'Orchard Nine', height: "6'1\"", weight: '221 lb', age: 30,
    season: { avg: '.266', obp: '.344', slg: '.431', ops: '.775', hr: 15, rbi: 55, sb: 0 },
    batted: { avgExitVelo: 90.5, hardHitPct: 41.6, barrelPct: 8.4, maxDistance: 429 },
  },
  'p-21': {
    id: 'p-21', name: 'Sam Vance', number: 12, pos: 'Shortstop', bats: 'R', throws: 'R',
    team: 'River Kings', height: "6'0\"", weight: '190 lb', age: 25,
    season: { avg: '.251', obp: '.322', slg: '.404', ops: '.726', hr: 14, rbi: 47, sb: 18 },
    batted: { avgExitVelo: 88.9, hardHitPct: 37.4, barrelPct: 6.1, maxDistance: 411 },
  },
  'p-22': {
    id: 'p-22', name: 'Elias Ruiz', number: 6, pos: 'Third Base', bats: 'R', throws: 'R',
    team: 'River Kings', height: "6'3\"", weight: '215 lb', age: 28,
    season: { avg: '.279', obp: '.347', slg: '.470', ops: '.817', hr: 22, rbi: 71, sb: 4 },
    batted: { avgExitVelo: 92.0, hardHitPct: 46.8, barrelPct: 10.7, maxDistance: 447 },
  },
  'p-23': {
    id: 'p-23', name: 'Camille Delacroix', number: 34, pos: 'Designated Hitter', bats: 'L', throws: 'L',
    team: 'River Kings', height: "6'2\"", weight: '205 lb', age: 33,
    season: { avg: '.262', obp: '.361', slg: '.452', ops: '.813', hr: 20, rbi: 66, sb: 2 },
    batted: { avgExitVelo: 91.7, hardHitPct: 43.9, barrelPct: 9.1, maxDistance: 436 },
  },
};

export function getPlayer(id) {
  return players[id] ?? null;
}
