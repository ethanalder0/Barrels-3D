/* ---------------------------------------------------------------------------
   Player search: the matching, with no React and no network.

   The browser holds the whole roster (~1,560 rows, /api/players) and matches
   locally, so results keep up with typing and a phone never waits on a request
   per keystroke. Checked offline by `npm run selftest:search`.

   What a person types is rarely what the feed spells. So every name is folded
   before it is compared: accents off (112 current names have one, and nobody
   types the tilde in Acuña), case off, punctuation off. Then, best first:

     exact name > name starts with it > every typed word starts a name word
     > initials ("pca") > appears anywhere > his team's abbreviation ("nyy")
     > one or two typos

   Ties go to whoever has played more, so "smith" finds the everyday catcher
   before a September call-up.
--------------------------------------------------------------------------- */

export function fold(text) {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.']/g, '') // A.J. -> aj, O'Hoppe -> ohoppe
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** The roster with its folded forms worked out once, not per keystroke. */
export function prepareIndex(rows) {
  return (rows ?? []).map((row) => {
    const name = fold(row.name);
    const words = name.split(' ').filter(Boolean);
    return {
      ...row,
      folded: name,
      words,
      initials: words.map((w) => w[0]).join(''),
      abbr: (row.team ?? '').toLowerCase(),
    };
  });
}

/** Edit distance, adjacent swaps counted as one. Stops early past `max`. */
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, before[j - 2] + 1);
      }
      row.push(d);
      best = Math.min(best, d);
    }
    if (best > max) return max + 1;
    before = prev;
    prev = row;
  }
  return prev[b.length];
}

/* Longer words can absorb more typos; a four-letter one can absorb one. */
const allowedTypos = (word) => (word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0);

function scoreOf(player, query, tokens) {
  const { folded, words, initials, abbr } = player;
  if (folded === query) return 100;
  if (folded.startsWith(query)) return 90;

  if (tokens.every((t) => words.some((w) => w.startsWith(t)))) {
    // A whole word typed ("judge") beats a word begun ("jud").
    return tokens.every((t) => words.includes(t)) ? 85 : 80;
  }
  if (tokens.length === 1 && query.length >= 2 && initials === query) return 70;
  if (query.length >= 2 && folded.includes(query)) return 60;
  if (abbr && abbr === query) return 40;

  // Typos, word by word, so "acuna jr" and "ronald acnua" both land.
  let total = 0;
  for (const t of tokens) {
    const allowed = allowedTypos(t);
    if (!allowed) {
      if (!words.some((w) => w.startsWith(t))) return 0;
      continue;
    }
    let best = allowed + 1;
    for (const w of words) best = Math.min(best, editDistance(t, w, allowed));
    if (best > allowed) return 0;
    total += best;
  }
  return total > 0 ? 30 - total : 0;
}

/**
 * The best matches for what was typed, best first.
 * `accept` narrows who can match at all (hitters only, not himself).
 */
export function matchPlayers(index, text, { limit = 8, accept = null } = {}) {
  const query = fold(text);
  if (!query) return [];
  const tokens = query.split(' ');
  const hits = [];
  for (const player of index ?? []) {
    if (accept && !accept(player)) continue;
    const score = scoreOf(player, query, tokens);
    if (score > 0) hits.push({ player, score });
  }
  hits.sort(
    (a, b) =>
      b.score - a.score ||
      (b.player.w ?? 0) - (a.player.w ?? 0) ||
      a.player.name.localeCompare(b.player.name),
  );
  return hits.slice(0, limit).map((h) => h.player);
}

/** A hitter or a pitcher, decided the way the card decides it: only "P" pitches. */
export const isPitcherRow = (row) => row?.pos === 'P';

/**
 * Is he in a live game right now?
 *
 * Batting and pitching come from the scoreboard's line score. Otherwise his team
 * being in a live game is all that is known -- he may be on the bench -- so the
 * badge says the game is live, not that he is in it.
 */
export function liveStatus(player, games) {
  for (const game of games ?? []) {
    if (game?.status !== 'live') continue;
    const matchup = `${game.away?.abbr}–${game.home?.abbr}`;
    const state = game.state ?? {};
    if (state.batterId && String(state.batterId) === String(player.id)) {
      return { kind: 'batting', label: `Batting · ${matchup}`, gameId: game.id };
    }
    if (state.pitcherId && String(state.pitcherId) === String(player.id)) {
      return { kind: 'pitching', label: `Pitching · ${matchup}`, gameId: game.id };
    }
  }
  for (const game of games ?? []) {
    if (game?.status !== 'live') continue;
    if (player.team && (game.away?.abbr === player.team || game.home?.abbr === player.team)) {
      return { kind: 'team', label: `${game.away.abbr}–${game.home.abbr} live`, gameId: game.id };
    }
  }
  return null;
}

/** Who is up in each live game, for the box before anything is typed. */
export function atThePlate(index, games) {
  const byId = new Map((index ?? []).map((p) => [String(p.id), p]));
  const out = [];
  for (const game of games ?? []) {
    if (game?.status !== 'live' || !game.state?.batterId) continue;
    const player = byId.get(String(game.state.batterId));
    if (player) out.push(player);
  }
  return out;
}

/* --- recently viewed, per browser ----------------------------------------- */

const RECENT_KEY = 'barrels.recentPlayers';
const RECENT_MAX = 6;

export function readRecent() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

export function pushRecent(id) {
  try {
    const next = [String(id), ...readRecent().filter((r) => r !== String(id))].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode: search still works, it just forgets */
  }
}
