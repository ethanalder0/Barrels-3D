/* ---------------------------------------------------------------------------
   node src/state/urlState.selftest.js

   Every screen to a URL and back, the Players filters included, and the URLs
   people will actually paste.
--------------------------------------------------------------------------- */

import { INITIAL_VIEW, PRESETS, makeFilter, presetPatch } from '../data/playerBoard.js';
import { pageOf, readUrl, writeUrl } from './urlState.js';

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
}

const base = { screen: 'home', playerCardId: null, playersView: INITIAL_VIEW, leaderboard: null, selectedGameId: null, scoreboardDate: null };
const at = (url) => {
  const [path, query = ''] = url.split('?');
  return readUrl(path, query ? `?${query}` : '');
};
const roundTrip = (state) => {
  const url = writeUrl({ ...base, ...state });
  return { url, back: at(url) };
};
const sameView = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log('screens');
check('home is bare', writeUrl(base) === '/');
check('home shows the splash', at('/').entered === false);
check('any other page skips it', at('/players').entered && at('/ratings').entered);
check('a card on the home page skips it too', at('/?player=123').entered && at('/?player=123').playerCardId === '123');
check('How Overall works', writeUrl({ ...base, screen: 'ratings' }) === '/ratings' && at('/ratings').screen === 'ratings');
check('settings', at('/settings').screen === 'settings');
check('an unknown path is home', at('/nope').screen === 'home');
check('a trailing slash is the same page', at('/players/').screen === 'players');

console.log('games');
const live = roundTrip({ screen: 'live', selectedGameId: '822940', scoreboardDate: '2026-09-01' });
check('a game and its day', live.url === '/live?game=822940&date=2026-09-01', live.url);
check('come back the same', live.back.selectedGameId === '822940' && live.back.scoreboardDate === '2026-09-01');
check('a stub game id stays out', writeUrl({ ...base, screen: 'live', selectedGameId: 'tb-cle' }) === '/live');
check('the scoreboard keeps its day', writeUrl({ ...base, screen: 'games', scoreboardDate: '2026-09-01' }) === '/games?date=2026-09-01');
check('a bad date is ignored', at('/games?date=yesterday').scoreboardDate === undefined);
const lb = roundTrip({ screen: 'leaderboard', leaderboard: { groupId: 'hitting', categoryId: 'wrcPlus' } });
check('a leaderboard', lb.url === '/leaders?group=hitting&cat=wrcPlus' && lb.back.leaderboard.categoryId === 'wrcPlus', lb.url);

console.log('players');
check('the plain list is bare', writeUrl({ ...base, screen: 'players' }) === '/players');
const query = { ...INITIAL_VIEW, pos: 'SS', ratings: [makeFilter('range', 'min', 70), makeFilter('gamePower', 'min', 60)] };
const q = roundTrip({ screen: 'players', playersView: query });
check('the brief\'s example', q.url === '/players?pos=SS&range=70&gamePower=60', q.url);
check('reads back the same', sameView(q.back.playersView, query));
const atMost = { ...INITIAL_VIEW, ratings: [makeFilter('batToBall', 'max', 40)] };
check('"at most" reads as max', writeUrl({ ...base, screen: 'players', playersView: atMost }) === '/players?batToBall=max40');
check('and comes back as "at most"', at('/players?batToBall=max40').playersView.ratings[0].op === 'max');
const hands = { ...INITIAL_VIEW, pool: 'pitchers', throws: 'L', pt: 'regulars' };
const h = roundTrip({ screen: 'players', playersView: hands });
check('pitchers, a hand and playing time', h.url === '/players?pool=pitchers&throws=L&pt=regulars' && sameView(h.back.playersView, hands), h.url);
check('bats is ignored for pitchers', at('/players?pool=pitchers&bats=L').playersView.bats === 'Any');
check('a position is ignored for pitchers', at('/players?pool=pitchers&pos=SS').playersView.pos === 'All');
check('nonsense is ignored', sameView(at('/players?pos=QB&bats=X&pt=sometimes&range=abc').playersView, INITIAL_VIEW));
check('a rating over 100 is held at 100', at('/players?speed=150').playersView.ratings[0].pct === 100);
const sorted = { ...INITIAL_VIEW, sort: { key: 'speed', dir: -1 } };
check('a sort, best first', writeUrl({ ...base, screen: 'players', playersView: sorted }) === '/players?sort=speed');
const flipped = { ...INITIAL_VIEW, sort: { key: 'speed', dir: 1 } };
const f = roundTrip({ screen: 'players', playersView: flipped });
check('a reversed sort says so', f.url === '/players?sort=speed&dir=asc' && sameView(f.back.playersView, flipped), f.url);
check('by name is A to Z unless it says', at('/players?sort=name').playersView.sort.dir === 1);
check('thin players shown', at('/players?thin=1').playersView.includeThin === true);

console.log('presets');
PRESETS.forEach((preset) => {
  const view = { ...INITIAL_VIEW, ...presetPatch(preset) };
  const r = roundTrip({ screen: 'players', playersView: view });
  check(`${preset.name} is one word`, r.url === `/players?preset=${preset.id}` && sameView(r.back.playersView, view), r.url);
});
const junk = { ...INITIAL_VIEW, ...presetPatch(PRESETS.find((p) => p.id === 'junk')) };
check('a preset with a different sort keeps it', writeUrl({ ...base, screen: 'players', playersView: { ...junk, sort: { key: 'velocity', dir: 1 } } })
  === '/players?preset=junk&sort=velocity&dir=asc');
const junkRegulars = writeUrl({ ...base, screen: 'players', playersView: { ...junk, pt: 'regulars' } });
check('a preset plus regulars is no longer the preset', junkRegulars === '/players?pool=pitchers&velocity=max50&stuff=75&pt=regulars&sort=stuff', junkRegulars);
check('an unknown preset is just the list', sameView(at('/players?preset=nope').playersView, INITIAL_VIEW));

console.log('teams');
const roster = { ...INITIAL_VIEW, team: 'SEA', pool: null };
const r = roundTrip({ screen: 'players', playersView: roster });
check('a roster', r.url === '/players?team=SEA' && sameView(r.back.playersView, roster), r.url);
const clubList = { ...INITIAL_VIEW, team: 'SEA', ratings: [makeFilter('speed', 'min', 80)] };
const c = roundTrip({ screen: 'players', playersView: clubList });
check('a club plus a filter is a list, not its roster', c.url === '/players?pool=hitters&team=SEA&speed=80' && sameView(c.back.playersView, clubList), c.url);
const clubHitters = { ...INITIAL_VIEW, team: 'SEA' };
check('a club\'s hitters only, with no filter, stays a list', sameView(roundTrip({ screen: 'players', playersView: clubHitters }).back.playersView, clubHitters));
const board = { ...INITIAL_VIEW, view: 'teams', cat: 'stuff', team: 'SEA' };
const b = roundTrip({ screen: 'players', playersView: board });
check('the team leaderboard', b.url === '/teams?cat=stuff&team=SEA' && sameView(b.back.playersView, board), b.url);
check('ranked by overall is bare', writeUrl({ ...base, screen: 'players', playersView: { ...INITIAL_VIEW, view: 'teams' } }) === '/teams');
check('a lowercase team is ignored', at('/players?team=sea').playersView.team === null);

console.log('cards and replay');
check('a card rides on any page', writeUrl({ ...base, screen: 'players', playersView: query, playerCardId: '669257' })
  === '/players?pos=SS&range=70&gamePower=60&player=669257');
check('replay options ride along', writeUrl(base, { replay: '1', speed: '8' }) === '/?replay=1&speed=8');
check('speed is the rating on the players page', at('/players?speed=90').playersView.ratings[0].key === 'speed');
check('...but the replay speed during a replay', at('/players?replay=1&speed=8').playersView.ratings.length === 0);
check('a Speed filter wins over the replay speed', writeUrl({ ...base, screen: 'players', playersView: { ...INITIAL_VIEW, ratings: [makeFilter('speed', 'min', 85)] } }, { speed: '8' }) === '/players?speed=85');
check('opening a card is a new page', pageOf('/players?player=1') !== pageOf('/players'));
check('a new club is a new page', pageOf('/players?team=SEA') !== pageOf('/players?team=NYY'));
check('moving a slider is not', pageOf('/players?range=70') === pageOf('/players?range=75'));

console.log(failures ? `\n${failures} FAILED` : '\nAll passed.');
process.exit(failures ? 1 : 0);
