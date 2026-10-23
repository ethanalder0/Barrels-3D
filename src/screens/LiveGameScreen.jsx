import { useCallback, useMemo } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import Scorebug from '../components/Scorebug.jsx';
import ReplayViewport, { forReplay } from '../components/ReplayViewport.jsx';
// Parked with the strip below while it is decided whether to keep it.
// import BattedBallStrip from '../components/BattedBallStrip.jsx';
import BoxScore from '../components/BoxScore.jsx';
import ActionReplay from '../components/ActionReplay.jsx';
import GameLeaders from '../components/GameLeaders.jsx';
import TeamCompare from '../components/TeamCompare.jsx';
import { isGameOver } from '../replay/interlude.js';
import { atBatAtPitch } from '../replay/follow.js';

/**
 * The main screen: the score band across the top, then two columns. The replay
 * and the box score on the left; the play picker, the game leaders and the
 * team comparison in a rail on the right. The viewport keeps its own fixed
 * aspect ratio, so mounting the engine cannot reflow anything.
 */
export default function LiveGameScreen() {
  const { state, actions } = useAppState();
  const { atBats, ready, mode, error, game, players } = useLiveData();
  const selected = atBats.find((a) => a.id === state.selectedAtBatId) ?? atBats[0] ?? null;

  /* One pitch of it, when a game leader picked one (its fastest pitch, its
     hardest swing): the at-bat cut off at that pitch, under its own id so the
     replay treats it as a play of its own rather than the at-bat again. */
  const shown = useMemo(() => {
    const n = state.selectedPitch;
    const pitches = selected?.pitches ?? [];
    const index = n == null ? -1 : pitches.findIndex((p) => p.number === n);
    if (index < 0 || index === pitches.length - 1) return selected;
    return { ...atBatAtPitch(selected, index), id: `${selected.id}#${n}` };
  }, [selected, state.selectedPitch]);

  // Dressed for the replay: both clubs, and the numbers on both backs.
  const atBat = useMemo(() => forReplay(shown, game, players), [shown, game, players]);

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

      <div className="live__body">
        <div className="live__main">
          {/* The numbers sit flush under the stage, so the two read as one. */}
          <div>
            <ReplayViewport
              atBat={atBat}
              quality={state.settings.replayQuality}
              camera={state.settings.replayCamera}
              zoom={state.settings.replayZoom}
              night={night}
              trail={state.settings.showBallTrail}
              zone={state.settings.showStrikeZone}
              units={state.settings.units}
              sound={state.settings.sound}
              venue={game?.venue}
              homeTeam={game?.home?.abbr}
              followLatest={state.followLatest}
              onFollowLatest={() => actions.setFollowLatest(true)}
              highlights={state.highlights}
              onHighlightNext={onHighlightNext}
            />
            {/* Batted-ball strip (exit velo, launch angle, distance, barrel).
                Commented out, not deleted: the HUD already shows the same
                numbers, so it reads as redundant, but it may come back. To
                restore it, uncomment this and the import above.
            {state.settings.showAdvancedMetrics && (
              <BattedBallStrip atBat={selected} metric={state.settings.units === 'metric'} />
            )}
            */}
          </div>
          <BoxScore />
        </div>

        <div className="live__side">
          <ActionReplay />
          <GameLeaders />
          <TeamCompare />
        </div>
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
