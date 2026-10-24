import { useAppState } from '../state/AppState.jsx';

/**
 * A player's name, as a control that opens their card.
 *
 * The single place the app turns a name into a card, so any surface that knows
 * a player id — box score, at-bat feed, scorebug matchup, leaderboards, and
 * whatever comes next — gets the same behaviour for one import.
 *
 * Without an id it degrades to plain text rather than rendering a button that
 * cannot do anything: the offline stub feed has names with no MLBAM id behind
 * them, and a dead link is worse than a label.
 *
 * `children` overrides the rendered text while keeping `name` for the
 * accessible label, which is how the at-bat rail shows just a surname.
 */
export default function PlayerName({
  playerId,
  name,
  children,
  className = '',
  title,
  ...rest
}) {
  const { actions } = useAppState();
  const label = children ?? name;

  if (!playerId) {
    return (
      <span className={className || undefined} {...rest}>
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`linkish playername ${className}`.trim()}
      onClick={() => actions.openPlayer(String(playerId))}
      aria-label={name ? `${name}, player card` : 'Player card'}
      title={title}
      {...rest}
    >
      {label}
    </button>
  );
}
