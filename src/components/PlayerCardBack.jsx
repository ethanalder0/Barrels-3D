import CardEdges from './CardEdges.jsx';
import { IconClose } from './Icons.jsx';

/* ---------------------------------------------------------------------------
   The back of the card: the bio, and every number that did not earn a slot on
   the face.

   Nothing here is computed in the browser. Season Statcast comes from
   server/statcast.py, the sabermetric line from statsapi, and the batted-ball
   block from this game's own tracked contact. A missing value renders as a
   dash — no default, no estimate, no carry-over from a different sample.

   Sections the design allows for but this app has no data behind — splits,
   career by year, contract and service time, a scouting note — are simply not
   rendered. An invented scouting note is still an invention.
--------------------------------------------------------------------------- */

/* Baseball convention: .227, not 0.227. */
function rate(v) {
  if (v == null) return '—';
  const text = Number(v).toFixed(3);
  return text.startsWith('0.') ? text.slice(1) : text;
}

function pct(v, digits = 1) {
  return v == null ? '—' : `${Number(v).toFixed(digits)}%`;
}

function dec(v, digits = 2) {
  return v == null ? '—' : Number(v).toFixed(digits);
}

/* Run values are meaningful in both directions, so the sign is the point: +6
   and -6 are opposite seasons and "6" would hide which one. */
function signed(v) {
  if (v == null) return '—';
  const n = Number(v);
  return n > 0 ? `+${n}` : String(n);
}

function debut(iso) {
  if (!iso) return '—';
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PlayerCardBack({ player, units, onFlip, onClose }) {
  const metric = units === 'metric';
  const speed = (v) =>
    v == null ? '—' : metric ? `${(v * 1.60934).toFixed(1)}` : `${Number(v).toFixed(1)}`;
  const feetPerSec = (v) =>
    v == null ? '—' : metric ? `${(v * 0.3048).toFixed(1)}` : `${Number(v).toFixed(1)}`;
  const distance = (v) => (v == null ? '—' : metric ? `${Math.round(v * 0.3048)}` : `${v}`);
  const speedUnit = metric ? 'km/h' : 'mph';

  const sc = player.statcast ?? null;
  const saber = player.sabermetrics ?? null;
  const season = player.season ?? {};
  const pitching = player.seasonPitching ?? {};
  const batted = player.batted ?? {};
  const seasonOnly = player.scope === 'season';

  const number =
    player.number && player.number !== '—' ? String(player.number).replace(/^#/, '') : null;
  const subtitle = [player.posAbbr || player.pos, number && `#${number}`, player.team]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="pcard__back">
      <CardEdges />

      <div className="pcard__backinner">
        <header className="pcard__backhead">
          <div className="pcard__ovr pcard__ovr--sm" data-empty={player.ratings?.overall == null}>
            <span className="pcard__ovrval">{player.ratings?.overall ?? '—'}</span>
          </div>

          <div className="pcard__backid">
            <h3 className="pcard__backname">{player.name}</h3>
            <p className="pcard__backsub">{subtitle}</p>
          </div>

          <button
            type="button"
            className="pcard__close pcard__close--head"
            onClick={onClose}
            aria-label="Close player card"
          >
            <IconClose size={12} />
          </button>
        </header>

        <div className="pcard__body bk">
          <Section label="Player">
            {/* Paired down the columns rather than across: physique on the
                left, handedness and position on the right. */}
            <dl className="biogrid">
              <Bio k="Height" v={player.height} />
              <Bio k="Bats" v={player.bats} />
              <Bio k="Weight" v={player.weight} />
              <Bio k="Throws" v={player.throws} />
              <Bio k="Age" v={player.age} />
              <Bio k="Pos" v={player.posAbbr || player.pos} />
              <Bio k="Born" v={player.birthplace} wide />
              <Bio k="Debut" v={debut(player.mlbDebut)} wide />
            </dl>
          </Section>

          {player.isPitcher ? (
            <>
              <Section label="Season · pitching">
                <Tiles
                  cells={[
                    [pitching.era, 'ERA'],
                    [pitching.record, 'W-L'],
                    [pitching.ip, 'IP'],
                    [pitching.k, 'K'],
                    [pitching.bb, 'BB'],
                    [pitching.whip, 'WHIP'],
                    [pitching.sv, 'SV'],
                    [dec(saber?.war, 1), 'WAR'],
                  ]}
                />
              </Section>

              <Section
                label="Expected & plate discipline"
                note={sc ? null : player.ratingsNote}
              >
                {sc && (
                  <Tiles
                    tinted={false}
                    cells={[
                      [dec(sc.xera), 'xERA'],
                      /* FIP comes from the qualified-pitcher board, so a
                         reliever having none is normal rather than an error. */
                      [dec(saber?.fip), 'FIP'],
                      [dec(saber?.xfip), 'xFIP'],
                      [saber?.eraMinus == null ? '—' : Math.round(saber.eraMinus), 'ERA-'],
                      [pct(sc.kPct), 'K%'],
                      [pct(sc.bbPct), 'BB%'],
                      [pct(sc.whiffPct), 'Whiff%'],
                      [pct(sc.edgePct), 'Edge%'],
                      [rate(sc.xba), 'xBA'],
                      [rate(sc.xwoba), 'xwOBA'],
                      [pct(sc.hardHitPct), 'Hard hit'],
                      [speed(sc.fastballVelo), 'FB velo', speedUnit],
                    ]}
                  />
                )}
              </Section>

              <Section
                label="Pitch arsenal"
                note={player.arsenal?.length ? null : 'No tracked arsenal for this season.'}
              >
                {player.arsenal?.length > 0 && (
                  <div className="arsenal">
                    <div className="arsenal__head">
                      <span>Pitch</span>
                      <span>Usage</span>
                      <span>Velo</span>
                      <span>Whiff</span>
                      <span>xwOBA</span>
                    </div>
                    {player.arsenal.map((p) => (
                      <div className="arsenal__row" key={p.code}>
                        <div className="arsenal__name">
                          <span>{p.name}</span>
                          <span className="arsenal__bar">
                            <span style={{ width: `${Math.min(100, p.usagePct ?? 0)}%` }} />
                          </span>
                        </div>
                        <span>{pct(p.usagePct, 0)}</span>
                        <span>{speed(p.velo)}</span>
                        <span>{pct(p.whiffPct, 0)}</span>
                        <span className="arsenal__rv">{rate(p.xwoba)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            </>
          ) : (
            <>
              <Section label="Season · hitting">
                <Tiles
                  cells={[
                    [season.avg, 'AVG'],
                    [season.obp, 'OBP'],
                    [season.slg, 'SLG'],
                    [season.ops, 'OPS'],
                    [season.hr, 'HR'],
                    [season.rbi, 'RBI'],
                    [season.sb, 'SB'],
                    [dec(saber?.war, 1), 'WAR'],
                  ]}
                />
              </Section>

              <Section
                label="Expected & batted ball"
                note={sc ? null : player.ratingsNote}
              >
                {sc && (
                  <Tiles
                    tinted={false}
                    cells={[
                      [rate(sc.xba), 'xBA'],
                      [rate(sc.xslg), 'xSLG'],
                      [rate(sc.xwoba), 'xwOBA'],
                      [rate(sc.iso), 'ISO'],
                      [pct(sc.barrelPct), 'Barrel%'],
                      [pct(sc.hardHitPct), 'Hard hit'],
                      [speed(sc.exitVelo), 'Exit velo', speedUnit],
                      [sc.launchAngle == null ? '—' : `${sc.launchAngle.toFixed(1)}°`, 'Launch'],
                      [pct(sc.kPct), 'K%'],
                      [pct(sc.bbPct), 'BB%'],
                      [saber?.wRcPlus == null ? '—' : Math.round(saber.wRcPlus), 'wRC+'],
                      [pct(sc.sweetSpotPct), 'Sweet spot'],
                    ]}
                  />
                )}
              </Section>

              {(player.running || player.fielding || player.catching) && (
                <Section
                  label="Speed & defence"
                  /* A catcher's glove is three separate skills that add up to
                     one run value, so it gets the breakdown rather than an OAA
                     row it has no entry on. */
                  note={
                    player.catching
                      ? `Run value is framing + blocking + throwing, over ${
                          player.catching.pitches ?? '—'
                        } pitches caught.`
                      : null
                  }
                >
                  {/* Four tiles either way. What used to make it six — a
                      catcher's pitch count, a fielder's Bolts, and a Position
                      the bio already states — was exactly what left a half-empty
                      second row, and the least worth a tile. */}
                  <Tiles
                    cells={
                      player.catching
                        ? [
                            [signed(player.catching.runValue), 'Run value'],
                            [signed(player.catching.framingRuns), 'Framing'],
                            [signed(player.catching.blockingRuns), 'Blocking'],
                            [signed(player.catching.throwingRuns), 'Throwing'],
                          ]
                        : [
                            [
                              feetPerSec(player.running?.sprintSpeed),
                              'Sprint',
                              metric ? 'm/s' : 'ft/s',
                            ],
                            [
                              player.running?.hpTo1b == null ? '—' : `${player.running.hpTo1b}`,
                              'Home→1B',
                              'sec',
                            ],
                            [signed(player.fielding?.oaa), 'OAA'],
                            [signed(player.fielding?.runsPrevented), 'Runs saved'],
                          ]
                    }
                  />
                </Section>
              )}

              {/* Aggregated from THIS game's tracked contact — the feed carries
                  no season Statcast totals per game, so the label says so
                  rather than implying a season figure. A card opened from the
                  leaderboards has no game behind it, so both blocks drop out. */}
              {!seasonOnly && (
                <Section label="Batted balls · this game">
                  <Tiles
                    cells={[
                      [batted.battedBalls ?? 0, 'Tracked'],
                      [speed(batted.avgExitVelo), 'Exit velo', speedUnit],
                      [batted.hardHitPct == null ? '—' : `${batted.hardHitPct}%`, 'Hard hit'],
                      [distance(batted.maxDistance), 'Max dist', metric ? 'm' : 'ft'],
                    ]}
                  />
                  <div className="spray__field">
                    <SprayField hits={player.spray ?? []} />
                    {(player.spray ?? []).length === 0 && (
                      <p className="spray__note">No tracked batted balls yet</p>
                    )}
                  </div>
                </Section>
              )}
            </>
          )}
        </div>

        <footer className="pcard__backfoot">
          <span className="pcard__updated">
            {player.ratingsSeason ? `${player.ratingsSeason} season` : 'Season data'}
          </span>
          <button type="button" className="pcard__flip pcard__flip--back" onClick={onFlip}>
            Ratings <span aria-hidden="true">⇄</span>
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({ label, note, children }) {
  return (
    <section className="pcard__section">
      <div className="pcard__rule">
        <span>{label}</span>
      </div>
      {children}
      {note && <p className="pcard__note">{note}</p>}
    </section>
  );
}

function Bio({ k, v, wide }) {
  return (
    <div className={wide ? 'biogrid__cell biogrid__cell--wide' : 'biogrid__cell'}>
      <dt>{k}</dt>
      <dd>{v || '—'}</dd>
    </div>
  );
}

/** Four across, value over label over an optional unit.
 *
 * `tinted` gives the block the filled look the season line uses; the expected
 * block stays outlined so the two read as different kinds of number.
 *
 * The third line is where units live. A card has no room to write "89.2 mph"
 * at 19px, and a label of "EV MPH" reads as one garbled word — hanging the
 * unit under the label keeps the number big and the meaning intact. */
function Tiles({ cells, tinted = true }) {
  return (
    <div className={`tiles${tinted ? ' tiles--tinted' : ''}`}>
      {cells.map(([value, label, unit]) => (
        <div className="tiles__cell" key={label}>
          <span className="tiles__val">{value ?? '—'}</span>
          <span className="tiles__label">{label}</span>
          {unit && <span className="tiles__unit">{unit}</span>}
        </div>
      ))}
    </div>
  );
}

/* MLB hit coordinates live in a ~250x250 grid with home plate near
   (125.42, 203.5) and roughly 2.29 feet per unit — the long-standing community
   conversion. We take that to feet, then to this SVG's 0.42 units-per-foot
   scale with home plate at (150, 168). Sanity-checked against a real batted
   ball: coordX 84.05 / coordY 81.28 → 95 ft pull side, 280 ft out, which lands
   in left field and matches its 312 ft reported distance. */
const HOME = { x: 125.42, y: 203.5 };
const FEET_PER_UNIT = 2.29;
const SVG_PER_FOOT = 0.42;

function toSvg({ x, y }) {
  const pullFeet = (x - HOME.x) * FEET_PER_UNIT;
  const outFeet = (HOME.y - y) * FEET_PER_UNIT;
  return {
    cx: clamp(150 + pullFeet * SVG_PER_FOOT, 6, 294),
    cy: clamp(168 - outFeet * SVG_PER_FOOT, 2, 174),
  };
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/* The field, drawn in feet at the same scale as the dots.

   It used to be a hand-drawn sketch at its own scale: the foul lines ran at
   about 33 degrees off horizontal instead of 45, and the diamond was a third
   too big, so a ball down the line landed in fair territory and an infield
   grounder landed in the outfield grass. Every shape here is now placed by
   the same feet-to-SVG conversion as the batted balls, from real dimensions:
   a generic park, 330 ft down the lines and 400 to centre (a card has no park
   of its own to draw). */
const FIELD = {
  lines: 330, // ft to the fence down each line
  center: 400, // ft to the fence in straightaway centre
  base: 90, // base paths
  rubber: 60.5, // home to the front of the rubber
  skinRadius: 95, // infield dirt arc, around the rubber
  grassInset: 3, // infield grass is the 90 ft square inset this much
  homeCircle: 13,
  moundCircle: 9,
};

/** A point `feet` out along `deg` degrees from centre field (+ toward first). */
function field(deg, feet) {
  const r = (deg * Math.PI) / 180;
  return {
    x: 150 + Math.sin(r) * feet * SVG_PER_FOOT,
    y: 168 - Math.cos(r) * feet * SVG_PER_FOOT,
  };
}
const pt = ({ x, y }) => `${x.toFixed(1)} ${y.toFixed(1)}`;

/* Fence distance: the lines' distance at 45 degrees, centre's at 0. */
const fenceAt = (deg) =>
  FIELD.lines + (FIELD.center - FIELD.lines) * Math.cos((deg * Math.PI) / 90);

const FIELD_PATHS = (() => {
  const left = field(-45, FIELD.lines);
  const right = field(45, FIELD.lines);
  const fence = [];
  for (let d = -45; d <= 45; d += 3) fence.push(pt(field(d, fenceAt(d))));
  const outfield = `M150 168 L${fence.join(' L')} Z`;

  /* The dirt: out along each line to where the 95 ft arc round the rubber
     crosses it, then round that arc. Solved rather than eyeballed: the arc
     meets a foul line d feet out where d^2 - 2*d*r*cos45 + r^2 = R^2. */
  const R = FIELD.skinRadius;
  const m = FIELD.rubber;
  const b = -2 * m * Math.SQRT1_2;
  const d = (-b + Math.sqrt(b * b - 4 * (m * m - R * R))) / 2;
  const skinL = field(-45, d);
  const skinR = field(45, d);
  const arc = R * SVG_PER_FOOT;
  const skin = `M150 168 L${pt(skinL)} A${arc.toFixed(1)} ${arc.toFixed(1)} 0 0 1 ${pt(skinR)} Z`;

  /* Infield grass: the base square pulled in on every side. */
  const half = (FIELD.base * Math.SQRT2) / 2; // centre of the square to a corner
  const inset = half - FIELD.grassInset * Math.SQRT2;
  const mid = field(0, half); // the square's centre
  const u = inset * SVG_PER_FOOT;
  const grass = `M${pt({ x: mid.x, y: mid.y + u })} L${pt({ x: mid.x + u, y: mid.y })} L${pt({ x: mid.x, y: mid.y - u })} L${pt({ x: mid.x - u, y: mid.y })} Z`;

  const bases = [45, -45].map((deg) => field(deg, FIELD.base)).concat(field(0, FIELD.base * Math.SQRT2));
  return {
    outfield,
    skin,
    grass,
    lines: `M150 168 L${pt(left)} M150 168 L${pt(right)}`,
    mound: field(0, FIELD.rubber),
    bases,
  };
})();

function SprayField({ hits }) {
  const f = FIELD_PATHS;
  return (
    <svg viewBox="0 -4 300 184" role="img" aria-label={`${hits.length} tracked batted balls`}>
      <path d={f.outfield} fill="var(--card-stock-3)" stroke="rgba(23, 69, 111, 0.22)" strokeWidth="1.2" />
      <path d={f.skin} fill="rgba(217, 164, 65, 0.16)" />
      <path d={f.grass} fill="var(--card-stock-3)" />
      <circle cx="150" cy="168" r={FIELD.homeCircle * SVG_PER_FOOT} fill="rgba(217, 164, 65, 0.16)" />
      <circle cx={f.mound.x} cy={f.mound.y} r={FIELD.moundCircle * SVG_PER_FOOT} fill="rgba(217, 164, 65, 0.16)" />
      {f.bases.map((b, i) => (
        <rect
          key={i}
          x={b.x - 1.3}
          y={b.y - 1.3}
          width="2.6"
          height="2.6"
          transform={`rotate(45 ${b.x} ${b.y})`}
          fill="rgba(23, 69, 111, 0.35)"
        />
      ))}
      <path d={f.lines} stroke="rgba(23, 69, 111, 0.28)" strokeWidth="1" strokeDasharray="4 4" />

      {hits.map((h, i) => {
        const { cx, cy } = toSvg(h);
        const hard = (h.ev ?? 0) >= 95;
        return (
          <circle
            key={i}
            cx={cx}
            cy={cy}
            r={hard ? 4.2 : 3.4}
            fill={hard ? 'var(--card-gold-dark)' : 'var(--card-navy)'}
            opacity={hard ? 0.95 : 0.55}
          >
            <title>{[h.traj, h.ev != null && `${h.ev} mph`].filter(Boolean).join(' · ')}</title>
          </circle>
        );
      })}
    </svg>
  );
}
