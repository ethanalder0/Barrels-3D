/* ---------------------------------------------------------------------------
   node src/data/playerBoard.selftest.js

   The Players page's logic, on a small hand-made league: filters on both
   scales, hidden ratings, presets, the sentence, rosters and team ranks.
--------------------------------------------------------------------------- */

import {
  INITIAL_VIEW,
  PRESETS,
  activePreset,
  clubOrder,
  columnsFor,
  flipPatch,
  gradeOf,
  isRoster,
  keyline,
  loosenings,
  makeFilter,
  openClubPatch,
  ordinal,
  pctOf,
  poolPatch,
  positionPatch,
  isRegular,
  prepareBoard,
  regularBar,
  presetPatch,
  presetsFor,
  presetSummary,
  rankOf,
  ratingPatch,
  rosterSections,
  search,
  sentenceOf,
  sortPlayers,
  strengths,
  teamPatch,
  teamValue,
} from './playerBoard.js';

let failures = 0;

function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const names = (rows) => rows.map((p) => p.name);

const attr = (key, label, group, roles = null) => ({ key, label, group, question: `${label}?`, roles });
const attributes = {
  hitter: [
    attr('gamePower', 'Game Power', 'hitting'),
    attr('batToBall', 'Bat-to-Ball', 'hitting'),
    attr('speed', 'Speed', 'running'),
    attr('range', 'Range', 'fielding', ['IF', 'OF']),
    attr('jump', 'Jump', 'fielding', ['OF']),
    attr('framing', 'Framing', 'fielding', ['C']),
  ],
  pitcher: [attr('stuff', 'Stuff', 'pitching'), attr('command', 'Command', 'pitching')],
};
const pair = (pct) => [pct, gradeOf(pct)];
const hitter = (name, team, pos, bats, throws, ovr, r) => ({
  id: name, name, team, pos, bats, throws, kind: 'hitter', ovr: ovr == null ? null : pair(ovr),
  r: r.map((v) => (v === 0 || v === null ? v : pair(v))),
});
const pitcher = (name, team, throws, ovr, r) => ({
  id: name, name, team, pos: 'P', bats: 'R', throws, kind: 'pitcher', ovr: pair(ovr), r: r.map(pair),
});

const board = prepareBoard({
  season: 2026,
  attributes,
  players: [
    hitter('Witt', 'KC', 'SS', 'R', 'R', 99, [88, 67, 99, 96, 0, 0]),
    hitter('Swanson', 'CHC', 'SS', 'R', 'R', 70, [66, 18, 73, 80, 0, 0]),
    hitter('Winn', 'STL', 'SS', 'R', 'R', 42, [11, 72, 79, 93, 0, 0]),
    hitter('Thin', 'SEA', 'SS', 'R', 'R', null, [null, 59, 58, null, 0, 0]),
    hitter('Half', 'SEA', 'SS', 'L', 'R', 40, [75, 50, 50, null, 0, 0]),
    hitter('Raleigh', 'SEA', 'C', 'S', 'R', 76, [98, 9, 16, 0, 0, 60]),
    hitter('PCA', 'CHC', 'CF', 'L', 'L', 98, [94, 33, 96, 98, 99, 0]),
    { id: 'Blank', name: 'Blank', team: 'SEA', pos: 'CF', bats: 'R', throws: 'R', kind: 'hitter', ovr: null, r: [] },
    hitter('Gone', null, 'C', 'R', 'R', 20, [50, 13, 11, 0, 0, null]),
    hitter('Ohtani', 'LAD', 'TWP', 'L', 'R', 99, [99, 50, 80, 0, 0, 0]),
    pitcher('Skenes', 'PIT', 'R', 99, [79, 94]),
    pitcher('Munoz', 'SEA', 'R', 90, [92, 19]),
  ],
  teams: {
    SEA: {
      overall: [63.4, 54.0], hitting: [61.5, 52.5], pitching: [65.3, 55.4], hitters: 3, pitchers: 1,
      ratings: { speed: [46.2, 48.7, 4], stuff: [92, 65, 1], framing: [60, 55, 1] },
    },
    CHC: {
      overall: [57.4, 51.6], hitting: [69.4, 55.5], pitching: [45.3, 47.8], hitters: 2, pitchers: 0,
      ratings: { speed: [84, 60, 2], stuff: [40, 47, 1], framing: [90, 65, 1] },
    },
    LAD: { overall: null, hitting: [99, 75], pitching: null, hitters: 1, pitchers: 0, ratings: { speed: [80, 60, 1] } },
  },
});
const scaleless = { ...INITIAL_VIEW };

console.log('scales');
check('grades follow the published formula', same([gradeOf(50), gradeOf(70), gradeOf(90), gradeOf(99.8), gradeOf(0)], [50, 55, 65, 80, 20]));
check('a grade translates to the lowest percentile that earns it', pctOf(55) === 60 && pctOf(65) === 90);
check('20 is the bottom of the grade scale', pctOf(20) === 0);

console.log('payload');
const witt = board.players[0];
check('a score is keyed by attribute', witt.scores.gamePower[0] === 88);
check('not rated at his position leaves no key', !('framing' in witt.scores));
const thinP = board.players.find((p) => p.name === 'Thin');
check('hidden is a key holding null', thinP.scores.gamePower === null);
check('hidden stays on the wheel, not rated does not', thinP.attrs.some((a) => a.key === 'range' && a.hidden) && !thinP.attrs.some((a) => a.key === 'jump'));
const blank = board.players.find((p) => p.name === 'Blank');
check('someone with no data still gets a wheel to draw', blank.attrs.length === 3 && blank.attrs.every((a) => a.hidden));
check('and nothing a filter could mistake for a hidden rating', Object.keys(blank.scores).length === 0);

console.log('columns');
check('all hitters: no catcher columns', same(columnsFor(board, 'hitters', 'All'), ['gamePower', 'batToBall', 'speed', 'range', 'jump']));
check('a shortstop has no Jump', same(columnsFor(board, 'hitters', 'SS'), ['gamePower', 'batToBall', 'speed', 'range']));
check('a catcher has Framing and no Range', same(columnsFor(board, 'hitters', 'C'), ['gamePower', 'batToBall', 'speed', 'framing']));
check('a DH has no glove at all', same(columnsFor(board, 'hitters', 'DH'), ['gamePower', 'batToBall', 'speed']));
check('pitchers have their own list', same(columnsFor(board, 'pitchers', 'All'), ['stuff', 'command']));

console.log('search');
const query = { ...scaleless, pos: 'SS', ratings: [makeFilter('range', 'min', 70), makeFilter('gamePower', 'min', 60)] };
const found = search(board, query, 'pct');
check('the brief\'s own example', same(names(found.matches), ['Witt', 'Swanson']), names(found.matches).join());
check('out of everyone at the position', found.baseCount === 5);
check('hidden on every failing filter: offered', names(found.thin).includes('Thin'));
check('hidden on one, passing the other: offered', names(found.thin).includes('Half'));
check('a real failure is not offered', !names(found.thin).includes('Winn'));
const atMost = search(board, { ...scaleless, ratings: [makeFilter('batToBall', 'max', 20)] }, 'pct');
check('"at most" keeps the low end', same(names(atMost.matches), ['Swanson', 'Raleigh', 'Gone']), names(atMost.matches).join());
const hiddenNeverPasses = search(board, { ...scaleless, ratings: [makeFilter('gamePower', 'max', 100)] }, 'pct');
check('a hidden rating does not pass "at most" either', !names(hiddenNeverPasses.matches).includes('Thin'));
check('not rated at his position is not "too little data"',
  !names(search(board, { ...scaleless, ratings: [makeFilter('range', 'min', 90)] }, 'pct').thin).includes('Raleigh'));
check('no data at all is not offered as thin',
  !names(search(board, { ...scaleless, ratings: [makeFilter('speed', 'min', 1)] }, 'pct').thin).includes('Blank'));
check('pitchers are their own pool', same(names(search(board, poolView(), 'pct').matches), ['Skenes', 'Munoz']));
function poolView() {
  return { ...scaleless, pool: 'pitchers' };
}
check('a team narrows it', same(names(search(board, { ...scaleless, team: 'CHC' }, 'pct').matches), ['Swanson', 'PCA']));
check('bats narrows hitters', names(search(board, { ...scaleless, bats: 'S' }, 'pct').matches).join() === 'Raleigh');
check('throws narrows too', names(search(board, { ...scaleless, throws: 'L' }, 'pct').matches).join() === 'PCA');
check('the bats filter does not touch pitchers',
  names(search(board, { ...scaleless, pool: 'pitchers', bats: 'L' }, 'pct').matches).length === 2);
check('the grade scale reads the server\'s grades',
  same(names(search(board, { ...query }, 'grade').matches), ['Witt', 'Swanson']));

console.log('sort');
check('overall, best first, no rating last',
  same(names(sortPlayers(board.players.filter((p) => p.team === 'SEA' && !p.isPitcher), { key: 'ovr', dir: -1 })), ['Raleigh', 'Half', 'Blank', 'Thin']));
check('nulls stay last when reversed',
  names(sortPlayers(board.players.filter((p) => p.team === 'SEA' && !p.isPitcher), { key: 'ovr', dir: 1 })).slice(-2).join() === 'Blank,Thin');
check('by a rating', names(sortPlayers(found.matches, { key: 'gamePower', dir: 1 }))[0] === 'Swanson');
check('by name', names(sortPlayers(found.matches, { key: 'name', dir: 1 }))[0] === 'Swanson');

console.log('changing the view');
const dragged = ratingPatch(scaleless, 'speed', 70, 'pct');
check('a slider adds a filter', dragged.ratings[0].pct === 70 && dragged.ratings[0].grade === 55 && dragged.ratings[0].op === 'min');
check('dragging to the bottom clears it', ratingPatch({ ...scaleless, ...dragged }, 'speed', 0, 'pct').ratings.length === 0);
const graded = ratingPatch(scaleless, 'speed', 65, 'grade');
check('set on the grade scale, it knows its percentile', graded.ratings[0].grade === 65 && graded.ratings[0].pct === 90);
const two = { ...scaleless, ratings: [makeFilter('speed', 'min', 70), makeFilter('range', 'min', 60)] };
check('dragging keeps its place in the sentence', ratingPatch(two, 'speed', 80, 'pct').ratings[0].key === 'speed');
const flipped = flipPatch(two, 'range').ratings[1];
check('"at most" flips in place', flipped.op === 'max' && flipped.pct === 60);
const maxView = { ...scaleless, ratings: [flipped] };
check('an "at most" clears at the top', ratingPatch(maxView, 'range', 100, 'pct').ratings.length === 0);
check('a rating that does not apply goes with a position change', same(positionPatch(board, two, 'DH').ratings.map((f) => f.key), ['speed']));
check('moving to pitchers drops hitter ratings', poolPatch(board, two, 'pitchers').ratings.length === 0);

console.log('presets');
PRESETS.forEach((preset) => {
  const view = { ...INITIAL_VIEW, ...presetPatch(preset) };
  check(`${preset.name} recognises itself`, activePreset(view)?.id === preset.id);
});
const byId = (id) => PRESETS.find((p) => p.id === id);
const tto = { ...INITIAL_VIEW, ...presetPatch(byId('tto')) };
check('touching a filter ends the preset', !activePreset({ ...tto, ...ratingPatch(tto, 'gamePower', 75, 'pct') }));
check('adding a position ends the preset', !activePreset({ ...tto, pos: 'SS' }));
const summary = presetSummary(board, byId('tto'), 'pct');
check('a preset prints what it means', summary.definition === 'Game Power 70+ · Swing Decisions 60+ · Bat-to-Ball ≤40'
  .replace('Swing Decisions', 'swingDecisions'), summary.definition);
check('Best Stuff says it is pitchers', presetSummary(board, byId('stuff'), 'pct').definition.startsWith('Pitchers · Stuff 90+'));
check('on the toggle, in grades', presetSummary(board, byId('stuff'), 'grade').definition.endsWith('Stuff 65+'));
check('and counts who fits', presetSummary(board, byId('stuff'), 'pct').count === 1);
check('each pool lists its own presets', presetsFor('pitchers').every((p) => p.pool === 'pitchers')
  && presetsFor('hitters').every((p) => p.pool === 'hitters') && presetsFor(null).length === presetsFor('hitters').length);
check('every preset has a unique id', new Set(PRESETS.map((p) => p.id)).size === PRESETS.length);
const framers = { ...INITIAL_VIEW, ...presetPatch(byId('framers')) };
check('a catcher preset opens on catchers', framers.pos === 'C' && activePreset(framers)?.id === 'framers');
check('and says so', presetSummary(board, byId('framers'), 'pct').definition === 'C · Framing 85+');
check('it counts only catchers', presetSummary(board, byId('framers'), 'pct').count === 0, 'Gone has hidden framing; Raleigh is 60');
check('a preset sorts on what it looks for, not on its cap', presetPatch(byId('junk')).sort.key === 'stuff' && presetPatch(byId('junk')).sort.dir === -1);
check('junkballers need "at most" on velocity', byId('junk').filters.some(([k, op]) => k === 'velocity' && op === 'max'));

console.log('sentence');
const said = (view, scale = 'pct', team = '') => sentenceOf(board, view, scale, team).map((p) => p.text).join('');
check('nothing set', said(scaleless) === 'All hitters');
check('the brief\'s own example', said(query) === 'Shortstops with 70+ Range and 60+ Game Power', said(query));
check('on the grade scale', said(query, 'grade') === 'Shortstops with 55+ Range and 55+ Game Power', said(query, 'grade'));
check('three filters', said({ ...scaleless, ratings: [makeFilter('speed', 'min', 70), makeFilter('range', 'min', 60), makeFilter('batToBall', 'max', 40)] })
  === 'Hitters with 70+ Speed, 60+ Range and Bat-to-Ball 40 or below');
check('hands and a club', said({ ...scaleless, bats: 'S', throws: 'R', team: 'SEA' }, 'pct', 'Mariners') === 'Switch-hitting Mariners hitters who throw right');
check('left-handed pitchers', said({ ...scaleless, pool: 'pitchers', throws: 'L' }) === 'Left-handed pitchers');
check('each clause can be removed', sentenceOf(board, query, 'pct', '').filter((p) => p.filter).length === 2);

console.log('nobody fits');
const none = { ...scaleless, pos: 'SS', ratings: [makeFilter('speed', 'min', 90), makeFilter('gamePower', 'min', 90)] };
check('really is nobody', search(board, none, 'pct').matches.length === 0);
const ways = loosenings(board, none, 'pct');
check('dropping Speed counts the rest', ways[0].label === 'Drop 90+ Speed' && ways[0].count === 0, JSON.stringify(ways[0]));
check('dropping Game Power brings Witt back', ways[1].count === 1, JSON.stringify(ways[1]));
check('every position is on offer', ways[2].label === 'Look at every position' && ways[2].count === 1, JSON.stringify(ways[2]));

console.log('phone rows');
check('the numbers you asked about', keyline(board, witt, query, 'pct') === 'Range 96 · Game Power 88');
check('otherwise his best', keyline(board, witt, scaleless, 'pct') === 'Best: Speed 99');
check('no data says so', keyline(board, blank, scaleless, 'pct') === 'Not rated yet');

console.log('rosters');
const sea = rosterSections(board, 'SEA', { key: 'ovr', dir: -1 });
check('sections in order, empty ones gone', same(sea.map((s) => s.title), ['Catchers', 'Infielders', 'Outfielders', 'Pitchers']));
check('a catcher section has catcher columns', sea[0].keys.includes('framing') && !sea[0].keys.includes('range'));
check('unrated players are still on the roster', names(sea[2].rows).includes('Blank'));
check('someone with no club is on no roster', !sea.some((s) => names(s.rows).includes('Gone')));
check('a two-way player falls under DH', same(rosterSections(board, 'LAD', { key: 'ovr', dir: -1 }).map((s) => s.title), ['Designated hitters']));
check('a mark opens the roster', isRoster({ ...INITIAL_VIEW, ...teamPatch(scaleless, 'SEA') }));
check('the same mark closes it', !isRoster({ ...openClubPatch('SEA'), ...teamPatch(openClubPatch('SEA'), 'SEA') }));
check('with other filters a mark is one more filter', !isRoster({ ...two, ...teamPatch(two, 'SEA') }));
check('from the leaderboard a mark opens the roster', isRoster({ ...INITIAL_VIEW, view: 'teams', ...teamPatch({ ...INITIAL_VIEW, view: 'teams' }, 'SEA') }));

console.log('teams');
check('clubs best first', same(clubOrder(board, 'overall', 'pct'), ['SEA', 'CHC']));
check('no number, no rank', rankOf(board, 'LAD', 'overall', 'pct') === null);
check('a rank on one rating', rankOf(board, 'CHC', 'speed', 'pct') === 1 && rankOf(board, 'SEA', 'speed', 'pct') === 3);
check('the grade toggle reads grades', teamValue(board, 'SEA', 'hitting', 'grade') === 52.5);
check('a rating is on the toggle too', teamValue(board, 'SEA', 'speed', 'grade') === 48.7);
check('an unknown club is null', teamValue(board, 'XXX', 'overall', 'pct') === null);
const seaStrength = strengths(board, 'SEA', 'pct');
check('strengths ignore catcher boards', seaStrength.best.key === 'stuff' && seaStrength.worst.key === 'speed', JSON.stringify(seaStrength));
check('ordinals', same([1, 2, 3, 4, 11, 12, 13, 21, 22, 30].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '30th']));

console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
process.exit(failures ? 1 : 0);
