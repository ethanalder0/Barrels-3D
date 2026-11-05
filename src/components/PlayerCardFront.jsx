import CardEdges from './CardEdges.jsx';
import PlayerHeadshot from './PlayerHeadshot.jsx';
import { IconClose } from './Icons.jsx';
import { SHORT_LABELS, valueOf } from './RatingsWheel.jsx';

/* Placeholders while the ratings load, so the plate does not jump. */
const HITTER_PLACEHOLDER = ['gamePower', 'batToBall', 'speed', 'range'];
const PITCHER_PLACEHOLDER = ['stuff', 'batMissing', 'command', 'contactManagement'];

/**
 * The face of the card: the portrait, the overall, and four numbers.
 *
 * Everything statistical is on the back, including the full wheel. The front's
 * job is to be readable in a glance without leaving the game, which is why the
 * ratings are four bare numerals rather than bars — at this size a number is
 * faster than a length, and it leaves the photograph the whole card. Which
 * four is the server's call (`headline`): the glove slot belongs to whatever
 * his position is rated on, or to Swing Decisions for a DH.
 */
export default function PlayerCardFront({
  player,
  nameId = 'playercard-name',
  loadingRatings,
  scale = 'pct',
  onFlip,
  onClose,
}) {
  const ratings = player.ratings?.version === 2 ? player.ratings : null;
  const byKey = Object.fromEntries((ratings?.attributes ?? []).map((a) => [a.key, a]));
  const headline =
    ratings?.headline ?? (player.isPitcher ? PITCHER_PLACEHOLDER : HITTER_PLACEHOLDER);
  const overall = valueOf(ratings?.overall, scale);

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
          <h3 id={nameId} className="pcard__name">
            {player.name}
          </h3>
          <p className="pcard__team">
            {[player.team, number && `#${number}`].filter(Boolean).join(' · ')}
          </p>

          <div className="pcard__ratings">
            {headline.map((key) => {
              const a = byKey[key];
              return (
                <div
                  className="pcard__rating"
                  key={key}
                  title={a ? `${a.label}: ${a.question}` : undefined}
                >
                  <span className="pcard__ratingval">
                    {loadingRatings && !ratings ? '·' : (valueOf(a, scale) ?? '—')}
                  </span>
                  <span className="pcard__ratinglabel">{SHORT_LABELS[key] ?? key}</span>
                </div>
              );
            })}
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
