/* ---------------------------------------------------------------------------
   Offline check of playerSearch.js: npm run selftest:search

   The names are real ones chosen for what makes them hard: accents, suffixes,
   hyphens, initials, apostrophes, and surnames several players share.
--------------------------------------------------------------------------- */

import {
  atThePlate,
  editDistance,
  fold,
  isPitcherRow,
  liveStatus,
  matchPlayers,
  prepareIndex,
} from './playerSearch.js';

let failures = 0;

function check(label, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
}

const rows = [
  { id: '660670', name: 'Ronald Acuña Jr.', team: 'ATL', pos: 'RF', w: 600 },
  { id: '682663', name: 'Luisangel Acuña', team: 'NYM', pos: '2B', w: 300 },
  { id: '592450', name: 'Aaron Judge', team: 'NYY', pos: 'RF', w: 680 },
  { id: '691718', name: 'Pete Crow-Armstrong', team: 'CHC', pos: 'CF', w: 640 },
  { id: '669004', name: 'A.J. Puk', team: 'ARI', pos: 'P', w: 150 },
  { id: '669127', name: "Logan O'Hoppe", team: 'LAA', pos: 'C', w: 500 },
  { id: '669257', name: 'Will Smith', team: 'LAD', pos: 'C', w: 520 },
  { id: '622168', name: 'Will Smith', team: 'KC', pos: 'P', w: 40 },
  { id: '596019', name: 'Dominic Smith', team: 'NYM', pos: '1B', w: 300 },
  { id: '660271', name: 'Shohei Ohtani', team: 'LAD', pos: 'TWP', w: 700 },
  { id: '669373', name: 'Tarik Skubal', team: 'DET', pos: 'P', w: 700 },
  { id: '656302', name: 'Dylan Cease', team: 'TOR', pos: 'P', w: 720 },
];
const index = prepareIndex(rows);
const top = (text, options) => matchPlayers(index, text, options)[0]?.name;
const names = (text, options) => matchPlayers(index, text, options).map((p) => p.name);

console.log('\nfolding');
check('accents come off', fold('Ronald Acuña Jr.') === 'ronald acuna jr');
check('initials close up', fold('A.J. Puk') === 'aj puk');
check('apostrophes close up', fold("Logan O'Hoppe") === 'logan ohoppe');
check('hyphens split words', fold('Pete Crow-Armstrong') === 'pete crow armstrong');

console.log('\nmatching');
check('no accent needed', top('acuna') === 'Ronald Acuña Jr.', top('acuna'));
check('an accent typed still matches', top('acuña') === 'Ronald Acuña Jr.');
check('a surname alone', top('judge') === 'Aaron Judge');
check('partial surname', top('jud') === 'Aaron Judge');
check('words in any order', top('judge aaron') === 'Aaron Judge');
check('either half of a hyphen', top('armstrong') === 'Pete Crow-Armstrong');
check('initials', top('pca') === 'Pete Crow-Armstrong', top('pca'));
check('dotted initials typed without dots', top('aj puk') === 'A.J. Puk');
check('with the apostrophe', top("o'hoppe") === "Logan O'Hoppe");
check('without the apostrophe', top('ohoppe') === "Logan O'Hoppe");
check('case does not matter', top('SKUBAL') === 'Tarik Skubal');
check('a team abbreviation lists the roster', names('lad').includes('Shohei Ohtani'));
check('nothing typed is nothing found', matchPlayers(index, '   ').length === 0);
check('nonsense finds nothing', matchPlayers(index, 'zzzzzz').length === 0);

console.log('\ntypos');
check('one wrong letter', top('skubel') === 'Tarik Skubal', top('skubel'));
check('two swapped letters', top('ohtnai') === 'Shohei Ohtani', top('ohtnai'));
check('a missing letter', top('jude') === 'Aaron Judge', top('jude'));
check('typo in one word of two', top('dylan ceese') === 'Dylan Cease', top('dylan ceese'));
check('short words get no typos', !names('cae').includes('Dylan Cease'));
check('edit distance counts a swap as one', editDistance('ohtnai', 'ohtani') === 1);

console.log('\nordering');
const smiths = matchPlayers(index, 'will smith');
check('a shared name: the regular first', smiths[0].id === '669257' && smiths[1].id === '622168');
check('a surname finds everyone who shares it', names('smith').length === 3);
check('an exact name beats a partial one', top('dominic smith') === 'Dominic Smith');
check('the better match wins over playing time', top('luisangel') === 'Luisangel Acuña');
check('limit is honoured', matchPlayers(index, 'a', { limit: 2 }).length === 2);

console.log('\nfiltering, for Compare with');
const hitters = (p) => !isPitcherRow(p);
check('a two-way player counts as a hitter', isPitcherRow({ pos: 'TWP' }) === false);
check('pitchers are left out when asked', matchPlayers(index, 'smith', { accept: hitters }).every((p) => p.pos !== 'P'));
check('he can be left out of his own search', !names('judge', { accept: (p) => p.id !== '592450' }).includes('Aaron Judge'));

console.log('\nlive badges');
const games = [
  { id: 'g1', status: 'final', away: { abbr: 'BOS' }, home: { abbr: 'TOR' }, state: null },
  {
    id: 'g2',
    status: 'live',
    away: { abbr: 'NYY' },
    home: { abbr: 'DET' },
    state: { batterId: '592450', pitcherId: '669373' },
  },
];
const judge = index.find((p) => p.id === '592450');
const skubal = index.find((p) => p.id === '669373');
const ohtani = index.find((p) => p.id === '660271');
const cease = index.find((p) => p.id === '656302');
check('the batter', liveStatus(judge, games)?.label === 'Batting · NYY–DET', liveStatus(judge, games)?.label);
check('the pitcher', liveStatus(skubal, games)?.label === 'Pitching · NYY–DET');
check('a team off today', liveStatus(ohtani, games) === null);
check('a final game is not live', liveStatus(cease, [games[0]]) === null);
const teammate = { id: '1', team: 'NYY' };
check('a teammate: the game is live, not him', liveStatus(teammate, games)?.label === 'NYY–DET live');
check('badge knows which game to jump to', liveStatus(judge, games)?.gameId === 'g2');
check('at the plate lists the batter', atThePlate(index, games).map((p) => p.id).join() === '592450');
check('at the plate with no live games', atThePlate(index, [games[0]]).length === 0);

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed\n');
if (failures) process.exit(1);
