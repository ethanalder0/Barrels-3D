/* ---------------------------------------------------------------------------
   The logic of the Players page, with no React in it, so it can be tested.

   The server sends every player's ratings once (/api/players/ratings) and the
   browser does the filtering, which is why a slider answers instantly. Nothing
   is rated here: every player number is the one on his card, and every team
   number was worked out by server/ratings.py.

   A view is everything the page is currently showing. `pool` is null only on a
   club's roster, which lists hitters and pitchers together.
--------------------------------------------------------------------------- */

export const PAGE_SIZE = 50;

export const INITIAL_VIEW = {
  pool: 'hitters', // 'hitters' | 'pitchers' | null (a club's roster)
  pos: 'All',
  team: null,
  bats: 'Any',
  throws: 'Any',
  ratings: [], // [{ key, op: 'min' | 'max', pct, grade }]
  sort: { key: 'ovr', dir: -1 },
  limit: PAGE_SIZE,
  includeThin: false,
  view: 'players', // 'players' | 'teams' (the team leaderboard)
  cat: 'overall', // what the team leaderboard ranks by
};

export const POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

const INFIELD = ['1B', '2B', '3B', 'SS'];
const OUTFIELD = ['LF', 'CF', 'RF', 'OF'];

const PLURAL = {
  All: 'hitters',
  C: 'catchers',
  '1B': 'first basemen',
  '2B': 'second basemen',
  '3B': 'third basemen',
  SS: 'shortstops',
  LF: 'left fielders',
  CF: 'center fielders',
  RF: 'right fielders',
  DH: 'designated hitters',
};

export const DIVISIONS = [
  { name: 'AL East', teams: ['BAL', 'BOS', 'NYY', 'TB', 'TOR'] },
  { name: 'AL Central', teams: ['CWS', 'CLE', 'DET', 'KC', 'MIN'] },
  { name: 'AL West', teams: ['ATH', 'HOU', 'LAA', 'SEA', 'TEX'] },
  { name: 'NL East', teams: ['ATL', 'MIA', 'NYM', 'PHI', 'WSH'] },
  { name: 'NL Central', teams: ['CHC', 'CIN', 'MIL', 'PIT', 'STL'] },
  { name: 'NL West', teams: ['AZ', 'COL', 'LAD', 'SD', 'SF'] },
];

export function divisionOf(abbr) {
  return DIVISIONS.find((d) => d.teams.includes(abbr))?.name ?? '';
}

/* Each preset is nothing but saved filters, printed where you click it. The
   values are percentiles; `pos` opens it on one position, for a rating only
   that position has. The page lists the hitters' or the pitchers' presets,
   whichever pool is showing. Several need "at most": a Glove-first player who
   can also hit is just a good player. */
export const PRESETS = [
  // Hitters
  { id: 'speed', name: 'Elite speed', pool: 'hitters', filters: [['speed', 'min', 90]] },
  {
    id: 'fiveTool',
    name: 'Five-tool',
    pool: 'hitters',
    filters: [['gamePower', 'min', 55], ['batToBall', 'min', 55], ['speed', 'min', 55], ['range', 'min', 55], ['arm', 'min', 55]],
  },
  {
    id: 'tto',
    name: 'Three True Outcomes',
    pool: 'hitters',
    filters: [['gamePower', 'min', 70], ['swingDecisions', 'min', 60], ['batToBall', 'max', 40]],
  },
  { id: 'glove', name: 'Glove-first', pool: 'hitters', filters: [['range', 'min', 75], ['gamePower', 'max', 40]] },
  { id: 'contact', name: 'Contact artists', pool: 'hitters', filters: [['batToBall', 'min', 85], ['rawPower', 'max', 50]] },
  {
    id: 'slap',
    name: 'Slap hitters',
    pool: 'hitters',
    filters: [['rawPower', 'max', 25], ['batToBall', 'min', 75], ['speed', 'min', 75]],
  },
  {
    id: 'tableSetters',
    name: 'Table setters',
    pool: 'hitters',
    filters: [['swingDecisions', 'min', 75], ['batToBall', 'min', 70], ['speed', 'min', 60]],
  },
  { id: 'untapped', name: 'Untapped power', pool: 'hitters', filters: [['rawPower', 'min', 80], ['gamePower', 'max', 50]] },
  { id: 'patient', name: 'Patient eyes', pool: 'hitters', filters: [['swingDecisions', 'min', 90]] },
  { id: 'allOrNothing', name: 'All or nothing', pool: 'hitters', filters: [['gamePower', 'min', 80], ['batToBall', 'max', 25]] },
  { id: 'range', name: 'Range for days', pool: 'hitters', filters: [['range', 'min', 90]] },
  { id: 'arms', name: 'Cannon arms', pool: 'hitters', filters: [['arm', 'min', 90]] },
  { id: 'framers', name: 'Elite framers', pool: 'hitters', pos: 'C', filters: [['framing', 'min', 85]] },
  // Pitchers
  { id: 'stuff', name: 'Best Stuff', pool: 'pitchers', filters: [['stuff', 'min', 90]] },
  { id: 'flame', name: 'Flamethrowers', pool: 'pitchers', filters: [['velocity', 'min', 90]] },
  { id: 'strikeouts', name: 'Strikeout artists', pool: 'pitchers', filters: [['batMissing', 'min', 90]] },
  { id: 'strikes', name: 'Strike throwers', pool: 'pitchers', filters: [['command', 'min', 85]] },
  // Soft velocity, nasty shape: movement and arm angle beating hitters without the radar gun.
  { id: 'junk', name: 'Junkballers', pool: 'pitchers', filters: [['velocity', 'max', 50], ['stuff', 'min', 75]] },
  // The classic soft-tosser: no velocity, gets by on location and weak contact.
  {
    id: 'crafty',
    name: 'Crafty',
    pool: 'pitchers',
    filters: [['velocity', 'max', 40], ['command', 'min', 70], ['contactManagement', 'min', 70]],
  },
  { id: 'chase', name: 'Chase merchants', pool: 'pitchers', filters: [['chase', 'min', 85]] },
  { id: 'depth', name: 'Deep arsenals', pool: 'pitchers', filters: [['depth', 'min', 85]] },
  { id: 'wild', name: 'Effectively wild', pool: 'pitchers', filters: [['stuff', 'min', 80], ['command', 'max', 30]] },
  {
    id: 'contactPitchers',
    name: 'Pitch to contact',
    pool: 'pitchers',
    filters: [['contactManagement', 'min', 75], ['batMissing', 'max', 40]],
  },
];

/** The presets for one pool, in the order the page lists them. */
export const presetsFor = (pool) => PRESETS.filter((p) => p.pool === (pool ?? 'hitters'));

/* --- the two scales -------------------------------------------------------
   grade = 50 + 10 * inverse-normal(pct), rounded to 5. These are its cut points.
   They only translate a threshold when the scale toggle flips: a player's own
   grade always comes from the server. A grade is coarser than a percentile, so
   the same filter can find slightly different players on each scale. */
const CUTS = [
  [99.7, 80], [98.78, 75], [95.99, 70], [89.44, 65], [77.34, 60], [59.87, 55],
  [40.13, 50], [22.66, 45], [10.56, 40], [4.01, 35], [1.22, 30], [0.3, 25],
];

export function gradeOf(pct) {
  const cut = CUTS.find(([at]) => pct >= at);
  return cut ? cut[1] : 20;
}

/** The lowest percentile, in fives, that earns this grade. */
export function pctOf(grade) {
  const cut = CUTS.find(([, g]) => g === grade);
  return cut ? Math.min(100, Math.ceil(cut[0] / 5) * 5) : 0;
}

export const scaleRange = (scale) => (scale === 'grade' ? [20, 80] : [0, 100]);
const pick = (pair, scale) => (pair ? pair[scale === 'grade' ? 1 : 0] : null);

/* --- the payload ---------------------------------------------------------- */

function preparePlayer(row, attributes) {
  const list = attributes[row.kind] ?? [];
  const scores = {};
  const rated = row.r.length > 0;
  const attrs = [];
  list.forEach((attr, i) => {
    const entry = rated ? row.r[i] : attr.roles ? 0 : null;
    if (entry === 0) return; // not rated at his position
    if (rated) scores[attr.key] = entry;
    attrs.push({
      key: attr.key,
      label: attr.label,
      group: attr.group,
      question: attr.question,
      pct: entry ? entry[0] : null,
      grade: entry ? entry[1] : null,
      hidden: entry ? null : 'Not enough data yet',
    });
  });
  return { ...row, isPitcher: row.kind === 'pitcher', scores, attrs };
}

export function prepareBoard(payload) {
  const attributes = payload.attributes ?? { hitter: [], pitcher: [] };
  const meta = {};
  [...attributes.hitter, ...attributes.pitcher].forEach((a) => {
    meta[a.key] = a;
  });
  return {
    season: payload.season,
    attributes,
    meta,
    players: (payload.players ?? []).map((row) => preparePlayer(row, attributes)),
    teams: payload.teams ?? {},
    orders: new Map(),
  };
}

export const scoreOf = (player, key, scale) => pick(player.scores[key], scale);
export const overallOf = (player, scale) => pick(player.ovr, scale);

/* --- which ratings apply -------------------------------------------------- */

const roleOf = (pos) => {
  if (pos === 'C') return 'C';
  if (INFIELD.includes(pos)) return 'IF';
  if (OUTFIELD.includes(pos)) return 'OF';
  return null;
};

/** The rating columns, and sliders, for a pool and position. */
export function columnsFor(board, pool, pos) {
  if (pool === 'pitchers') return board.attributes.pitcher.map((a) => a.key);
  const everyone = pos === 'All';
  const role = roleOf(pos);
  return board.attributes.hitter
    .filter((a) => !a.roles || (everyone ? a.roles.includes('IF') || a.roles.includes('OF') : a.roles.includes(role)))
    .map((a) => a.key);
}

/* --- filtering ------------------------------------------------------------ */

export const makeFilter = (key, op, pct) => ({ key, op, pct, grade: gradeOf(pct) });

export function thresholdOf(filter, scale) {
  return scale === 'grade' ? filter.grade : filter.pct;
}

export function passes(player, filter, scale) {
  const value = scoreOf(player, filter.key, scale);
  if (value == null) return false;
  const want = thresholdOf(filter, scale);
  return filter.op === 'max' ? value <= want : value >= want;
}

function inBase(player, view, pool, pos) {
  if (pool === 'pitchers' ? !player.isPitcher : player.isPitcher) return false;
  if (pos !== 'All' && player.pos !== pos) return false;
  if (view.team && player.team !== view.team) return false;
  if (pool !== 'pitchers' && view.bats !== 'Any' && player.bats !== view.bats) return false;
  if (view.throws !== 'Any' && player.throws !== view.throws) return false;
  return true;
}

/**
 * Who matches. `thin` is everyone a filter could not judge: he fails only on
 * ratings hidden for too little data. They are offered, not silently dropped.
 */
export function search(board, view, scale) {
  const pool = view.pool ?? 'hitters';
  const base = board.players.filter((p) => inBase(p, view, pool, view.pos));
  const matches = [];
  const thin = [];
  base.forEach((p) => {
    if (view.ratings.every((f) => passes(p, f, scale))) matches.push(p);
    else if (view.ratings.every((f) => passes(p, f, scale) || p.scores[f.key] === null)) thin.push(p);
  });
  return { baseCount: base.length, matches, thin };
}

export function sortPlayers(rows, sort) {
  const value = (p) => (sort.key === 'ovr' ? pick(p.ovr, 'pct') : pick(p.scores[sort.key], 'pct'));
  return rows.slice().sort((x, y) => {
    if (sort.key === 'name') return sort.dir * x.name.localeCompare(y.name);
    const a = value(x);
    const b = value(y);
    if (a == null && b == null) return x.name.localeCompare(y.name);
    if (a == null) return 1;
    if (b == null) return -1;
    return sort.dir * (a - b) || x.name.localeCompare(y.name);
  });
}

/** Everything that stops a page showing everyone. */
export function isFiltered(view) {
  return view.ratings.length > 0 || view.pos !== 'All' || !!view.team
    || view.bats !== 'Any' || view.throws !== 'Any' || view.pool === 'pitchers';
}

/** A club picked and nothing else: the page is its roster. */
export const isRoster = (view) => view.view !== 'teams' && !!view.team && !view.pool;

/* --- changing the view: each returns a patch ------------------------------ */

export function ratingPatch(view, key, raw, scale) {
  const [lo, hi] = scaleRange(scale);
  const value = Number(raw);
  const existing = view.ratings.find((f) => f.key === key);
  const op = existing?.op ?? 'min';
  const cleared = op === 'min' ? value <= lo : value >= hi;
  const others = view.ratings.filter((f) => f.key !== key);
  let ratings = others;
  if (!cleared) {
    const next = scale === 'grade'
      ? { key, op, pct: pctOf(value), grade: value }
      : { key, op, pct: value, grade: gradeOf(value) };
    // Stays where it is in the sentence: dragging must not reorder the headline.
    ratings = existing ? view.ratings.map((f) => (f.key === key ? next : f)) : [...others, next];
  }
  return { ratings, limit: PAGE_SIZE, pool: view.pool ?? 'hitters' };
}

export function flipPatch(view, key) {
  return {
    ratings: view.ratings.map((f) => (f.key === key ? { ...f, op: f.op === 'max' ? 'min' : 'max' } : f)),
  };
}

export function positionPatch(board, view, pos) {
  const keys = columnsFor(board, 'hitters', pos);
  return {
    pool: 'hitters',
    pos,
    limit: PAGE_SIZE,
    ratings: view.ratings.filter((f) => keys.includes(f.key)),
  };
}

export function poolPatch(board, view, pool) {
  const keys = columnsFor(board, pool, 'All');
  return {
    pool,
    pos: 'All',
    bats: 'Any',
    limit: PAGE_SIZE,
    sort: { key: 'ovr', dir: -1 },
    ratings: view.ratings.filter((f) => keys.includes(f.key)),
  };
}

export function presetPatch(preset) {
  return {
    ...INITIAL_VIEW,
    pool: preset.pool,
    pos: preset.pos ?? 'All',
    ratings: preset.filters.map(([key, op, pct]) => makeFilter(key, op, pct)),
    // Best first on what it looks for: its first "at least", not a cap like
    // Junkballers' velocity, which would list the softest throwers first.
    sort: { key: (preset.filters.find(([, op]) => op === 'min') ?? preset.filters[0])[0], dir: -1 },
  };
}

export const openClubPatch = (abbr) => ({
  ...INITIAL_VIEW,
  pool: null,
  team: abbr,
});

/** Clicking a team mark: a roster if nothing else is set, otherwise one more filter. */
export function teamPatch(view, abbr) {
  if (view.view === 'teams') return openClubPatch(abbr);
  if (view.team === abbr) return { team: null, pool: view.pool ?? 'hitters' };
  const plain = !view.ratings.length && view.pos === 'All' && view.bats === 'Any' && view.throws === 'Any';
  return plain ? openClubPatch(abbr) : { team: abbr, limit: PAGE_SIZE };
}

/* A hand filter on a roster means leaving the roster for a filtered list. */
export const handPatch = (view, field, value) => ({
  [field]: value,
  limit: PAGE_SIZE,
  pool: view.pool ?? 'hitters',
});

export function activePreset(view) {
  return PRESETS.find((p) =>
    view.pool === p.pool && view.pos === (p.pos ?? 'All') && !view.team && view.bats === 'Any' && view.throws === 'Any'
    && view.ratings.length === p.filters.length
    && p.filters.every(([key, op, pct]) => view.ratings.some((f) => f.key === key && f.op === op && f.pct === pct)));
}

export function presetSummary(board, preset, scale) {
  const filters = preset.filters.map(([key, op, pct]) => makeFilter(key, op, pct));
  const prefix = preset.pool === 'pitchers' ? 'Pitchers · ' : (preset.pos ? `${preset.pos} · ` : '');
  return {
    count: board.players.filter((p) =>
      (preset.pool === 'pitchers' ? p.isPitcher : !p.isPitcher)
      && (!preset.pos || p.pos === preset.pos)
      && filters.every((f) => passes(p, f, scale))).length,
    definition: prefix + filters.map((f) => shortClause(board, f, scale)).join(' · '),
  };
}

/* --- words ---------------------------------------------------------------- */

export function shortClause(board, filter, scale) {
  const value = thresholdOf(filter, scale);
  const label = board.meta[filter.key]?.label ?? filter.key;
  return filter.op === 'max' ? `${label} ≤${value}` : `${label} ${value}+`;
}

export function longClause(board, filter, scale) {
  const value = thresholdOf(filter, scale);
  const label = board.meta[filter.key]?.label ?? filter.key;
  return filter.op === 'max' ? `${label} ${value} or below` : `${value}+ ${label}`;
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "left-handed Mariners shortstops": who the list is of, before any rating. */
export function subjectOf(view, teamName) {
  const pool = view.pool ?? 'hitters';
  const words = [];
  if (pool === 'pitchers') {
    if (view.throws === 'L') words.push('left-handed');
    if (view.throws === 'R') words.push('right-handed');
  } else {
    if (view.bats === 'L') words.push('left-handed');
    if (view.bats === 'R') words.push('right-handed');
    if (view.bats === 'S') words.push('switch-hitting');
  }
  if (view.team) words.push(teamName);
  words.push(pool === 'pitchers' ? 'pitchers' : PLURAL[view.pos] ?? 'hitters');
  return words.join(' ');
}

/**
 * The headline, written from the filters, so the page always says what it is
 * showing. Each part is plain text, or carries the filter it would remove.
 */
export function sentenceOf(board, view, scale, teamName) {
  const pool = view.pool ?? 'hitters';
  const subject = subjectOf(view, teamName);
  const lonely = subject === 'hitters' || subject === 'pitchers';
  const parts = [{ text: capitalize(lonely && !view.ratings.length ? `all ${subject}` : subject) }];
  if (pool !== 'pitchers' && view.throws !== 'Any') {
    parts.push({ text: ` who throw ${view.throws === 'L' ? 'left' : 'right'}` });
  }
  view.ratings.forEach((filter, i) => {
    const last = i === view.ratings.length - 1;
    parts.push({ text: i === 0 ? ' with ' : last ? ' and ' : ', ' });
    parts.push({ text: longClause(board, filter, scale), filter });
  });
  return parts;
}

/** Nobody fits: what each single change would bring back. */
export function loosenings(board, view, scale) {
  const pool = view.pool ?? 'hitters';
  const count = (ratings, pos = view.pos) =>
    board.players.filter((p) => inBase(p, view, pool, pos) && ratings.every((f) => passes(p, f, scale))).length;
  const out = view.ratings.map((f) => {
    const others = view.ratings.filter((x) => x !== f);
    return { label: `Drop ${longClause(board, f, scale)}`, count: count(others), patch: { ratings: others } };
  });
  if (view.pos !== 'All') {
    out.push({ label: 'Look at every position', count: count(view.ratings, 'All'), patch: { pos: 'All' } });
  }
  if (view.team) {
    const n = board.players.filter((p) =>
      inBase(p, { ...view, team: null }, pool, view.pos) && view.ratings.every((f) => passes(p, f, scale))).length;
    out.push({ label: 'Look at every club', count: n, patch: { team: null } });
  }
  return out;
}

/** What a phone row shows: the numbers you asked about, or his best one. */
export function keyline(board, player, view, scale) {
  const asked = view.ratings.filter((f) => f.key in player.scores);
  const label = (key) => board.meta[key]?.label ?? key;
  const show = (key) => scoreOf(player, key, scale) ?? '—';
  if (asked.length) return asked.map((f) => `${label(f.key)} ${show(f.key)}`).join(' · ');
  const best = player.attrs.filter((a) => a.pct != null).sort((a, b) => b.pct - a.pct)[0];
  return best ? `Best: ${best.label} ${show(best.key)}` : 'Not rated yet';
}

/* --- rosters -------------------------------------------------------------- */

const UNITS = [
  { title: 'Catchers', pool: 'hitters', pos: 'C', has: (p) => p.pos === 'C' },
  { title: 'Infielders', pool: 'hitters', pos: 'SS', has: (p) => INFIELD.includes(p.pos) },
  { title: 'Outfielders', pool: 'hitters', pos: 'CF', has: (p) => OUTFIELD.includes(p.pos) },
  { title: 'Designated hitters', pool: 'hitters', pos: 'DH', has: (p) => !roleOf(p.pos) },
];

/** One club, in the sections a roster reads in, each with its own columns. */
export function rosterSections(board, team, sort) {
  const club = board.players.filter((p) => p.team === team);
  const sections = UNITS.map((unit) => ({
    title: unit.title,
    keys: columnsFor(board, unit.pool, unit.pos),
    rows: sortPlayers(club.filter((p) => !p.isPitcher && unit.has(p)), sort),
  }));
  sections.push({
    title: 'Pitchers',
    keys: columnsFor(board, 'pitchers', 'All'),
    rows: sortPlayers(club.filter((p) => p.isPitcher), sort),
  });
  return sections.filter((s) => s.rows.length > 0);
}

/* --- team numbers --------------------------------------------------------- */

export const TEAM_CATS = ['overall', 'hitting', 'pitching'];
const CATCHER_KEYS = ['framing', 'blocking', 'throwing'];

export function catLabel(board, cat) {
  if (cat === 'overall') return 'Team Overall';
  if (cat === 'hitting') return 'Hitting';
  if (cat === 'pitching') return 'Pitching';
  return board.meta[cat]?.label ?? cat;
}

export function catDefinition(board, cat) {
  if (cat === 'overall') return 'The average of a club’s Hitting and its Pitching.';
  if (cat === 'hitting') return 'The average Overall of a club’s rated hitters, weighted by plate appearances.';
  if (cat === 'pitching') return 'The average Overall of a club’s rated pitchers, weighted by batters faced.';
  const attr = board.meta[cat];
  if (!attr) return '';
  if (CATCHER_KEYS.includes(cat)) {
    return `The average ${attr.label} of a club’s rated catchers, weighted by plate appearances. Many clubs have only one or two, so read this as a board of catchers more than clubs.`;
  }
  if (attr.group === 'pitching') return `The average ${attr.label} of a club’s rated pitchers, weighted by batters faced.`;
  const who = attr.group === 'fielding' ? 'fielders' : 'hitters';
  return `The average ${attr.label} of a club’s rated ${who}, weighted by plate appearances.`;
}

export function teamValue(board, team, cat, scale) {
  const stats = board.teams[team];
  if (!stats) return null;
  return pick(TEAM_CATS.includes(cat) ? stats[cat] : stats.ratings?.[cat], scale);
}

/** The clubs best first. Any with no number on this measure are left out. */
export function clubOrder(board, cat, scale) {
  const id = `${cat}|${scale}`;
  if (!board.orders.has(id)) {
    board.orders.set(id, Object.keys(board.teams)
      .filter((t) => teamValue(board, t, cat, scale) != null)
      .sort((x, y) => teamValue(board, y, cat, scale) - teamValue(board, x, cat, scale) || x.localeCompare(y)));
  }
  return board.orders.get(id);
}

export function rankOf(board, team, cat, scale) {
  const at = clubOrder(board, cat, scale).indexOf(team);
  return at < 0 ? null : at + 1;
}

export function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`;
}

/** A club's best and worst ranks. Catchers are left out: one player is not a club. */
export function strengths(board, team, scale) {
  const ranked = Object.keys(board.meta)
    .filter((k) => !CATCHER_KEYS.includes(k))
    .map((key) => ({ key, rank: rankOf(board, team, key, scale) }))
    .filter((x) => x.rank != null)
    .sort((a, b) => a.rank - b.rank);
  return ranked.length ? { best: ranked[0], worst: ranked[ranked.length - 1] } : null;
}

export const fixed1 = (v) => (v == null ? '—' : v.toFixed(1));
