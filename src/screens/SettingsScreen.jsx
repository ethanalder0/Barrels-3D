import { useAppState } from '../state/AppState.jsx';
import { allTeamAbbrs, MAX_FAVORITES } from '../data/favorites.js';
import { TEAMS } from '../data/teams.js';
import { teamVars } from '../data/teamStyle.js';
import TeamLogo from '../components/TeamLogo.jsx';
import { IconStar } from '../components/Icons.jsx';

/**
 * Preferences. Session-local, with one exception: favourite clubs are kept in
 * localStorage, because a list you have to re-pick every reload is useless.
 */
export default function SettingsScreen() {
  const { state, actions } = useAppState();
  const s = state.settings;
  const set = actions.setSetting;

  return (
    <div className="settings">
      <div className="page-head">
        <div>
          <h2>Settings</h2>
          <p>Display preferences are session-local. Favourite teams are saved in this browser.</p>
        </div>
      </div>

      <FavoriteTeams />

      <section className="panel" aria-label="Playback">
        <div className="panel__head">
          <div className="panel__title">
            <h3>Replay</h3>
          </div>
        </div>

        <Setting
          label="Render quality"
          hint="Passed to the replay engine as a barrels:quality event. Lower it on older hardware."
        >
          <Segmented
            value={s.replayQuality}
            onChange={(v) => set('replayQuality', v)}
            options={[
              ['low', 'Low'],
              ['medium', 'Medium'],
              ['high', 'High'],
            ]}
          />
        </Setting>

        <Setting
          label="Camera"
          hint="Where every play is watched from. Behind the plate is the catcher's view of the zone; Broadcast is the TV shot from center field, over the pitcher's shoulder at the batter. Both follow a ball in play the same way."
        >
          <Segmented
            value={s.replayCamera}
            onChange={(v) => set('replayCamera', v)}
            options={[
              ['catcher', 'Behind the plate'],
              ['centerfield', 'Broadcast'],
            ]}
          />
        </Setting>

        <Setting
          label="Zoom"
          hint="How tight the camera's shot is, for whichever view is chosen. Left pulls back for more of the field, right moves in on the plate."
        >
          <Slider
            value={s.replayZoom}
            onChange={(v) => set('replayZoom', v)}
            min={0.6}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            label="Replay zoom"
          />
        </Setting>

        <Setting
          label="Day or night"
          hint="Auto lights the park the way MLB scheduled the game — a night game gets a dark sky and the field under the lights. Day or Night forces one for every game."
        >
          <Segmented
            value={s.nightGames}
            onChange={(v) => set('nightGames', v)}
            options={[
              ['auto', 'Auto'],
              ['day', 'Day'],
              ['night', 'Night'],
            ]}
          />
        </Setting>

        <Setting label="Advanced metrics" hint="Show exit velocity, launch angle and barrel rate throughout.">
          <Switch
            checked={s.showAdvancedMetrics}
            onChange={(v) => set('showAdvancedMetrics', v)}
            label="Advanced metrics"
          />
        </Setting>
      </section>

      <section className="panel" aria-label="Display">
        <div className="panel__head">
          <div className="panel__title">
            <h3>Display &amp; motion</h3>
          </div>
        </div>

        <Setting
          label="Dark mode"
          hint="A warm dark palette — espresso and bronze rather than grey, to match the light theme's cream and tan."
        >
          <Switch
            checked={s.theme === 'dark'}
            onChange={(v) => set('theme', v ? 'dark' : 'light')}
            label="Dark mode"
          />
        </Setting>

        <Setting label="Units" hint="Applies to exit velocity, pitch speed and distances.">
          <Segmented
            value={s.units}
            onChange={(v) => set('units', v)}
            options={[
              ['imperial', 'mph / ft'],
              ['metric', 'km/h / m'],
            ]}
          />
        </Setting>

        <Setting
          label="Reduce motion"
          hint="'System' follows your OS preference, which also skips the opening swing animation. 'Always' forces it on for in-app motion."
        >
          <Segmented
            value={s.reduceMotion}
            onChange={(v) => set('reduceMotion', v)}
            options={[
              ['system', 'System'],
              ['always', 'Always'],
            ]}
          />
        </Setting>
      </section>

      <section className="panel" aria-label="Account">
        <div className="panel__head">
          <div className="panel__title">
            <h3>Account</h3>
          </div>
        </div>
        <div className="panel__body" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
          <div>
            <div className="setting__label">{state.user?.name ?? 'Guest'}</div>
            <p className="setting__hint">{state.user?.email ?? 'Signed in without an account.'}</p>
          </div>
          <div>
            <button type="button" className="btn btn--ghost" onClick={actions.signOut}>
              Sign out
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* --- Favourite teams ----------------------------------------------------- */

/**
 * Pick the clubs to follow. All thirty at once, as logos: this is a question
 * about which badge you recognise, so a dropdown of names is the wrong control
 * even though it would be less markup.
 *
 * Followed clubs are listed back above the grid in pick order, because that
 * order is meaningful elsewhere — the first one is treated as the main club.
 */
function FavoriteTeams() {
  const { state, actions } = useAppState();
  const favorites = state.favorites;
  const full = favorites.length >= MAX_FAVORITES;

  return (
    <section className="panel" aria-label="Favorite teams">
      <div className="panel__head">
        <div className="panel__title">
          <IconStar size={16} filled={favorites.length > 0} />
          <h3>Favorite teams</h3>
        </div>
        <div className="panel__title">
          <span className="chip">
            {favorites.length} of {MAX_FAVORITES}
          </span>
          {favorites.length > 0 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={actions.clearFavorites}>
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="panel__body">
        <p className="setting__hint favteams__hint">
          Their games come first on the home page and on the schedule.
          {full && ` At ${MAX_FAVORITES}, picking another drops the one you chose first.`}
        </p>

        {favorites.length > 0 && (
          <ol className="favteams__picked">
            {favorites.map((abbr, i) => (
              <li key={abbr} style={teamVars(abbr)}>
                <button
                  type="button"
                  className="favteams__chip"
                  onClick={() => actions.toggleFavorite(abbr)}
                  title={`Stop following the ${TEAMS[abbr].name}`}
                >
                  <TeamLogo abbr={abbr} size={18} />
                  <span>{TEAMS[abbr].name}</span>
                  {i === 0 && <small>main</small>}
                  <span className="favteams__remove" aria-hidden="true">
                    ×
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}

        <div className="favteams__grid">
          {allTeamAbbrs().map((abbr) => {
            const on = favorites.includes(abbr);
            return (
              <button
                key={abbr}
                type="button"
                className="favteams__team"
                aria-pressed={on}
                style={teamVars(abbr)}
                onClick={() => actions.toggleFavorite(abbr)}
                title={TEAMS[abbr].fullName}
              >
                <TeamLogo abbr={abbr} size={26} />
                <span className="favteams__name">{TEAMS[abbr].name}</span>
                <span className="favteams__star" aria-hidden="true">
                  <IconStar size={13} filled={on} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Setting({ label, hint, children }) {
  return (
    <div className="setting">
      <div>
        <div className="setting__label">{label}</div>
        {hint && <p className="setting__hint">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented">
      {options.map(([id, label]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/* A range with its value printed beside it. Double-click the track to put it
   back at 1, the stock framing, which is otherwise fiddly to land on. */
function Slider({ value, onChange, min, max, step, format, label }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={format(value)}
        style={{ '--fill': `${fill}%` }}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(1)}
      />
      <output className="slider__value">{format(value)}</output>
    </div>
  );
}

function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    />
  );
}
