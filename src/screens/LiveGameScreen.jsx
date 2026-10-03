import { useCallback, useMemo } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import Scorebug from '../components/Scorebug.jsx';
import ReplayViewport, { forReplay } from '../components/ReplayViewport.jsx';
import BoxScore from '../components/BoxScore.jsx';
import ActionReplay from '../components/ActionReplay.jsx';
import GameLeaders from '../components/GameLeaders.jsx';
import { isGameOver } from '../replay/interlude.js';

/**
 * The main screen, one full-width column: scorebug, replay viewport, and below
 * them the play picker and game leaders beside the box score. The viewport
 * keeps its own fixed aspect ratio, so mounting the engine cannot reflow
 * anything.
 */
export default function LiveGameScreen() {
  const { state, actions } = useAppState();
  const { atBats, ready, mode, error, game, players } = useLiveData();
  const selected = atBats.find((a) => a.id === state.selectedAtBatId) ?? atBats[0] ?? null;

  // Dressed for the replay: both clubs, and the numbers on both backs.
  const atBat = useMemo(() => forReplay(selected, game, players), [selected, game, players]);

  /* Highlights pick each next play themselves. After the newest one, a game
     still going goes back to following live; a finished one stays on its
     last play. */
  const { selectAtBat, setFollowLatest, stopHighlights } = actions;
  const gameOn = game?.status === 'live' && !isGameOver(game);
  const onHighlightNext = useCallback(
    (id) => {
      if (id) selectAtBat(id, { highlight: true });
      else if (gameOn) setFollowLatest(true);
      else stopHighlights();
    },
    [selectAtBat, setFollowLatest, stopHighlights, gameOn],
  );

  const nightSetting = state.settings.nightGames;
  const night = nightSetting === 'night' || (nightSetting === 'auto' && isNightGame(game));

  return (
    <div className="live">
      {mode === 'demo' && (
        <p className="notice">
          Showing placeholder data — the live backend isn't reachable
          {error ? ` (${error})` : ''}. Run <code>python server/app.py</code> for real games.
        </p>
      )}
      {!ready && mode !== 'demo' && <p className="notice">Connecting to the live feed…</p>}

      <Scorebug />
      <ReplayViewport
        atBat={atBat}
        quality={state.settings.replayQuality}
        camera={state.settings.replayCamera}
        zoom={state.settings.replayZoom}
        night={night}
        units={state.settings.units}
        sound={state.settings.sound}
        venue={game?.venue}
        homeTeam={game?.home?.abbr}
        followLatest={state.followLatest}
        onFollowLatest={() => actions.setFollowLatest(true)}
        highlights={state.highlights}
        onHighlightNext={onHighlightNext}
      />

      <div className="live__lower">
        <div className="live__side">
          <ActionReplay />
          <GameLeaders />
        </div>
        <BoxScore />
      </div>
    </div>
  );
}

/**
 * Is this a night game? MLB says so on every game ("day" | "night"). Without
 * that — demo data, or an older backend — go by the scheduled start in the
 * viewer's own clock: from five o'clock on, the lights are on.
 */
function isNightGame(game) {
  if (game?.dayNight) return game.dayNight === 'night';
  const start = game?.startsAtISO ? new Date(game.startsAtISO) : null;
  return !!start && !Number.isNaN(start.getTime()) && start.getHours() >= 17;
}
