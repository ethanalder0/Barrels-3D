import { useState } from 'react';
import { useLiveData } from '../state/LiveDataProvider.jsx';
import { teamVars } from '../data/teamStyle.js';
import PlayerName from './PlayerName.jsx';
import TeamLogo from './TeamLogo.jsx';

const BATTER_COLS = ['AB', 'R', 'H', 'RBI', 'BB', 'K', 'AVG'];
const PITCHER_COLS = ['IP', 'H', 'R', 'ER', 'BB', 'K', 'ERA'];

/**
 * Box score for either side, batting or pitching.
 *
 * The selected team's colour drives a hairline accent bar, the active tab and
 * a very light wash behind the table head — enough to tell at a glance whose
 * numbers you are reading, without the panel becoming team livery.
 */
export default function BoxScore() {
  const { game, boxScore } = useLiveData();
  const [side, setSide] = useState('home');
  const [tab, setTab] = useState('batting');

  if (!game) return null;

  const rows = tab === 'batting' ? boxScore[side]?.batters ?? [] : boxScore[side]?.pitchers ?? [];
  const cols = tab === 'batting' ? BATTER_COLS : PITCHER_COLS;
  const activeAbbr = game[side]?.abbr;

  return (
    <section className="panel panel--team" aria-label="Box score" style={teamVars(activeAbbr)}>
      <div className="panel__accent" aria-hidden="true" />

      <div className="panel__head">
        <div className="panel__title">
          <h3>Box score</h3>
          <div className="tabs tabs--team" role="tablist" aria-label="Team">
            {['away', 'home'].map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                className="tabs__btn tabs__btn--team"
                aria-selected={side === s}
                onClick={() => setSide(s)}
                style={teamVars(game[s]?.abbr)}
              >
                <TeamLogo abbr={game[s]?.abbr} size={18} />
                {game[s].abbr}
              </button>
            ))}
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Box score view">
          {[
            ['batting', 'Batting'],
            ['pitching', 'Pitching'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="tabs__btn"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="panel__body panel__body--flush">
        {rows.length === 0 ? (
          <p className="atbats__empty">No {tab} lines yet.</p>
        ) : (
          <table className="statable statable--team">
            <thead>
              <tr>
                <th scope="col">{tab === 'batting' ? 'Batter' : 'Pitcher'}</th>
                {cols.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <PlayerName playerId={r.id} name={r.name}>
                      <span className="statable__name">{r.name}</span>
                      {r.pos && <span className="statable__pos">{r.pos}</span>}
                    </PlayerName>
                  </td>
                  {(tab === 'batting'
                    ? [r.ab, r.r, r.h, r.rbi, r.bb, r.k, r.avg]
                    : [r.ip, r.h, r.r, r.er, r.bb, r.k, r.era]
                  ).map((v, i) => (
                    <td key={cols[i]}>{v ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
