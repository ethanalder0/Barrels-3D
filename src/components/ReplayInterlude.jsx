import TeamLogo from './TeamLogo.jsx';
import { IconFullscreen } from './Icons.jsx';

/* ---------------------------------------------------------------------------
   INTERLUDE — the screen over the replay when there is nothing to play.
   ---------------------------------------------------------------------------
   Chosen by replay/interlude.js:

     pregame  no pitch yet. The two clubs and their records, and when the
              first pitch is due — or that they are warming up, or that the
              start is delayed.
     break    between half innings. The score, "Middle of the 5th", and what
              it is waiting for.
     final    the game is over. The final score, the winner lit, and the line
              of runs, hits and errors.
     off      postponed or cancelled. The clubs, and nothing that looks like
              a result.

   The waiting ones have a spinning ball so they read as a live wait, not a
   frozen picture — two minutes of a still zone looked hung.

   The HUD is not drawn under it; this replaces it. The full-screen button
   stays, so full screen can still be left with the mouse. The 3D scene keeps
   running behind the dimmed glass: the next batter walks up and the pitcher
   breathes, which is its own small proof that nothing has stalled.
--------------------------------------------------------------------------- */

export default function ReplayInterlude({ interlude, game, lineScore, fullscreen, onToggleFullscreen }) {
  const final = interlude.kind === 'final';
  const waiting = interlude.kind === 'break' || interlude.kind === 'pregame';
  // Before a ball is thrown, or when none will be, there is no score to show.
  const noScore = interlude.kind === 'pregame' || interlude.kind === 'off';
  const away = game?.away;
  const home = game?.home;
  const winner = final && away && home && away.runs !== home.runs
    ? (away.runs > home.runs ? 'away' : 'home')
    : null;

  return (
    <div className="interlude" data-kind={interlude.kind} role="status" aria-live="polite">
      <button
        type="button"
        className="hud__btn interlude__fs"
        onClick={onToggleFullscreen}
        aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
        title={fullscreen ? 'Exit full screen (F)' : 'Full screen (F)'}
      >
        <IconFullscreen exit={fullscreen} />
      </button>

      <div className="interlude__card" key={interlude.key}>
        <p className="interlude__eyebrow">{interlude.eyebrow ?? interlude.label}</p>

        {away && home && (
          <div className="interlude__score">
            <Side team={away} dim={winner === 'home'} record={noScore} />
            <span className="interlude__dash" aria-hidden="true">
              {noScore ? '@' : '–'}
            </span>
            <Side team={home} dim={winner === 'away'} record={noScore} alignEnd />
          </div>
        )}

        {final && lineScore?.totals && <Totals lineScore={lineScore} away={away} home={home} />}
        {waiting && (
          <p className="interlude__wait">
            <SpinningBall />
            <span>{interlude.label}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function Side({ team, dim, record, alignEnd }) {
  return (
    <div className="interlude__side" data-dim={!!dim} data-end={!!alignEnd} data-record={!!record}>
      <TeamLogo abbr={team.abbr} size={56} className="interlude__logo" surface="dark" />
      <span className="interlude__abbr">{record ? team.name ?? team.abbr : team.abbr}</span>
      {record ? (
        /* A 0-0 record says nothing — it is what the postseason resets every
           club to — so it is left off rather than printed. */
        <span className="interlude__record u-num">
          {team.record && team.record !== '0-0' ? team.record : ' '}
        </span>
      ) : (
        <span className="interlude__runs u-num">{team.runs ?? 0}</span>
      )}
    </div>
  );
}

/* R H E, the way a final line score reads. */
function Totals({ lineScore, away, home }) {
  const t = lineScore.totals;
  return (
    <table className="interlude__rhe">
      <thead>
        <tr>
          <th scope="col"><span className="u-visually-hidden">Team</span></th>
          <th scope="col">R</th>
          <th scope="col">H</th>
          <th scope="col">E</th>
        </tr>
      </thead>
      <tbody>
        {[['away', away], ['home', home]].map(([side, team]) => (
          <tr key={side}>
            <th scope="row">{team?.abbr}</th>
            <td className="u-num">{t[side]?.r ?? 0}</td>
            <td className="u-num">{t[side]?.h ?? 0}</td>
            <td className="u-num">{t[side]?.e ?? 0}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* A ball turning over, seams and all: the "still here" signal. */
function SpinningBall() {
  return (
    <svg className="interlude__ball" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" fill="#f5f1e6" />
      <path d="M6.2 4.4c2.4 2.3 2.4 12.9 0 15.2" fill="none" stroke="#c4222a" strokeWidth="1.2" strokeDasharray="1.4 1.1" />
      <path d="M17.8 4.4c-2.4 2.3-2.4 12.9 0 15.2" fill="none" stroke="#c4222a" strokeWidth="1.2" strokeDasharray="1.4 1.1" />
    </svg>
  );
}
