import CardEdges from './CardEdges.jsx';
import PlayerHeadshot from './PlayerHeadshot.jsx';
import { IconClose } from './Icons.jsx';

/* The four abilities each side of the ball is graded on, in reading order.
   Labels live here so the card and its tooltips cannot disagree about what a
   number means. */
const HITTER_ABILITIES = [
  ['contact', 'Contact'],
  ['power', 'Power'],
  ['speed', 'Speed'],
  ['fielding', 'Fielding'],
];

const PITCHER_ABILITIES = [
  ['stuff', 'Stuff'],
  ['command', 'Command'],
  ['velocity', 'Velocity'],
  ['runPrevention', 'Run Prev.'],
];

/**
 * The face of the card: the portrait, the overall, and four numbers.
 *
 * Everything statistical is on the back. The front's job is to be readable in
 * a glance without leaving the game, which is why the ratings are four bare
 * numerals rather than bars — at this size a number is faster than a length,
 * and it leaves the photograph the whole card.
 */
export default function PlayerCardFront({ player, loadingRatings, onFlip, onClose }) {
  const ratings = player.ratings ?? null;
  const abilities = player.isPitcher ? PITCHER_ABILITIES : HITTER_ABILITIES;
  const overall = ratings?.overall ?? null;

  const number =
    player.number && player.number !== '—' ? String(player.number).replace(/^#/, '') : null;
  const season = player.ratingsSeason ? String(player.ratingsSeason) : null;

  return (
    <div className="pcard__front">
      <CardEdges />

      <div className="pcard__photo">
        {/* Repeating club text on the diagonal, the way a stamp's security
            tint runs under the image. Real values only — no invented
            "Premier" branding. */}
        <WatermarkPattern
          abbr={player.teamAbbr}
          pos={player.posAbbr || player.pos}
          season={season}
        />

        <span className="pcard__glow" aria-hidden="true" />

        <PlayerHeadshot
          playerId={player.id}
          name={player.name}
          teamAbbr={player.teamAbbr}
          size={300}
          className="pcard__shot"
        />

        <span className="pcard__vignette" aria-hidden="true" />

        <button
          type="button"
          className="pcard__close"
          onClick={onClose}
          aria-label="Close player card"
        >
          <IconClose size={12} />
        </button>

        <div className="pcard__ovr" data-empty={overall == null}>
          <span className="pcard__ovrval">
            {loadingRatings && overall == null ? '·' : (overall ?? '—')}
          </span>
        </div>

        {season && season.length === 4 && (
          <div className="pcard__year" aria-hidden="true">
            <span>{season.slice(0, 2)}</span>
            <span>{season.slice(2)}</span>
          </div>
        )}

        <span className="pcard__poslabel">{player.posAbbr || player.pos || ''}</span>

        <button type="button" className="pcard__flip pcard__flip--front" onClick={onFlip}>
          Stats &amp; bio <span aria-hidden="true">⇄</span>
        </button>
      </div>

      <div className="pcard__platewrap">
        <div className="pcard__plate">
          <h3 id="playercard-name" className="pcard__name">
            {player.name}
          </h3>
          <p className="pcard__team">
            {[player.team, number && `#${number}`].filter(Boolean).join(' · ')}
          </p>

          <div className="pcard__ratings">
            {abilities.map(([key, label]) => (
              <div className="pcard__rating" key={key} title={ratings?.basis?.[key]}>
                <span className="pcard__ratingval">
                  {loadingRatings && !ratings ? '·' : (ratings?.[key] ?? '—')}
                </span>
                <span className="pcard__ratinglabel">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Twelve rows of repeated text, rotated together and clipped by the photo
   panel. Offsetting every third row keeps the columns from lining up into a
   grid, which is what makes it read as a printed tint rather than a table. */
function WatermarkPattern({ abbr, pos, season }) {
  const word = `${[abbr, pos, season].filter(Boolean).join(' · ')} · `;
  if (!word.trim() || word.trim() === '·') return null;

  const line = word.repeat(6);
  return (
    <div className="pcard__pattern" aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => (
        <span key={i} style={{ marginLeft: `${(i % 3) * -58}px` }}>
          {line}
        </span>
      ))}
    </div>
  );
}
