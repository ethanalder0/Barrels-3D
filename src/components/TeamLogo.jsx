import { useState } from 'react';
import { teamFor } from '../data/teamStyle.js';
import { useAppState } from '../state/AppState.jsx';

/**
 * Club mark for a team abbreviation.
 *
 * The marks are MLB's own SVGs, loaded from its CDN (see teams.js): the club
 * logo on a light ground, and the cap mark recoloured for dark — most club
 * marks are navy or black and vanish on the dark theme. `surface="dark"` is
 * for the places that are dark whatever the theme (the replay HUD and its
 * interludes sit over the 3D scene). `onInk` is for a mark sitting on an
 * ink-filled control (a chosen tab, a picked favourite): ink inverts with the
 * theme, so the mark does too.
 *
 * Falls back to a monogram in the team's colours when the mark cannot load —
 * offline, or an abbreviation the table doesn't cover.
 *
 * `alt` is empty on purpose: every place this is used already has the team
 * name or abbreviation as text next to it, so announcing it again is noise.
 */
export default function TeamLogo({ abbr, size = 22, className = '', surface, onInk = false }) {
  const { state } = useAppState();
  // Remembers which URL failed, so switching theme retries with the other mark.
  const [failedSrc, setFailedSrc] = useState(null);
  const team = teamFor(abbr);

  if (!team) return null;

  const theme = state.settings.theme === 'dark' ? 'dark' : 'light';
  const inverse = theme === 'dark' ? 'light' : 'dark';
  const dark = (surface ?? (onInk ? inverse : theme)) === 'dark';
  const src = dark ? team.logoDark : team.logo;
  const classes = `teamlogo ${className}`.trim();

  if (src && failedSrc !== src) {
    return (
      <img
        className={classes}
        src={src}
        width={size}
        height={size}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailedSrc(src)}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={`${classes} teamlogo--mono`}
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: team.primary,
        color: team.onPrimary,
        // Show the whole abbreviation, scaled to fit: truncating LAA to "LA"
        // makes it indistinguishable from the Dodgers.
        fontSize: Math.round(size * (team.abbr.length > 2 ? 0.32 : 0.42)),
      }}
    >
      {team.abbr}
    </span>
  );
}
