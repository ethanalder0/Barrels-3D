import { useAppState } from '../state/AppState.jsx';
import { allTeamAbbrs, MAX_FAVORITES } from '../data/favorites.js';
import { TEAMS } from '../data/teams.js';
import TeamLogo from '../components/TeamLogo.jsx';

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
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="page-head__deck">
            Display preferences are session-local. Favourite teams are saved in this browser.
          </p>
        </div>
      </header>

      <FavoriteTeams />

      <div className="settings__columns">
        <section className="settings__group" aria-label="Replay">
          <h2 className="settings__title">Replay</h2>

          <Setting
            label="Render quality"
            hint="Lower it if the replay stutters on an older computer or phone."
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
            hint="Auto lights the park the way MLB scheduled the game: a night game gets a dark sky and the field under the lights. Day or Night forces one for every game."
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

          <Setting
            label="Ball trail"
            hint="Draws the ball's flight path, with the part already flown bright and the rest faint. Turn it off to watch the ball on its own."
          >
            <Switch
              checked={s.showBallTrail}
              onChange={(v) => set('showBallTrail', v)}
              label="Ball trail"
            />
          </Setting>

          <Setting
            label="Strike zone"
            hint="Draws the batter's strike zone at the plate, and marks where each pitch crossed it."
          >
            <Switch
              checked={s.showStrikeZone}
              onChange={(v) => set('showStrikeZone', v)}
              label="Strike zone"
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

        <section className="settings__group" aria-label="Display and motion">
          <h2 className="settings__title">Display &amp; motion</h2>

          <Setting
            label="Dark mode"
            hint="The ink edition: the same pages printed light on dark, with the red lifted to read on it."
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
      </div>
    </div>
  );
}

/* --- Favourite teams ----------------------------------------------------- */

/**
 * Pick the clubs to follow. All thirty at once, as a ruled grid of discs and
 * names: this is a question about which club you recognise, so a dropdown of
 * names is the wrong control even though it would be less markup. A chosen
 * club's cell prints in reverse.
 *
 * Pick order is meaningful elsewhere — the first one is treated as the main
 * club — so that cell says so.
 */
function FavoriteTeams() {
  const { state, actions } = useAppState();
  const favorites = state.favorites;
  const full = favorites.length >= MAX_FAVORITES;

  return (
    <section className="favteams" aria-label="Favorite teams">
      <div className="sectionhead favteams__head">
        <h2>
          <span className="favteams__mark" aria-hidden="true">★</span> Favorite teams
        </h2>
        <p className="favteams__hint">
          Their games come first on the home page and on the schedule.
          {full && ` At ${MAX_FAVORITES}, picking another drops the one you chose first.`}
        </p>
        <div className="sectionhead__aside">
          {favorites.length > 0 && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={actions.clearFavorites}>
              Clear
            </button>
          )}
          <span className="chip chip--ink">
            {favorites.length} of {MAX_FAVORITES}
          </span>
        </div>
      </div>

      <div className="favteams__grid">
        {allTeamAbbrs().map((abbr) => {
          const on = favorites.includes(abbr);
          return (
            <button
              key={abbr}
              type="button"
              className="favteams__team"
              aria-pressed={on}
              onClick={() => actions.toggleFavorite(abbr)}
              title={on ? `Stop following the ${TEAMS[abbr].fullName}` : TEAMS[abbr].fullName}
            >
              <TeamLogo abbr={abbr} size={28} onInk={on} />
              <span className="favteams__name">{TEAMS[abbr].name}</span>
              {on && favorites[0] === abbr && favorites.length > 1 && (
                <small className="favteams__main">Main</small>
              )}
              <span className="favteams__star" aria-hidden="true">
                {on ? '★' : '☆'}
              </span>
            </button>
          );
        })}
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
