/* ---------------------------------------------------------------------------
   Offline check of follow.js: npm run selftest:follow

   Each case is a sequence of snapshots shaped like the live feed's, built from
   a tiny script of what happened, and asserts which pitches get handed to the
   replay. The cases are the ones a live game actually produced.
--------------------------------------------------------------------------- */

import { createFollowTracker, atBatAtPitch } from './follow.js';
import { interludeFor } from './interlude.js';

let failures = 0;
function check(label, ok, detail = '') {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `   ${detail}` : ''}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const located = (n, outcome = 'called') => ({ number: n, outcome, plate: { x: 0.1, z: 2.4 } });
const unlocated = (n, outcome = 'called') => ({ number: n, outcome, plate: { x: null, z: null } });
const inPlay = (n) => ({ ...located(n, 'inplay'), isInPlay: true });
const ab = (idx, pitches, done = false) => ({
  id: `ab-${idx}`,
  kind: done ? 'hit' : 'live',
  result: done ? 'Single' : 'At bat',
  exitVelo: done ? 101 : null,
  pitches,
});
/** Snapshots list newest at-bat first, as the feed does. */
const snap = (...atBats) => atBats.slice().reverse();
const ids = (r) => r.ready.map((e) => e.id);

console.log('\nfollowing live');

{
  // Opening in the middle of an at-bat: nothing plays.
  const t = createFollowTracker();
  t.baseline(snap(ab(0, [located(1), inPlay(2)], true), ab(1, [located(1), located(2)])), 'g');
  const r = t.update(snap(ab(0, [located(1), inPlay(2)], true), ab(1, [located(1), located(2)])));
  check('opening the viewer plays nothing that already happened', r.ready.length === 0 && r.unseen === 0);

  // The next pitch after opening plays, once.
  const next = snap(ab(0, [located(1), inPlay(2)], true), ab(1, [located(1), located(2), located(3)]));
  const r2 = t.update(next);
  check('the next pitch after opening plays', same(ids(r2), ['ab-1#3']), ids(r2).join());
  check('...and only once, however often the feed re-sends it', t.update(next).ready.length === 0);
}

{
  // A ball in play waits for the at-bat to close, then plays.
  const t = createFollowTracker();
  t.baseline(snap(ab(4, [located(1)])), 'g');
  const r1 = t.update(snap(ab(4, [located(1), inPlay(2)])));
  check('a ball in play is held until the at-bat closes', r1.ready.length === 0 && r1.unseen === 1 && t.waiting === 1);
  const r2 = t.update(snap(ab(4, [located(1), inPlay(2)], true), ab(5, [])));
  check('...then plays once the detail is there', same(ids(r2), ['ab-4#2']), ids(r2).join());
  check('...carrying the result', r2.ready[0].atBat.result === 'Single' && r2.ready[0].atBat.exitVelo === 101);
  check('the next batter stepping in is not a play', t.update(snap(ab(4, [located(1), inPlay(2)], true), ab(5, []))).ready.length === 0);
}

{
  // A pitch arrives before its tracking does: held, then played when located.
  const t = createFollowTracker();
  t.baseline(snap(ab(2, [located(1)])), 'g');
  const r1 = t.update(snap(ab(2, [located(1), unlocated(2)])));
  check('a pitch with no plate location yet is held', r1.ready.length === 0 && t.waiting === 1);
  const r2 = t.update(snap(ab(2, [located(1), located(2)])));
  check('...and plays when the location lands', same(ids(r2), ['ab-2#2']));
}

{
  // A pitch that never gets tracked cannot block the game.
  const t = createFollowTracker();
  t.baseline(snap(ab(3, [])), 'g');
  t.update(snap(ab(3, [unlocated(1)])));
  const r = t.update(snap(ab(3, [unlocated(1), located(2)])));
  check('an untracked pitch is skipped once a later one is ready', same(ids(r), ['ab-3#2']), ids(r).join());
  check('...and nothing is left waiting', t.waiting === 0);
}

{
  // Two pitches in one poll, across an at-bat boundary: both, in order.
  const t = createFollowTracker();
  t.baseline(snap(ab(6, [located(1)])), 'g');
  const r = t.update(snap(ab(6, [located(1), located(2, 'swinging')], true), ab(7, [located(1)])));
  check('pitches that land together play in order', same(ids(r), ['ab-6#2', 'ab-7#1']), ids(r).join());
}

{
  // An earlier pitch is shown as it was, not as the at-bat ended.
  const whole = ab(8, [located(1, 'foul'), inPlay(2)], true);
  const first = atBatAtPitch(whole, 0);
  check(
    'an earlier pitch does not carry how the at-bat ended',
    first.pitches.length === 1 && first.kind === 'live' && first.result === 'At bat' && first.exitVelo == null,
  );
  check('the final pitch keeps it', atBatAtPitch(whole, 1).result === 'Single');
}

{
  const t = createFollowTracker();
  t.baseline(snap(ab(0, [located(1)])), 'game-a');
  check('a baseline belongs to one game', t.isFor('game-a') && !t.isFor('game-b'));
}

console.log('\nbetween innings');

{
  const g = (inning, inningState, outs, away, home, status = 'live') => ({
    status,
    away: { runs: away },
    home: { runs: home },
    state: {
      inning,
      inningState,
      outs,
      half: inningState === 'Top' || inningState === 'Middle' ? 'top' : 'bottom',
      scheduledInnings: 9,
    },
  });
  const is = (game, want) => {
    const got = interludeFor(game);
    return want === null ? got === null : got?.kind === want.kind && (!want.label || got.label === want.label);
  };

  check('play in progress is not a break', is(g(5, 'Top', 2, 1, 1), null));
  check(
    'top half over: waiting for the bottom',
    is(g(5, 'Middle', 3, 1, 1), { kind: 'break', label: 'Waiting for the bottom of the 5th to begin' }),
  );
  check(
    'bottom half over: waiting for the next inning',
    is(g(6, 'End', 3, 1, 1), { kind: 'break', label: 'Waiting for the 7th inning to begin' }),
  );
  check(
    'an old payload with no inningState still reads three outs',
    is({ ...g(3, undefined, 3, 0, 0), state: { inning: 3, outs: 3, half: 'top' } }, { kind: 'break', label: 'Waiting for the bottom of the 3rd to begin' }),
  );
  // The game's last out: "Middle" of the 9th for half a minute before "Final".
  check('top of the 9th over, home ahead: over, not a break', is(g(9, 'Middle', 3, 4, 6), { kind: 'final', label: 'Final' }));
  check('top of the 9th over, away ahead: the bottom is played', is(g(9, 'Middle', 3, 6, 4), { kind: 'break' }));
  check('tied after nine: extras', is(g(9, 'End', 3, 3, 3), { kind: 'break', label: 'Waiting for the 10th inning to begin' }));
  check('an extra inning decided', is(g(11, 'End', 3, 5, 3), { kind: 'final', label: 'Final/11' }));
  check('a walk-off', is(g(9, 'Bottom', 1, 2, 3), { kind: 'final' }));
  check('the bottom of the 9th in progress is not over', is(g(9, 'Bottom', 1, 3, 2), null));
  check('the feed saying Final is final', is(g(9, 'Top', 3, 4, 6, 'final'), { kind: 'final' }));
  check(
    'a game not started yet is pregame, with its start time',
    is({ status: 'scheduled', detailedStatus: 'Scheduled', startsAt: '8:00 PM', state: null }, { kind: 'pregame', label: 'First pitch at 8:00 PM' }),
  );
  check(
    'warm-up is Live in the feed and still pregame until a pitch is thrown',
    interludeFor({ ...g(1, 'Top', 0, 0, 0), detailedStatus: 'Warmup' }, { started: false })?.eyebrow === 'Warming up',
  );
  check(
    'a live game with no word on pitches is taken as under way',
    interludeFor({ ...g(1, 'Top', 0, 0, 0), detailedStatus: 'Warmup' }) === null,
  );
  check('once a pitch is in, a live game is under way', interludeFor(g(1, 'Top', 0, 0, 0), { started: true }) === null);
  check(
    'a delayed start says so',
    interludeFor({ status: 'scheduled', detailedStatus: 'Delayed Start', startsAt: '7:05 PM' })?.eyebrow === 'Delayed start',
  );
  check(
    'a postponed game is not a 0-0 final',
    interludeFor({ status: 'final', detailedStatus: 'Postponed', away: { runs: 0 }, home: { runs: 0 } })?.kind === 'off',
  );
}

console.log(failures ? `\n${failures} check(s) failed\n` : '\nall checks passed\n');
process.exit(failures ? 1 : 0);
