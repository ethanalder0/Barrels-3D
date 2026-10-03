/* ---------------------------------------------------------------------------
   BETWEEN INNINGS — is the game on a break, or over?
   ---------------------------------------------------------------------------
   Following a live game, the gap between half innings is two minutes of
   nothing, and a replay sitting on an empty zone for two minutes looks frozen.
   So the viewer puts up a screen for it — and a different one when the game
   is over for good. This decides which, from the game's own state.

   What the feed does, measured from a real game (NYM @ WSH, 2026-09-27):

     third out of a top half   inningState "Middle", outs 3 — in the SAME
                               update that closes the at-bat
     third out of a bottom     inningState "End", outs 3
     ~2 minutes later          inningState "Top"/"Bottom", outs 0, and the
                               next batter's at-bat appears, often with no
                               pitch in it yet
     the game's last out       inningState "Middle" or "End" for ~30 s, and
                               only THEN status "Final"

   That last line is why game over is worked out from the rules and not only
   from the status: in the half-minute before "Final", a top of the ninth that
   ends with the home side ahead reads exactly like any other middle of an
   inning, and the screen would have said "waiting for the bottom of the 9th"
   — a half that is never going to be played.

   Pure: reads a snapshot's `game`, touches nothing. The viewer decides WHEN to
   ask (only once the picture has caught up with the feed); this only answers.
--------------------------------------------------------------------------- */

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Where the game is within its inning: 'Top' | 'Middle' | 'Bottom' | 'End',
 * as the feed words it. An older payload without `inningState` still says
 * three outs, which is enough to tell a break from play.
 */
function phaseOf(state) {
  if (state.inningState) return state.inningState;
  if ((state.outs ?? 0) >= 3) return state.half === 'bottom' ? 'End' : 'Middle';
  return state.half === 'bottom' ? 'Bottom' : 'Top';
}

/** Is the game over — officially, or by rule and just not declared yet? */
export function isGameOver(game) {
  if (!game) return false;
  if (game.status === 'final') return true;
  const st = game.state;
  if (!st || game.status !== 'live') return false;

  const away = game.away?.runs ?? 0;
  const home = game.home?.runs ?? 0;
  if (st.inning < (st.scheduledInnings ?? 9)) return false;

  const phase = phaseOf(st);
  // Top of the ninth or later is over and the home side is ahead: no bottom.
  if (phase === 'Middle') return home > away;
  // A whole inning is over at or past the ninth, and it is not tied.
  if (phase === 'End') return home !== away;
  // A walk-off: the home side can only lead in the bottom half by winning.
  if (phase === 'Bottom') return home > away;
  return false;
}

/**
 * What to put over the replay while nothing is being played, or null.
 *
 *   { kind: 'pregame', eyebrow, label }      no pitch thrown yet
 *   { kind: 'break', eyebrow, label }        between half innings
 *   { kind: 'final', label }                 the game is over
 *   { kind: 'off', label }                   postponed or cancelled
 *
 * Every one has a `key` identifying it, so the same one is not put up twice.
 *
 * `started` is whether any pitch is in the feed. A game goes "Live" for its
 * warm-up, before a ball has been thrown, and that is still pre-game. Leave it
 * out and a live game is taken as under way.
 */
export function interludeFor(game, { started } = {}) {
  const detail = game?.detailedStatus ?? '';
  /* A postponed game is filed as Final, 0-0. Put up a final score for it and
     the screen claims a result that never happened. */
  if (/postpone|cancel/i.test(detail)) return { kind: 'off', label: detail, key: `off|${detail}` };

  if (game?.status === 'scheduled' || (game?.status === 'live' && started === false)) {
    const delayed = /delay/i.test(detail);
    const warmup = /warmup/i.test(detail);
    return {
      kind: 'pregame',
      eyebrow: delayed ? 'Delayed start' : warmup ? 'Warming up' : 'Pregame',
      label:
        !delayed && !warmup && game.startsAt
          ? `First pitch at ${game.startsAt}`
          : 'Waiting for the first pitch',
      key: `pregame|${detail}`,
    };
  }

  if (isGameOver(game)) {
    const st = game.state;
    const scheduled = st?.scheduledInnings ?? 9;
    const extra = st?.inning && st.inning !== scheduled ? `/${st.inning}` : '';
    return { kind: 'final', label: `Final${extra}`, key: 'final' };
  }
  const st = game?.state;
  if (!st || game.status !== 'live') return null;

  const phase = phaseOf(st);
  if (phase === 'Middle') {
    return {
      kind: 'break',
      eyebrow: `Middle of the ${ordinal(st.inning)}`,
      label: `Waiting for the bottom of the ${ordinal(st.inning)} to begin`,
      key: `${st.inning}-middle`,
    };
  }
  if (phase === 'End') {
    return {
      kind: 'break',
      eyebrow: `End of the ${ordinal(st.inning)}`,
      label: `Waiting for the ${ordinal(st.inning + 1)} inning to begin`,
      key: `${st.inning}-end`,
    };
  }
  return null;
}
