import { useEffect, useState } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { fetchLeaders } from '../data/liveClient.js';
import { teamVars } from '../data/teamStyle.js';
import PlayerHeadshot from '../components/PlayerHeadshot.jsx';
import PlayerName from '../components/PlayerName.jsx';
import TeamLogo from '../components/TeamLogo.jsx';
import { IconChevron } from '../components/Icons.jsx';

/* ---------------------------------------------------------------------------
   One leaderboard, in full.

   The home page shows the top five of each category, which is the right size
   for a landing page and the wrong size for actually exploring. Expanding a
   board lands here with fifty names, each one a headshot and a card away.

   The backend builds every board at fifty and slices, so this page and the
   home page's five come out of the same cache entry — arriving here triggers
   no upstream work beyond the request itself.

   Which board to show comes from `state.leaderboard`, set by whichever card
   was expanded.
--------------------------------------------------------------------------- */

const FULL_DEPTH = 50;

export default function LeaderboardScreen() {
  const { state, actions } = useAppState();
  const { mode } = useLiveData();
  const target = state.leaderboard;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (mode === 'demo') return undefined;
    const controller = new AbortController();
    let cancelled = false;
    setData(null);
    setError(null);

    fetchLeaders({ per: FULL_DEPTH, signal: controller.signal })
      .then((payload) => !cancelled && setData(payload))
      .catch((err) => !cancelled && err.name !== 'AbortError' && setError(err.message));

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mode]);

  const group = data?.groups?.find((g) => g.id === target?.groupId) ?? null;
  const category = group?.categories?.find((c) => c.id === target?.categoryId) ?? null;
  const rows = category?.leaders ?? [];

  return (
    <div className="leaderpage">
      <div className="page-head">
        <div>
          <button type="button" className="btn btn--ghost btn--sm backlink" onClick={() => actions.navigate('home')}>
            <span className="backlink__icon" aria-hidden="true">
              <IconChevron size={13} dir="left" />
            </span>
            League leaders
          </button>

          <h2 className="leaderpage__title">
            {category ? category.label : 'Leaderboard'}
            {group && <span className="leaderpage__group">{group.label}</span>}
          </h2>

          <p className="leaderpage__desc">
            {category?.description}
            {category?.lowerIsBetter && <span className="leaderpage__polarity"> · lower is better</span>}
          </p>
        </div>

        <div className="leaderpage__meta">
          {data && <span className="chip">{data.season} season</span>}
          <span className="chip chip--muted">Qualified only</span>
        </div>
      </div>

      {mode === 'demo' && <p className="atbats__empty">League leaders need the live backend.</p>}
      {mode !== 'demo' && error && (
        <p className="notice">
          Couldn’t load the leaderboard — <code>{error}</code>
        </p>
      )}
      {mode !== 'demo' && !error && !data && <LeaderPageSkeleton />}

      {data && !category && (
        <p className="atbats__empty">That leaderboard isn’t available for this season.</p>
      )}

      {rows.length > 0 && (
        <ol className="leaderfull">
          {rows.map((row) => (
            <li className="leaderfull__row" key={`${row.rank}-${row.playerId}`} style={teamVars(row.teamAbbr)}>
              <span className="leaderfull__rank u-num">{row.rank}</span>

              <PlayerHeadshot
                playerId={row.playerId}
                name={row.name}
                teamAbbr={row.teamAbbr}
                size={40}
                variant="spot"
                className="leaderfull__shot"
              />

              <span className="leaderfull__id">
                <PlayerName playerId={row.playerId} name={row.name} className="leaderfull__name" />
                <span className="leaderfull__team">
                  <TeamLogo abbr={row.teamAbbr} size={14} />
                  {row.teamName || row.teamAbbr || '—'}
                </span>
              </span>

              <span className="leaderfull__value u-num">{row.display}</span>
            </li>
          ))}
        </ol>
      )}

      {rows.length > 0 && (
        <p className="leaderpage__foot">
          {/* The pitching pool is smaller than the hitting one — statsapi
              qualifies about 54 pitchers against 137 hitters — so a pitching
              board can legitimately run out before fifty. */}
          Showing {rows.length} of the qualified {group?.label?.toLowerCase() ?? ''} pool.
        </p>
      )}
    </div>
  );
}

function LeaderPageSkeleton() {
  return (
    <ol className="leaderfull" aria-busy="true">
      {Array.from({ length: 10 }, (_, i) => (
        <li className="leaderfull__row" key={i}>
          <span className="leaderfull__rank u-num">{i + 1}</span>
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%' }} />
          <div className="skeleton" style={{ height: 14, width: '38%' }} />
        </li>
      ))}
    </ol>
  );
}
