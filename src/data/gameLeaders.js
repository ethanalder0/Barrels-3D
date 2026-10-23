/* ---------------------------------------------------------------------------
   Game leaders: who hit it hardest, swung fastest, threw hardest — this game.

   Every board ranks EVENTS, not players: if one pitcher threw the three
   fastest pitches of the game, he holds the top three rows. Each row keeps the
   at-bat its event came from AND the pitch within it, so the UI replays that
   pitch. Pitch velocity,
   spin rate and bat speed are often not the pitch that ended the at-bat (a
   99 mph fastball taken for ball one, a 78 mph swing fouled off), and an
   at-bat on its own replays only its last pitch.

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

/* How many a board holds in all, below the ones on show. Events, not players,
   so this is a cut rather than everyone: a game has ~300 pitches. */
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

/* The pitch a row should replay, or null for "the at-bat as it ended", which
   is what replaying the at-bat already shows. Keeping the final pitch as null
   means a row and a pick of the same at-bat elsewhere count as the same play. */
function pitchOf(ab, n) {
  if (n == null) return null;
  const last = ab.pitches?.[ab.pitches.length - 1]?.number;
  return n === last ? null : n;
}

/** Every event a board can rank, one per batted ball, pitch or swing. */
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
          pitchNumber: pitchOf(ab, p.number),
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
          pitchNumber: pitchOf(ab, row.n),
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
          pitchNumber: pitchOf(ab, row.n),
        });
      }
    }
  }

  return out;
}

/**
 * The top `limit` events for a category, highest first. The same player can
 * hold any number of rows.
 *
 * Rows: { key, rank, playerId, name, team, value, context, ab, pitchNumber },
 * where pitchNumber is null when the event was the at-bat's last pitch and
 * `key` is unique to the event (its at-bat and pitch).
 *
 * `limit` defaults to GAME_LEADER_LIMIT above — change it there, not here.
 */
export function gameLeaders(
  categoryId,
  { atBats = [], statcast = null, game = null, limit = GAME_LEADER_LIMIT } = {},
) {
  return events(categoryId, atBats, statcast, game)
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((row, i) => ({ ...row, key: `${row.ab.id}#${row.pitchNumber ?? 'end'}`, rank: i + 1 }));
}
