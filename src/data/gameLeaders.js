/* ---------------------------------------------------------------------------
   Game leaders: who hit it hardest, swung fastest, threw hardest — this game.

   Every board ranks PLAYERS by their single best event, not events: otherwise
   one flamethrower's twenty 98s fill the pitch-velocity board and it says
   nothing about anyone else. Each row keeps the at-bat its best event came
   from, so the UI can replay it.

   Exit velocity, distance and pitch velocity come straight off the at-bats the
   snapshot already carries. Bat speed and spin rate are not in the statsapi
   feed; they arrive separately from Savant (fetchGameStatcast) keyed by at-bat
   index and pitch number, and are joined on here.
--------------------------------------------------------------------------- */

export const LEADER_CATEGORIES = [
  { id: 'exitVelo', group: 'Hitting', label: 'Exit velocity', unit: 'speed', statcast: false },
  { id: 'batSpeed', group: 'Hitting', label: 'Bat speed', unit: 'speed', statcast: true },
  { id: 'distance', group: 'Hitting', label: 'Hit distance', unit: 'distance', statcast: false },
  { id: 'pitchVelo', group: 'Pitching', label: 'Pitch velocity', unit: 'speed', statcast: false },
  { id: 'spinRate', group: 'Pitching', label: 'Spin rate', unit: 'rpm', statcast: true },
];

export const DEFAULT_LEADER_CATEGORY = 'exitVelo';

/* ---------------------------------------------------------------------------
   HOW MANY ROWS A GAME-LEADER BOARD SHOWS.  <-- change this one number

   A board SHOWS this many rows and scrolls for the rest, so it takes the same
   room beside the box score however many players are on it. Editing this
   changes every board on the live screen (exit velocity, bat speed, hit
   distance, pitch velocity, spin rate).
--------------------------------------------------------------------------- */
export const GAME_LEADER_VISIBLE = 5;

/* How many a board holds in all, below the ones on show. More than any one
   game's list of players, so in practice it is everyone. */
export const GAME_LEADER_LIMIT = 50;

/** Which club a side of the at-bat plays for: the away team bats in the top. */
function clubs(ab, game) {
  const top = ab.half ? ab.half === 'top' : ab.inningLabel?.startsWith('T');
  const batting = top ? game?.away?.abbr : game?.home?.abbr;
  const fielding = top ? game?.home?.abbr : game?.away?.abbr;
  return { batting, fielding };
}

function pitchByNumber(ab, n) {
  return (ab.pitches ?? []).find((p) => p.number === n) ?? null;
}

/** One candidate event per (player, value). Only the best per player survives. */
function events(categoryId, atBats, statcast, game) {
  const out = [];

  if (categoryId === 'exitVelo' || categoryId === 'distance') {
    const key = categoryId === 'exitVelo' ? 'exitVelo' : 'distance';
    for (const ab of atBats) {
      if (ab[key] == null) continue;
      out.push({
        playerId: ab.batterId,
        name: ab.batter,
        team: clubs(ab, game).batting,
        value: ab[key],
        context: ab.result,
        ab,
      });
    }
  }

  if (categoryId === 'pitchVelo') {
    for (const ab of atBats) {
      const list = ab.pitches?.length ? ab.pitches : ab.pitch ? [ab.pitch] : [];
      for (const p of list) {
        if (p.velo == null) continue;
        out.push({
          playerId: ab.pitcherId,
          name: ab.pitcher,
          team: clubs(ab, game).fielding,
          value: p.velo,
          context: p.type && p.type !== '—' ? p.type : 'Pitch',
          ab,
        });
      }
    }
  }

  if ((categoryId === 'batSpeed' || categoryId === 'spinRate') && statcast?.length) {
    const byIndex = new Map(atBats.map((ab) => [ab.atBatIndex, ab]));
    for (const row of statcast) {
      const ab = byIndex.get(row.ab);
      if (!ab) continue;
      const pitch = pitchByNumber(ab, row.n);
      if (categoryId === 'batSpeed') {
        if (row.batSpeed == null) continue;
        out.push({
          playerId: ab.batterId,
          name: ab.batter,
          team: clubs(ab, game).batting,
          value: row.batSpeed,
          // The swing that ended the at-bat reads as its result; any other
          // swing reads as what happened on that pitch (foul, whiff).
          context: pitch?.isInPlay ? ab.result : pitch?.call ?? 'Swing',
          ab,
        });
      } else {
        if (row.spinRate == null) continue;
        out.push({
          playerId: ab.pitcherId,
          name: ab.pitcher,
          team: clubs(ab, game).fielding,
          value: row.spinRate,
          context: pitch?.type ?? 'Pitch',
          ab,
        });
      }
    }
  }

  return out;
}

/**
 * The top `limit` players for a category, best event each, highest first.
 * Rows: { rank, playerId, name, team, value, context, ab }.
 *
 * `limit` defaults to GAME_LEADER_LIMIT above — change it there, not here.
 */
export function gameLeaders(
  categoryId,
  { atBats = [], statcast = null, game = null, limit = GAME_LEADER_LIMIT } = {},
) {
  const best = new Map();
  for (const ev of events(categoryId, atBats, statcast, game)) {
    const key = ev.playerId || ev.name;
    const prev = best.get(key);
    if (!prev || ev.value > prev.value) best.set(key, ev);
  }
  return [...best.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}
