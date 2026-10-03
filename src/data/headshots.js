/* ---------------------------------------------------------------------------
   MLB headshots from a player id.

   The id is the only input. Nothing here stores a per-player URL, and no image
   files are checked into the repo: give it the MLBAM person id that already
   arrives on every box-score row, at-bat and leaderboard entry and it builds
   the URL.

   Two variants, because a card and a table row want different pictures:

     'cutout'  the silhouetted portrait — subject cut out, transparent
               background. This is the one that makes a player card look like a
               player card, because it composites over the club's colours.
     'spot'    the small round-cropped headshot, for an inline avatar.

   ONE TRAP, VERIFIED AGAINST THE LIVE CDN: an unknown id does not 404. Every
   variant answers 200 with MLB's own generic silhouette (7,283 bytes for the
   cutout). So an <img> onError handler CANNOT detect "this player has no
   photo" — it only ever fires for a genuine network or decode failure. That is
   why `mlbHeadshotUrl` returns null for anything that is not a plain numeric
   id: it is the one check that reliably keeps a placeholder out of the UI. The
   app's own offline stub players use ids like 'p-11', and those must fall back
   to initials rather than quietly rendering a stranger's silhouette.
--------------------------------------------------------------------------- */

const CLOUDINARY = 'https://img.mlbstatic.com/mlb-photos/image/upload';
const MIDFIELD = 'https://midfield.mlbstatic.com/v1/people';

/** MLBAM person ids are always digits. Stub and synthetic ids are not. */
export function isMlbPlayerId(playerId) {
  return typeof playerId === 'string' || typeof playerId === 'number'
    ? /^\d+$/.test(String(playerId).trim())
    : false;
}

/**
 * URL for one player's headshot, or null when the id cannot address one.
 *
 * @param {string|number} playerId  MLBAM person id
 * @param {object} [options]
 * @param {'cutout'|'spot'} [options.variant='cutout']
 * @param {number} [options.width=240]  requested pixel width
 */
export function mlbHeadshotUrl(playerId, { variant = 'cutout', width = 240 } = {}) {
  if (!isMlbPlayerId(playerId)) return null;
  const id = String(playerId).trim();

  if (variant === 'spot') {
    // Round crop, served at a handful of fixed sizes; 120 and 240 both exist.
    return `${MIDFIELD}/${id}/spots/${width > 120 ? 240 : 120}`;
  }

  // `d_...` is the on-the-fly default the CDN substitutes when a player has no
  // photo on file — that is the generic silhouette described above.
  return (
    `${CLOUDINARY}/d_people:generic:headshot:silo:current.png` +
    `/w_${Math.round(width)},q_auto:best/v1/people/${id}/headshot/silo/current`
  );
}

/**
 * `srcSet` for the same headshot at 2x, so the card stays sharp on retina.
 *
 * Returns undefined when both densities resolve to the same file. The spot
 * variant only exists at two fixed sizes, so a 40px avatar asks for the 120
 * twice over — a srcSet whose entries are identical is noise in the markup and
 * tells the browser nothing it did not already know from `src`.
 */
export function mlbHeadshotSrcSet(playerId, options = {}) {
  const width = options.width ?? 240;
  const one = mlbHeadshotUrl(playerId, { ...options, width });
  const two = mlbHeadshotUrl(playerId, { ...options, width: width * 2 });
  if (!one || !two || one === two) return undefined;
  return `${one} 1x, ${two} 2x`;
}

/** 'Rafael Devers' → 'RD'. The fallback when there is no usable id. */
export function initialsFor(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
