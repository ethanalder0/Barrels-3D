import { useEffect, useRef, useState } from 'react';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import TeamLogo from './TeamLogo.jsx';
import { IconCamera, IconFullscreen } from './Icons.jsx';

/* ---------------------------------------------------------------------------
   REPLAY HUD — the broadcast furniture drawn over the 3D stage.
   ---------------------------------------------------------------------------
   Two kinds of information, kept apart on purpose:

     · the GAME as it stands now — score, inning, count, outs, who is up, who
       is pitching, who is on deck. Top-left bug and bottom-left strip.
     · the PLAY being replayed — the pitch and, if it was hit, the batted ball.
       Bottom-right card, naming its own batter, because the play on screen is
       not always the current one (the at-bat just ended, or you picked an old
       one from the list).

   The play card does not give the result away. The engine reports what the
   ball has actually done so far (`moment`: crossed the plate, made contact,
   landed) and each line waits for its moment. With no engine attached there
   is nothing to wait for, so everything shows.

   Nor does the rest of the HUD. ReplayViewport decides what both halves show:
   `atBat` is the play the ENGINE is showing (not the newest in the feed, which
   can be ahead of the picture), and `view` is the game — score, inning, count,
   outs, runners, matchup — as it stood at that point in the picture. While
   following live that is held back until each play reaches its result on
   screen, so a run is on the board when it crosses, not when the feed hears
   about it. `waiting` is who is up when nothing has been shown yet.

   The HUD sits in the stage, never in #replay-viewport — that node belongs to
   the engine. It is pointer-transparent except for its buttons, so the camera
   can still be orbited through it.
--------------------------------------------------------------------------- */

export default function ReplayHud({
  atBat,
  waiting,
  view,
  tag,
  moment,
  units,
  fullscreen,
  onToggleFullscreen,
  camera,
  onCycleCamera,
}) {
  const live = useLiveData();
  const mode = CAMERA_MODES[camera?.mode] ?? null;
  const { game, bases, matchup } = view ?? live;
  const card = atBat ?? waiting;

  return (
    <div className="hud" data-fullscreen={fullscreen}>
      <div className="hud__top">
        {game && <Bug game={game} bases={bases} />}
        <div className="hud__tools">
          {tag && <span className="hud__tag">{tag}</span>}
          {camera?.mode === 'free' && (
            <span className="hud__tag hud__tag--camera">
              Free roam{camera.tracking ? ' · Tracking ball' : ''}
            </span>
          )}
          {mode && (
            <button
              type="button"
              className="hud__btn"
              onClick={onCycleCamera}
              aria-label={`Camera: ${mode.label}. Switch camera`}
              title={`Camera: ${mode.label} — switch (L)`}
            >
              <IconCamera />
            </button>
          )}
          <button
            type="button"
            className="hud__btn"
            onClick={onToggleFullscreen}
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            title={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}
          >
            <IconFullscreen exit={fullscreen} />
          </button>
        </div>
      </div>

      <div className="hud__bottom">
        <Matchup matchup={game?.status === 'final' ? null : matchup} atBat={card} />
        {atBat ? (
          <PlayCard atBat={atBat} moment={moment} units={units} />
        ) : waiting ? (
          <Waiting atBat={waiting} />
        ) : null}
      </div>
    </div>
  );
}

/* --- Camera mode ---------------------------------------------------------
   L (or the camera button) cycles home plate -> broadcast -> free roam. Each
   change says where it landed for a moment; entering free roam also says how
   to drive it, since none of those keys do anything anywhere else. The first
   report, when the replay comes up, is not a change and shows nothing.

   ReplayViewport draws the toast in a layer of its own, above the HUD and the
   between-innings card alike, so it outlives either being swapped out. */
const CAMERA_MODES = {
  catcher: { label: 'Home plate' },
  centerfield: { label: 'Broadcast' },
  free: {
    label: 'Free roam',
    keys: [
      ['WASD / ←↑↓→', 'move'],
      ['Drag', 'look'],
      ['Space / ⇧ Space', 'up / down'],
      ['Scroll', 'zoom'],
      ['B', 'track the ball'],
      ['L', 'next camera'],
    ],
  },
};

export function CameraToast({ camera }) {
  const [toast, setToast] = useState(null);
  const prev = useRef(null);

  useEffect(() => {
    if (!camera) return undefined;
    const before = prev.current;
    prev.current = camera;
    if (!before) return undefined;
    let next = null;
    if (before.mode !== camera.mode) {
      next = { ...CAMERA_MODES[camera.mode], key: `${camera.mode}` };
    } else if (before.tracking !== camera.tracking) {
      next = { label: camera.tracking ? 'Tracking the ball' : 'Tracking off', key: `t${camera.tracking}` };
    }
    if (next) setToast(next);
    return undefined;
  }, [camera]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), toast.keys ? 5000 : 1600);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;
  return (
    <div className="hud__toast" role="status" key={toast.key}>
      <p className="hud__toast-title">{toast.label}</p>
      {toast.keys && (
        <dl className="hud__toast-keys">
          {toast.keys.map(([k, what]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/* --- Score bug ----------------------------------------------------------- */

function Bug({ game, bases }) {
  const st = game.state;
  const final = game.status === 'final';
  const homeBatting = st?.half === 'bottom';

  return (
    <div className="hud__bug hud__panel">
      <div className="hud__teams">
        {['away', 'home'].map((side) => (
          <div
            key={side}
            className="hud__team"
            data-batting={!final && !!st && (side === 'home') === homeBatting}
          >
            <TeamLogo abbr={game[side].abbr} size={18} className="hud__logo" surface="dark" />
            <span className="hud__abbr">{game[side].abbr}</span>
            <span className="hud__runs u-num">{game[side].runs ?? '–'}</span>
          </div>
        ))}
      </div>

      <div className="hud__state">
        {final || !st ? (
          <span className="hud__inning">{final ? 'Final' : game.startsAt || '—'}</span>
        ) : (
          <>
            <span className="hud__inning u-num">
              <span aria-hidden="true">{st.half === 'top' ? '▲' : '▼'}</span>
              <span className="u-visually-hidden">{st.half === 'top' ? 'Top' : 'Bottom'}</span>
              {st.inning}
            </span>
            <MiniDiamond bases={bases} />
            <span className="hud__count u-num" aria-label={`${st.balls} balls, ${st.strikes} strikes`}>
              {st.balls}-{st.strikes}
            </span>
            <span className="hud__outs" role="img" aria-label={`${st.outs} out`}>
              {[0, 1, 2].map((i) => (
                <span key={i} className="hud__out" data-on={i < (st.outs ?? 0)} />
              ))}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function MiniDiamond({ bases }) {
  const on = (b) => Boolean(bases?.[b]);
  return (
    <svg className="hud__diamond" viewBox="0 0 30 22" role="img" aria-label={runnersLabel(bases)}>
      {/* A rotated 8-square reaches 5.66 from its centre, 6.4 with the stroke,
          so every centre sits at least that far inside the viewBox. */}
      <rect x="11" y="3" width="8" height="8" transform="rotate(45 15 7)" data-on={on('second')} />
      <rect x="3" y="11" width="8" height="8" transform="rotate(45 7 15)" data-on={on('third')} />
      <rect x="19" y="11" width="8" height="8" transform="rotate(45 23 15)" data-on={on('first')} />
    </svg>
  );
}

function runnersLabel(bases) {
  const on = ['first', 'second', 'third'].filter((b) => bases?.[b]);
  return on.length ? `Runners on ${on.join(', ')}` : 'Bases empty';
}

/* --- Matchup strip ------------------------------------------------------- */

function Matchup({ matchup, atBat }) {
  // The feed's current matchup, falling back to the replayed at-bat when the
  // game has none (demo data, or a game that is over — the feed keeps naming
  // a "next batter" after the final out).
  const batter = matchup?.batter ?? atBat?.batter;
  const pitcher = matchup?.pitcher ?? atBat?.pitcher;
  const onDeck = matchup?.onDeck;
  if (!batter && !pitcher) return <span />;

  // Handedness is only on the at-bat, so only trust it for the same players.
  const bats = atBat && atBat.batter === batter ? atBat.batSide : null;
  const throws = atBat && atBat.pitcher === pitcher ? atBat.pitchHand : null;

  return (
    <dl className="hud__matchup hud__panel">
      {batter && <Row label="At bat" name={batter} hand={bats} strong />}
      {pitcher && <Row label="Pitching" name={pitcher} hand={throws} />}
      {onDeck && <Row label="On deck" name={onDeck} />}
    </dl>
  );
}

function Row({ label, name, hand, strong }) {
  return (
    <div className="hud__row" data-strong={!!strong}>
      <dt>{label}</dt>
      <dd>
        <span className="hud__name">{name}</span>
        {hand && <span className="hud__hand">{hand}</span>}
      </dd>
    </div>
  );
}

/* --- Play card ----------------------------------------------------------- */

/* Following live, before anything new has happened: the viewer opened on the
   at-bat in progress and shows nothing that came before it. */
function Waiting({ atBat }) {
  const over = atBat.kind && atBat.kind !== 'live';
  return (
    <div className="hud__play hud__panel" aria-live="polite">
      <div className="hud__playhead">
        <span className="hud__who">{over ? 'Next batter' : atBat.batter}</span>
      </div>
      <span className="hud__incoming">
        <span className="hud__eyebrow">Waiting for the next pitch</span>
        <span className="hud__pulse" aria-hidden="true" />
      </span>
    </div>
  );
}

function PlayCard({ atBat, moment, units }) {
  const pitch = finalPitch(atBat);
  const metric = units === 'metric';
  const speed = (v) => (v == null ? null : metric ? (v * 1.60934).toFixed(1) : Number(v).toFixed(1));
  const speedUnit = metric ? 'km/h' : 'mph';

  const reveal = moment ?? { pitch: true, contact: true, landed: true, awaiting: false };
  /* Batted-ball numbers belong to the pitch that was put in play and to no
     other. Mid at-bat the at-bat's hit data is the latest event that carried
     any — often an earlier foul — which printed an exit velocity over a called
     strike. The stub shape says nothing about the pitch and keeps showing it. */
  const inPlay = pitch?.isInPlay === true || pitch?.outcome === 'inplay';
  const hasHit =
    (inPlay || pitch?.outcome == null) &&
    (atBat.exitVelo != null || atBat.launchAngle != null || atBat.distance != null);
  const complete = atBat.kind !== 'live' && atBat.result && atBat.result !== '—';
  const distance = atBat.distance == null ? null : metric ? Math.round(atBat.distance * 0.3048) : atBat.distance;
  const trajectory = atBat.hit?.trajectory?.replace('_', ' ');

  /* Nothing is shown while the engine is holding for a ball in play's
     detail: not the pitch, not the exit velocity. All of it arrives with the
     play, the same as the picture does. */
  const pitchUp = reveal.pitch && !reveal.awaiting;
  const contactUp = hasHit && reveal.contact && !reveal.awaiting;
  const landedUp = reveal.landed && !reveal.awaiting;
  /* The umpire's call on a ball in play is the result in disguise — "In play,
     run(s)" — so until it lands it only says the ball was put in play. */
  const call = inPlay && !landedUp ? 'In play' : pitch?.call;

  return (
    <div className="hud__play hud__panel" aria-live="polite">
      <div className="hud__playhead">
        <span className="hud__who">{atBat.batter}</span>
        {complete && landedUp ? (
          <span className="hud__result" data-kind={atBat.kind}>{atBat.result}</span>
        ) : reveal.awaiting ? (
          <span className="hud__result hud__result--pending">Tracking…</span>
        ) : null}
      </div>

      {!pitch || pitch.type === '—' ? (
        <span className="hud__sub hud__sub--muted">Waiting for the first pitch</span>
      ) : !pitchUp ? (
        <span className="hud__incoming">
          <span className="hud__eyebrow">
            {pitch.number != null ? `Pitch ${pitch.number}` : 'Pitch'}
          </span>
          <span className="hud__pulse" aria-hidden="true" />
        </span>
      ) : (
        <div className="hud__pitch">
          <span className="hud__eyebrow">
            {pitch.number != null ? `Pitch ${pitch.number}` : 'Pitch'}
          </span>
          <span className="hud__big u-num">
            {speed(pitch.velo) ?? '—'}
            <small>{speedUnit}</small>
          </span>
          <span className="hud__sub">
            {[pitch.type, call, pitch.zone].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}

      {hasHit && contactUp && (
        <div className="hud__hit">
          <Stat label="Exit velo" value={speed(atBat.exitVelo)} unit={speedUnit} />
          <Stat label="Launch" value={atBat.launchAngle} unit="°" />
          <Stat
            label="Distance"
            value={landedUp ? distance : null}
            unit={metric ? 'm' : 'ft'}
            pending={contactUp && !landedUp}
          />
          {trajectory && landedUp && <span className="hud__traj">{trajectory}</span>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, unit, pending }) {
  return (
    <span className="hud__stat">
      <span className="hud__eyebrow">{label}</span>
      <span className="hud__statval u-num">
        {value ?? (pending ? '…' : '—')}
        {value != null && <small>{unit}</small>}
      </span>
    </span>
  );
}

function finalPitch(atBat) {
  const list = Array.isArray(atBat?.pitches) ? atBat.pitches : null;
  return list?.length ? list[list.length - 1] : (atBat?.pitch ?? null);
}

