import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { atBats, defaultGameId } from '../data/stubs.js';
import { readReplayOptions } from '../data/liveClient.js';
import { readFavorites, toggleFavorite, writeFavorites } from '../data/favorites.js';

/* ---------------------------------------------------------------------------
   One store for everything that crosses a screen boundary: which screen is up,
   whether we're signed in, the selected game / at-bat / player, and settings.

   The replay engine only ever needs to read `selectedAtBatId` (and the at-bat
   object it resolves to). ReplayViewport re-broadcasts that as a DOM event so
   the engine never has to import React.
--------------------------------------------------------------------------- */

const initialState = {
  screen: 'home', // 'home' | 'live' | 'games' | 'settings' | 'leaderboard'
  authed: false,
  user: null,
  selectedGameId: defaultGameId,
  selectedAtBatId: atBats[0].id,
  /* Which day's scoreboard the games screen is showing. null means today, so
     the common case needs no date in state and the app opens on today without
     having to know what today is. Seeded from ?date= so the URL still works. */
  scoreboardDate: readReplayOptions().date,
  // While true the newest at-bat is selected automatically as the game moves on.
  // Picking one by hand turns it off; the at-bat panel offers it back.
  followLatest: true,
  playerCardId: null, // non-null → player modal is open
  // Which leaderboard the full-page view is showing, as { groupId, categoryId }.
  // Set by expanding one of the home page's top-five boards.
  leaderboard: null,
  /* Favourite clubs, as feed abbreviations, most recently picked last. Seeded
     from localStorage so the app opens already following them — the only state
     here that outlives the tab. See data/favorites.js. */
  favorites: readFavorites(),
  settings: {
    units: 'imperial', // 'imperial' | 'metric'
    replayQuality: 'high', // 'low' | 'medium' | 'high'
    replayCamera: 'catcher', // 'catcher' (behind the plate) | 'centerfield' (broadcast)
    replayZoom: 1, // the chosen shot: 0.6 (wide) to 2 (tight), 1 is stock
    nightGames: 'auto', // 'auto' (as MLB schedules the game) | 'day' | 'night'
    sound: true, // contact sounds; no longer a setting, always on
    reduceMotion: 'system', // 'system' | 'always'
    theme: 'light', // 'light' | 'dark' — ships off, see App.jsx
    showAdvancedMetrics: true,
  },
};

function reducer(state, action) {
  switch (action.type) {
    case 'signin':
      // Land on Home, not on whichever game happens to be next. The home
      // screen introduces the app and shows league-wide context; picking a
      // game is a deliberate step from there.
      return { ...state, authed: true, user: action.user, screen: 'home' };
    case 'signout':
      // Settings are display preferences, not session data. Resetting them
      // here would drop the user's theme on sign-out and flash the splash back
      // to light. Favourite clubs are the same kind of thing, and they are
      // stored per browser rather than per account, so they stay too.
      return { ...initialState, settings: state.settings, favorites: state.favorites };
    /* Opening the game screen always follows the live game. A play picked by
       hand on an earlier visit is not what someone coming back to the game
       wants to see; what is happening now is. */
    case 'navigate':
      return {
        ...state,
        screen: action.screen,
        followLatest: action.screen === 'live' ? true : state.followLatest,
      };
    case 'selectGame':
      return { ...state, selectedGameId: action.gameId, followLatest: true, screen: 'live' };
    // Same, minus the navigation: used when live data replaces the stub ids and
    // we need to point at a real gamePk without yanking the user to another screen.
    case 'hydrateGame':
      return { ...state, selectedGameId: action.gameId, followLatest: true };
    /* Changing the day also drops the selected game: it belongs to the old
       date, and leaving it selected would leave the scorebug showing one game
       while the list shows another day's. */
    case 'setScoreboardDate':
      return { ...state, scoreboardDate: action.date, selectedGameId: null };
    case 'selectAtBat':
      return { ...state, selectedAtBatId: action.atBatId, followLatest: !!action.auto };
    case 'setFollowLatest':
      return { ...state, followLatest: action.value };
    case 'openLeaderboard':
      return {
        ...state,
        screen: 'leaderboard',
        leaderboard: { groupId: action.groupId, categoryId: action.categoryId },
      };
    case 'openPlayer':
      return { ...state, playerCardId: action.playerId };
    case 'closePlayer':
      return { ...state, playerCardId: null };
    case 'setSetting':
      return { ...state, settings: { ...state.settings, [action.key]: action.value } };
    case 'toggleFavorite':
      return { ...state, favorites: toggleFavorite(state.favorites, action.abbr) };
    case 'clearFavorites':
      return { ...state, favorites: [] };
    default:
      return state;
  }
}

const AppStateContext = createContext(null);

export function AppStateProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  /* Persisted here rather than in the reducer, which has to stay pure — and in
     one effect rather than in each action, so no future way of changing the
     list can forget to save it. */
  useEffect(() => {
    writeFavorites(state.favorites);
  }, [state.favorites]);

  const value = useMemo(() => {
    const actions = {
      signIn: (user) => dispatch({ type: 'signin', user }),
      signOut: () => dispatch({ type: 'signout' }),
      navigate: (screen) => dispatch({ type: 'navigate', screen }),
      selectGame: (gameId) => dispatch({ type: 'selectGame', gameId }),
      setScoreboardDate: (date) => dispatch({ type: 'setScoreboardDate', date }),
      hydrateGame: (gameId) => dispatch({ type: 'hydrateGame', gameId }),
      selectAtBat: (atBatId, { auto = false } = {}) =>
        dispatch({ type: 'selectAtBat', atBatId, auto }),
      setFollowLatest: (value) => dispatch({ type: 'setFollowLatest', value }),
      openLeaderboard: (groupId, categoryId) =>
        dispatch({ type: 'openLeaderboard', groupId, categoryId }),
      openPlayer: (playerId) => dispatch({ type: 'openPlayer', playerId }),
      closePlayer: () => dispatch({ type: 'closePlayer' }),
      setSetting: (key, value) => dispatch({ type: 'setSetting', key, value }),
      toggleFavorite: (abbr) => dispatch({ type: 'toggleFavorite', abbr }),
      clearFavorites: () => dispatch({ type: 'clearFavorites' }),
    };
    return { state, actions };
  }, [state]);

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error('useAppState must be used inside <AppStateProvider>');
  return ctx;
}
