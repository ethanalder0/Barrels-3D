/* ---------------------------------------------------------------------------
   FAVOURITE TEAMS — the clubs this browser follows.
   ---------------------------------------------------------------------------
   The one piece of app state that is WORTH persisting, and the reason this file
   exists at all: settings are preferences you can set again in five seconds,
   but a set of favourite teams you have to re-pick on every reload is not a
   feature, it is a chore. So these go to localStorage and nothing else does.

   Stored as a list of the abbreviations the MLB feed already sends ('NYY',
   'LAD'), which is the same key TEAMS, the logos and the team colours are
   keyed by — so a favourite needs no lookup table of its own.

   ORDER IS THE USER'S. The list is kept in the order clubs were picked rather
   than sorted, because for anyone with two or three it reads as a ranking: the
   first one is "my team" and the rest are the ones they also watch.
--------------------------------------------------------------------------- */

import { TEAMS } from './teams.js';

const STORAGE_KEY = 'barrels:favorites';

/* A cap, so the idea stays meaningful. Favouriting twenty clubs is the same as
   favouriting none — every game matches and nothing is surfaced. */
export const MAX_FAVORITES = 6;

/**
 * The stored favourites, or an empty list.
 *
 * Every entry is checked against TEAMS on the way out. Storage outlives the
 * code that wrote it: a club that gets renamed or re-abbreviated (the A's have
 * already done it once) would otherwise sit in the list forever, matching no
 * game and rendering a broken logo.
 *
 * Wrapped because storage is not always there to read — Safari in private
 * mode throws on access rather than returning null, and an embedded frame can
 * have it blocked outright.
 */
export function readFavorites() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((abbr) => typeof abbr === 'string' && TEAMS[abbr]).slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

/** Persist the list. Silently does nothing where storage is unavailable. */
export function writeFavorites(list) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* private mode, or storage disabled: the session keeps working in memory */
  }
}

/**
 * Add or remove one club, returning a new list.
 *
 * At the cap, adding drops the OLDEST favourite rather than refusing. Refusing
 * is the behaviour that needs explaining in the UI ("why is nothing
 * happening?"); dropping the one picked longest ago is what the person clicking
 * a new club plainly meant.
 */
export function toggleFavorite(list, abbr) {
  if (!TEAMS[abbr]) return list;
  if (list.includes(abbr)) return list.filter((a) => a !== abbr);
  return [...list, abbr].slice(-MAX_FAVORITES);
}

/** Does either club in this game belong to the list? */
export function isFavoriteGame(game, list) {
  if (!game || !list.length) return false;
  return list.includes(game.away?.abbr) || list.includes(game.home?.abbr);
}

/**
 * Games with a favourite club in them first, everything else after, each half
 * keeping the order it came in.
 *
 * A stable partition, not a sort: the schedule arrives in a deliberate order
 * (first pitch, then whatever the feed decided) and a comparator that only
 * knows about favourites would scramble the rest of it.
 */
export function favoritesFirst(games, list) {
  if (!list.length) return games;
  const mine = [];
  const rest = [];
  for (const game of games) (isFavoriteGame(game, list) ? mine : rest).push(game);
  return [...mine, ...rest];
}

/** The abbreviations of every club, in full-name order — for a picker. */
export function allTeamAbbrs() {
  return Object.keys(TEAMS).sort((a, b) =>
    (TEAMS[a].fullName ?? a).localeCompare(TEAMS[b].fullName ?? b),
  );
}
