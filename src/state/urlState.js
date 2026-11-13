/* ---------------------------------------------------------------------------
   The address bar: every screen and what it is showing, as a URL anyone can
   share, and back again. Plain functions with no React or window in them, so
   they are tested on their own (urlState.selftest.js).

     /                                  home
     /live?game=822940&date=2026-09-01  a game (date: which day's scoreboard)
     /games?date=2026-09-01             the scoreboard
     /players?pos=SS&range=70           players, filtered: a rating at least 70
     /players?batToBall=max40           ... or at most 40
     /players?preset=junk               a preset, by name
     /players?team=SEA                  a club's roster
     /teams?cat=stuff                   the team leaderboard
     /leaders?group=hitting&cat=wrcPlus one league leaderboard in full
     /ratings                           How Overall works
     /settings
     ...&player=669257                  any of these with a player card open

   Rating values in the URL are always percentiles, whatever scale the page is
   showing, so a link means the same thing to everyone. ?replay, ?speed and
   ?gamePk are the existing replay options; they ride along unchanged. Speed is
   also a rating: on /players it is the rating unless a replay is running, and
   a Speed filter wins over carrying the replay speed.
--------------------------------------------------------------------------- */

import { INITIAL_VIEW, POSITIONS, PRESETS, activePreset, makeFilter, presetPatch } from '../data/playerBoard.js';

export const KEPT = ['replay', 'speed', 'gamePk'];

const PATHS = {
  home: '/',
  live: '/live',
  games: '/games',
  players: '/players',
  ratings: '/ratings',
  settings: '/settings',
  leaderboard: '/leaders',
};
const SCREENS = Object.fromEntries(Object.entries(PATHS).map(([screen, path]) => [path, screen]));

// Everything else in a /players query is a rating.
const RESERVED = new Set([
  ...KEPT, 'date', 'game', 'player', 'pool', 'pos', 'team', 'bats', 'throws', 'sort', 'dir', 'thin', 'pt',
  'preset', 'cat', 'group',
]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TEAM = /^[A-Z]{2,3}$/;
const ID = /^\d{1,9}$/;
const RATING = /^(max)?(\d{1,3})$/;
const SORT = /^[A-Za-z]{2,24}$/;

const naturalDir = (key) => (key === 'name' ? 1 : -1);

/* --- reading -------------------------------------------------------------- */

function readPlayersView(params, teamsView) {
  const team = TEAM.test(params.get('team') ?? '') ? params.get('team') : null;

  if (teamsView) {
    return { ...INITIAL_VIEW, view: 'teams', cat: params.get('cat') || 'overall', team };
  }

  const preset = PRESETS.find((p) => p.id === params.get('preset'));
  const view = preset ? { ...INITIAL_VIEW, ...presetPatch(preset) } : { ...INITIAL_VIEW };

  if (!preset) {
    view.pool = params.get('pool') === 'pitchers' ? 'pitchers' : 'hitters';
    if (POSITIONS.includes(params.get('pos')) && view.pool === 'hitters') view.pos = params.get('pos');
    if (['L', 'R', 'S'].includes(params.get('bats')) && view.pool === 'hitters') view.bats = params.get('bats');
    if (['L', 'R'].includes(params.get('throws'))) view.throws = params.get('throws');
    view.team = team;
    const ratings = [];
    const replaying = params.has('replay');
    params.forEach((value, key) => {
      if (RESERVED.has(key) && !(key === 'speed' && !replaying)) return;
      const m = RATING.exec(value);
      if (m && SORT.test(key)) ratings.push(makeFilter(key, m[1] ? 'max' : 'min', Math.min(100, Number(m[2]))));
    });
    view.ratings = ratings;
    // A club and nothing else is its roster, which lists hitters and pitchers.
    const plain = !ratings.length && view.pos === 'All' && view.bats === 'Any' && view.throws === 'Any';
    if (team && plain && !params.has('pool')) view.pool = null;
  }

  if (['regulars', 'nonregulars'].includes(params.get('pt'))) view.pt = params.get('pt');
  if (params.get('thin') === '1') view.includeThin = true;
  const sortKey = params.get('sort');
  if (sortKey && SORT.test(sortKey)) {
    const dir = params.get('dir');
    view.sort = { key: sortKey, dir: dir === 'asc' ? 1 : dir === 'desc' ? -1 : naturalDir(sortKey) };
  }
  return view;
}

/**
 * The state a URL describes: only the parts it names. `entered` is true for
 * any address but the bare home page, so a shared link skips the splash.
 */
export function readUrl(pathname, search) {
  const params = new URLSearchParams(search);
  const path = (pathname || '/').replace(/\/+$/, '') || '/';
  const teamsView = path === '/teams';
  const screen = teamsView ? 'players' : SCREENS[path] ?? 'home';

  const out = {
    screen,
    entered: path !== '/' || params.has('player'),
    playerCardId: ID.test(params.get('player') ?? '') ? params.get('player') : null,
  };
  if (DATE.test(params.get('date') ?? '')) out.scoreboardDate = params.get('date');
  if (screen === 'players') out.playersView = readPlayersView(params, teamsView);
  if (screen === 'live' && ID.test(params.get('game') ?? '')) out.selectedGameId = params.get('game');
  if (screen === 'leaderboard' && params.get('group') && params.get('cat')) {
    out.leaderboard = { groupId: params.get('group'), categoryId: params.get('cat') };
  }
  return out;
}

/* --- writing -------------------------------------------------------------- */

function writePlayersView(view, params) {
  if (view.view === 'teams') {
    if (view.cat && view.cat !== 'overall') params.set('cat', view.cat);
    if (view.team) params.set('team', view.team);
    return '/teams';
  }

  const preset = activePreset(view);
  let defaultSort = { key: 'ovr', dir: -1 };
  if (preset) {
    params.set('preset', preset.id);
    defaultSort = presetPatch(preset).sort;
  } else if (view.team && !view.pool) {
    params.set('team', view.team);
  } else {
    if (view.pool === 'pitchers') params.set('pool', 'pitchers');
    else if (view.team) params.set('pool', 'hitters'); // a club plus filters is a list, not its roster
    if (view.pos !== 'All') params.set('pos', view.pos);
    if (view.team) params.set('team', view.team);
    if (view.bats !== 'Any') params.set('bats', view.bats);
    if (view.throws !== 'Any') params.set('throws', view.throws);
    view.ratings.forEach((f) => params.set(f.key, f.op === 'max' ? `max${f.pct}` : String(f.pct)));
  }
  if ((view.pt ?? 'all') !== 'all') params.set('pt', view.pt);
  if (view.includeThin) params.set('thin', '1');
  if (view.sort.key !== defaultSort.key || view.sort.dir !== defaultSort.dir) {
    params.set('sort', view.sort.key);
    if (view.sort.dir !== naturalDir(view.sort.key)) params.set('dir', view.sort.dir > 0 ? 'asc' : 'desc');
  }
  return '/players';
}

/**
 * The URL for a state. `kept` is the replay options from the address the app
 * opened on, carried along so a replay session keeps replaying.
 */
export function writeUrl(state, kept = {}) {
  const params = new URLSearchParams();
  let path = PATHS[state.screen] ?? '/';

  if (state.screen === 'players') path = writePlayersView(state.playersView ?? INITIAL_VIEW, params);
  if (state.screen === 'live' && state.selectedGameId && ID.test(String(state.selectedGameId))) {
    params.set('game', String(state.selectedGameId));
  }
  if ((state.screen === 'live' || state.screen === 'games') && state.scoreboardDate) {
    params.set('date', state.scoreboardDate);
  }
  if (state.screen === 'leaderboard' && state.leaderboard) {
    params.set('group', state.leaderboard.groupId);
    params.set('cat', state.leaderboard.categoryId);
  }
  if (state.playerCardId) params.set('player', String(state.playerCardId));
  KEPT.forEach((key) => {
    if (kept[key] != null && !params.has(key)) params.set(key, kept[key]);
  });

  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** The parts of a URL that make it a different page, for the back button. */
export function pageOf(url) {
  const [path, query = ''] = url.split('?');
  const params = new URLSearchParams(query);
  return [path, params.get('player') ?? '', params.get('team') ?? '', params.get('preset') ?? ''].join('|');
}
