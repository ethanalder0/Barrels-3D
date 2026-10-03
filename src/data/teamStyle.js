import { teamFor } from './teams.js';

/* ---------------------------------------------------------------------------
   Team colours as CSS custom properties.

   The palette stays cream and tan; club colour arrives only as a thin accent
   bar, a tinted row, or a small mark. So what components get here is mostly
   *low-alpha* versions of the club colour — enough to identify the team at a
   glance without turning a panel into team livery.

   `ink` is pre-computed in the generator to clear 4.5:1 on the cream page,
   because several primaries (Orioles orange, Marlins red) do not.
--------------------------------------------------------------------------- */

function rgba(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Inline style object of team CSS variables, for spreading onto an element.
 * Returns {} for an unknown abbreviation so callers need no branching — the
 * stylesheet's own fallbacks then apply.
 */
export function teamVars(abbr) {
  const t = teamFor(abbr);
  if (!t) return {};
  return {
    '--team': t.primary,
    '--team-2': t.secondary,
    '--team-ink': t.ink,
    '--team-on': t.onPrimary,
    '--team-wash': rgba(t.primary, 0.06),
    '--team-tint': rgba(t.primary, 0.12),
    '--team-line': rgba(t.primary, 0.3),

    // Dark-theme counterparts. Emitted alongside rather than switched here,
    // because this runs in React and has no business knowing the theme — the
    // stylesheet picks which pair to read under [data-theme='dark'].
    //
    // `inkDark` is not decoration: 29 of 30 club primaries are navies, reds and
    // blacks chosen for light backgrounds and fail contrast on espresso. The
    // generator falls back to the club's secondary (Rays navy becomes their
    // light blue, Pirates black becomes their gold).
    '--team-ink-dark': t.inkDark ?? t.ink,
    // A 6% wash is invisible on a dark ground; it needs roughly triple.
    '--team-wash-dark': rgba(t.primary, 0.2),
    '--team-line-dark': rgba(t.primary, 0.45),
  };
}

export { teamFor };
