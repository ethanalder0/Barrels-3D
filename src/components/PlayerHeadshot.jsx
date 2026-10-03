import { useEffect, useState } from 'react';
import { initialsFor, mlbHeadshotSrcSet, mlbHeadshotUrl } from '../data/headshots.js';
import { teamVars } from '../data/teamStyle.js';

/**
 * A player's official MLB headshot, addressed by id.
 *
 * Reusable anywhere a player appears: the card uses the big cut-out, a table
 * row can use `variant="spot"` at 28px. The only required prop is `playerId`.
 *
 * Three states, all handled here so no caller has to:
 *   loading  a shimmer at the final size, so nothing reflows when the image
 *            lands
 *   ready    the photo
 *   fallback initials in the club's colours — used when the id cannot address
 *            a headshot at all (offline stub players) or when the request
 *            genuinely fails
 *
 * On why `onError` is not the whole story, see data/headshots.js: the CDN
 * answers 200 with a generic silhouette for an unknown id, so a missing player
 * is caught by the id check rather than by the error handler.
 */
export default function PlayerHeadshot({
  playerId,
  name,
  teamAbbr,
  size = 240,
  variant = 'cutout',
  className = '',
  // The big cut-out is the subject of whatever just opened, so it loads
  // eagerly: deferring it leaves a shimmer where the player should be. Small
  // spots are the opposite case — a lineup of them belongs off the critical
  // path — so they stay lazy.
  loading = variant === 'cutout' ? 'eager' : 'lazy',
}) {
  const src = mlbHeadshotUrl(playerId, { variant, width: size });
  const [status, setStatus] = useState(src ? 'loading' : 'fallback');

  // Opening a second card reuses this component; without the reset the new
  // player would inherit the previous one's 'ready' and never show its own
  // loading state (or worse, keep a stale failure).
  useEffect(() => {
    setStatus(src ? 'loading' : 'fallback');
  }, [src]);

  const classes = `headshot headshot--${variant} ${className}`.trim();
  const style = { width: size, height: size, ...teamVars(teamAbbr) };

  if (status === 'fallback') {
    return (
      <span className={`${classes} headshot--initials`} style={style} aria-hidden="true">
        {initialsFor(name)}
      </span>
    );
  }

  return (
    <span className={classes} style={style} data-status={status}>
      {status === 'loading' && (
        <span className="headshot__shimmer skeleton" aria-hidden="true" />
      )}
      <img
        src={src}
        srcSet={mlbHeadshotSrcSet(playerId, { variant, width: size })}
        width={size}
        height={size}
        /* The name is always rendered as text beside every use of this
           component, so announcing it again would only be noise. */
        alt=""
        loading={loading}
        fetchPriority={loading === 'eager' ? 'high' : 'auto'}
        decoding="async"
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('fallback')}
      />
    </span>
  );
}
