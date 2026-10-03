import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { AppStateProvider } from './state/AppState.jsx';
import { LiveDataProvider } from './state/LiveDataProvider.jsx';
import './styles/tokens.css';
import './styles/fonts.css';
import './styles/base.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppStateProvider>
      <LiveDataProvider>
        <App />
      </LiveDataProvider>
    </AppStateProvider>
  </StrictMode>,
);

// The 3D replay engine. Loaded on its own chunk so Three.js never lands in the
// main bundle — the splash, home and leaderboard screens have no use for it.
// It watches for #replay-viewport itself and attaches when the live-game screen
// puts one on the page; see src/replay/index.js.
import('./replay/index.js').then(({ startReplayEngine }) => startReplayEngine());
