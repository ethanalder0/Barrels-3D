/**
 * The selected play's batted-ball numbers, in four ruled cells under the
 * replay: exit velocity, launch angle, distance, and whether it was a barrel.
 * Shown while Settings → Advanced metrics is on.
 *
 * A play with no ball in play (a strikeout, a walk) still gets the strip, with
 * dashes, so the page does not jump every time the selection changes. So does
 * the at-bat still in progress: until it is over, its hit data is the latest
 * event that carried any — often an earlier foul — not the ball in play, and
 * printing it would also give the result away before the replay shows it.
 */
export default function BattedBallStrip({ atBat, metric }) {
  const settled = atBat && !atBat.live && atBat.kind !== 'live';
  const ev = settled ? (atBat.exitVelo ?? null) : null;
  const la = settled ? (atBat.launchAngle ?? null) : null;
  const dist = settled ? (atBat.distance ?? null) : null;
  const barrel = isBarrel(ev, la);

  return (
    <dl className="bbstrip" aria-label="Batted ball">
      <Cell
        label="Exit velo"
        value={ev == null ? null : (metric ? ev * 1.60934 : ev).toFixed(1)}
        unit={metric ? 'km/h' : 'mph'}
      />
      <Cell label="Launch angle" value={la == null ? null : `${Math.round(la)}°`} />
      <Cell
        label="Distance"
        value={dist == null ? null : String(Math.round(metric ? dist * 0.3048 : dist))}
        unit={metric ? 'm' : 'ft'}
      />
      <div className="bbstrip__cell">
        <dt className="bbstrip__label">Barrel</dt>
        <dd className="bbstrip__value" data-yes={barrel || undefined} data-none={barrel == null || undefined}>
          {barrel == null ? '—' : barrel ? 'Yes' : 'No'}
        </dd>
      </div>
    </dl>
  );
}

function Cell({ label, value, unit }) {
  return (
    <div className="bbstrip__cell">
      <dt className="bbstrip__label">{label}</dt>
      <dd className="bbstrip__value" data-none={value == null || undefined}>
        {value ?? '—'}
        {value != null && unit && <small> {unit}</small>}
      </dd>
    </div>
  );
}

/**
 * Statcast's barrel zone, from exit velocity and launch angle alone. The feed
 * carries no barrel flag per ball, so this is MLB's published definition: at
 * 98 mph a 26-30 degree window, widening as the ball gets harder — to 24-33 at
 * 100 mph, and about a degree each way per mph after that until 8-50 at 116.
 * Close enough to agree with Savant on all but the odd ball on the edge.
 *
 * Returns null when there is no batted ball to judge.
 */
export function isBarrel(ev, la) {
  if (ev == null || la == null) return null;
  if (ev < 98) return false;
  const lo = Math.max(8, ev <= 100 ? 26 - (ev - 98) : 24 - (ev - 100));
  const hi = Math.min(50, ev < 99 ? 30 : ev < 100 ? 31 : 33 + (ev - 100) * (17 / 16));
  return la >= lo && la <= hi;
}
