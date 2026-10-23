/* Small, shared readings of a game's state for the scoreboard views (the
   Home ticker and the Games cards). Kept out of the screens so they stay
   component-only modules, which Fast Refresh needs. */

/** Status word and the one detail that goes with it, for a ticker cell. */
export function statusLine(game) {
  const st = game.state;
  if (game.status === 'live') {
    return ['Live', st ? `${st.half === 'top' ? '▲' : '▼'}${st.inning} · ${st.outs ?? 0} out` : ''];
  }
  if (game.status === 'final') return ['Final', ''];
  return [game.startsAt ?? 'Scheduled', ''];
}

/**
 * Which side, if either, has lost. Only once there is a result: a game still
 * going has a leader, not a loser, and only a final is dimmed.
 */
export function loserOf(game) {
  if (game.status !== 'final' || game.away.runs == null || game.home.runs == null) return null;
  if (game.away.runs === game.home.runs) return null;
  return game.away.runs < game.home.runs ? 'away' : 'home';
}
