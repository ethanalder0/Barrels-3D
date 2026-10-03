import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState } from '../state/AppState.jsx';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import { playContact, playSwoosh } from '../audio/crack.js';
import { Bat, Baseball } from '../components/Icons.jsx';
import '../styles/splash.css';

/* ┌──────────────────────────────────────────────────────────────────────┐
   │  INTRO CONTACT SOUND — flip this to hear the other one.              │
   │                                                                      │
   │    'barrel'   flush contact: loud, bright, sharp   ← intro default   │
   │    'muffled'  off the sweet spot: dull, low, longer                  │
   │                                                                      │
   │  Save and the dev server hot-reloads; click the splash to hear it.   │
   │  Settings → Sound effects also has a Barrel/Muffled A-B pair, which  │
   │  is quicker for comparing them back to back.                         │
   └──────────────────────────────────────────────────────────────────────┘ */
const INTRO_CONTACT = 'barrel';

/* Timings shared between the CSS keyframes and the audio scheduler.
   If you retune the animation, change both — splash.css documents the same
   numbers as percentages of `totalMs`. */
const SWING = {
  totalMs: 1060,
  contactMs: 420,
  cardAtMs: 900, // card starts fading in while the ball is still climbing
};

/**
 * Landing screen. Starts as a static splash with no form in the DOM at all —
 * the login card is only mounted once the swing resolves, which is what keeps
 * its controls out of the tab order until they are actually revealed.
 */
export default function SplashScreen() {
  const { state, actions } = useAppState();
  const prefersReducedMotion = useReducedMotion();
  const [phase, setPhase] = useState('idle'); // 'idle' | 'swing' | 'login'
  const timers = useRef([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const reveal = useCallback(() => {
    clearTimers();
    setPhase('login');
  }, []);

  const start = useCallback(() => {
    if (phase !== 'idle') return;

    // Reduced motion: no bat, no ball, no crack — straight to the card.
    if (prefersReducedMotion) {
      setPhase('login');
      return;
    }

    setPhase('swing');

    if (state.settings.sound) {
      // Scheduled on the audio clock so the hit lands on the contact frame.
      playSwoosh({ delay: (SWING.contactMs - 230) / 1000, volume: 0.5 });
      playContact(INTRO_CONTACT, { delay: SWING.contactMs / 1000, volume: 1 });
    }

    timers.current.push(setTimeout(reveal, SWING.cardAtMs));
  }, [phase, prefersReducedMotion, reveal, state.settings.sound]);

  // Escape skips the animation for anyone who does not want to sit through it.
  useEffect(() => {
    if (phase !== 'swing') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') reveal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, reveal]);

  return (
    <main className="splash" data-phase={phase}>
      <div className="splash__bg" aria-hidden="true" />
      <SeamBackdrop />

      <div className="splash__content">
        <header className="splash__mark">
          {/* aria-label because the flex gap between the two spans is visual
              only — without it the accessible name reads "Barrels3D". */}
          <h1 className="splash__wordmark" aria-label="Barrels 3D">
            <span>Barrels</span>
            <span className="dim">3D</span>
          </h1>
          {phase !== 'login' && (
            <p className="splash__tagline">
              Every at-bat, rebuilt in three dimensions.
            </p>
          )}
        </header>

        {phase === 'login' && <LoginCard onSignIn={actions.signIn} />}
      </div>

      {phase !== 'login' && (
        <button
          type="button"
          className="splash__trigger"
          onClick={start}
          aria-label="Start Barrels 3D and show the sign-in form"
        >
          <span className="splash__hint">
            Click anywhere to step in
            <span className="splash__hint-key" aria-hidden="true">
              ↵
            </span>
          </span>
        </button>
      )}

      {phase !== 'idle' && !prefersReducedMotion && <SwingStage />}
    </main>
  );
}

/* --- The animation itself (purely decorative) ---------------------------- */

function SwingStage() {
  return (
    <div className="swing" aria-hidden="true">
      {/* Swing trail, radius 185 about the pivot at (215, 300). Drawn from the
          +10deg end to the -128deg end so it follows the barrel's actual
          direction of travel — reverse the swing and this has to flip too. */}
      <svg className="swing__arc" viewBox="0 0 640 360">
        <path d="M397.2 332.1 A185 185 0 0 0 101.1 154.2" />
      </svg>
      <div className="swing__bat">
        <Bat />
      </div>
      <div className="swing__ball">
        <Baseball size={34} />
      </div>
      <div className="swing__impact swing__impact--core" />
      <div className="swing__impact" />
    </div>
  );
}

function SeamBackdrop() {
  return (
    <svg className="splash__seams" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d="M-40 620C180 560 300 420 300 240 300 120 260 20 190-60" />
      <path className="stitch" d="M-20 604C196 546 316 408 316 232 316 116 278 18 210-58" />
      <path d="M1240 180C1020 240 900 380 900 560c0 120 40 220 110 300" />
      <path className="stitch" d="M1222 196C1006 254 886 392 886 568c0 116 38 214 106 290" />
    </svg>
  );
}

/* --- Login card ---------------------------------------------------------- */

function LoginCard({ onSignIn }) {
  const emailRef = useRef(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');

  // Move focus into the form the moment it exists, so keyboard users land on
  // the first field rather than back at the top of the document.
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  const submit = (e) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Enter an email and password to continue.');
      return;
    }
    setError('');
    onSignIn({ email: email.trim(), name: email.split('@')[0] || 'Guest', remember });
  };

  return (
    <form className="splash__card" onSubmit={submit} noValidate>
      <div className="splash__card-head">
        <h2>Sign in</h2>
        <p>Pick up the game where you left it.</p>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="login-email">
          Email
        </label>
        <input
          id="login-email"
          ref={emailRef}
          className="field__input"
          type="email"
          autoComplete="username"
          placeholder="you@ballpark.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="login-password">
          Password
        </label>
        <input
          id="login-password"
          className="field__input"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="splash__row">
        <label className="splash__check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Keep me signed in
        </label>
        <a href="#reset" onClick={(e) => e.preventDefault()}>
          Forgot password?
        </a>
      </div>

      <p className="splash__error" role="alert">
        {error}
      </p>

      <button type="submit" className="btn btn--primary btn--block">
        Sign in
      </button>

      <div className="splash__alt">or</div>

      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => onSignIn({ email: null, name: 'Guest', remember: false })}
      >
        Continue as guest
      </button>

      <p className="splash__foot">No backend wired yet — any credentials get you in.</p>
    </form>
  );
}
