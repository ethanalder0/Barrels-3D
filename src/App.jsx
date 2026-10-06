import { useEffect } from 'react';
import { useAppState } from './state/AppState.jsx';
import SplashScreen from './screens/SplashScreen.jsx';
import HomeScreen from './screens/HomeScreen.jsx';
import LiveGameScreen from './screens/LiveGameScreen.jsx';
import GameListScreen from './screens/GameListScreen.jsx';
import LeaderboardScreen from './screens/LeaderboardScreen.jsx';
import SettingsScreen from './screens/SettingsScreen.jsx';
import AppHeader from './components/AppHeader.jsx';
import PlayerCard from './components/PlayerCard.jsx';
import './styles/app.css';

const SCREENS = {
  home: HomeScreen,
  live: LiveGameScreen,
  games: GameListScreen,
  leaderboard: LeaderboardScreen,
  settings: SettingsScreen,
};

export default function App() {
  const { state } = useAppState();

  // Settings → Reduce motion → Always is enforced in CSS off this attribute
  // (base.css). 'system' leaves the OS media query in charge on its own.
  useEffect(() => {
    document.documentElement.dataset.reduceMotion = state.settings.reduceMotion;
  }, [state.settings.reduceMotion]);

  // Dark mode is one attribute on <html>; tokens.css redefines the whole
  // palette under :root[data-theme='dark'] and every component follows, since
  // none of them name a colour directly.
  //
  // Deliberately NOT tied to prefers-color-scheme: the setting ships off, and
  // a media query would silently override that for anyone on a dark OS.
  useEffect(() => {
    const root = document.documentElement;
    const dark = state.settings.theme === 'dark';

    // Transitions have to be off for the frame the palette swaps on. Chrome
    // freezes a transitioned property whose value comes from a custom property
    // when that custom property changes underneath it: the variable updates,
    // but the RENDERED colour stays on the old theme until something forces a
    // fresh style. Nav pills and buttons would keep their cream backgrounds on
    // a dark page. (Same root cause as the scorebug's team wash — see the note
    // on `.scoreteam` in app.css.)
    root.classList.add('theme-switching');

    if (dark) {
      root.dataset.theme = 'dark';
    } else {
      delete root.dataset.theme;
    }
    // Keep the browser's own UI (form controls, scrollbars) in step.
    root.style.colorScheme = dark ? 'dark' : 'light';

    // Two frames: one for the new values to be applied, one before animation
    // is allowed again.
    let inner;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => root.classList.remove('theme-switching'));
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner) cancelAnimationFrame(inner);
      root.classList.remove('theme-switching');
    };
  }, [state.settings.theme]);

  if (!state.entered) return <SplashScreen />;

  const Screen = SCREENS[state.screen] ?? LiveGameScreen;

  return (
    <div className="shell">
      <AppHeader />
      <main className="shell__body">
        <Screen />
      </main>
      {/* The README's disclaimer, where visitors will actually see it. */}
      <footer className="shell__foot">
        <p>
          Barrels 3D is an independent fan project, not affiliated with or endorsed by Major League
          Baseball or any club. Team names and logos belong to their owners. Game data © MLB Advanced
          Media, used for non-commercial purposes.
        </p>
      </footer>
      <PlayerCard />
    </div>
  );
}
