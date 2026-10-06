import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { connectionLabel } from '../state/connectionLabel.js';
import { Baseball } from './Icons.jsx';
import GameMenu from './GameMenu.jsx';

const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'live', label: 'Live' },
  { id: 'games', label: 'Games' },
  { id: 'settings', label: 'Settings' },
];

// Screens reached from another screen rather than from the nav. They keep
// their parent's pill lit, so the header still says where you are instead of
// going blank on a page that has no tab of its own.
const NAV_PARENT = { leaderboard: 'home' };

export default function AppHeader() {
  const { state, actions } = useAppState();
  const { mode, connection, replay } = useLiveData();
  const status = connectionLabel({ mode, connection, replay });
  const currentNav = NAV_PARENT[state.screen] ?? state.screen;

  return (
    <header className="appbar">
      <div className="appbar__inner">
        <div className="appbar__brand">
          <Baseball size={22} />
          <span>
            Barrels <span className="dim">3D</span>
          </span>
        </div>

        <nav className="appbar__nav" aria-label="Primary">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className="navlink"
              aria-current={currentNav === item.id ? 'page' : undefined}
              onClick={() => actions.navigate(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="appbar__spacer" />

        {/* Feed state, not game state — this is the answer to "is it actually
            streaming?", which matters as soon as there is a backend. */}
        <span className={`chip chip--${status.tone === 'live' ? 'live chip--dot' : status.tone}`}>
          {status.text}
        </span>

        <GameMenu />
      </div>
    </header>
  );
}
