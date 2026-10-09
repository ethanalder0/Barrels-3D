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
  enterMs: 1150, // into the app once the ball is gone, not while it climbs
};

/**
 * Landing screen. A static splash; click and the bat swings, the ball leaves,
 * and the app opens. There are no accounts, so there is nothing to sign in to
 * — the splash is an introduction, not a gate.
 */
export default function SplashScreen() {
  const { state, actions } = useAppState();
  const prefersReducedMotion = useReducedMotion();
  const [phase, setPhase] = useState('idle'); // 'idle' | 'swing'
  const timers = useRef([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const enter = useCallback(() => {
    clearTimers();
    actions.enter();
  }, [actions]);

  const start = useCallback(() => {
    if (phase !== 'idle') return;

    // Reduced motion: no bat, no ball, no crack — straight in.
    if (prefersReducedMotion) {
      enter();
      return;
    }

    setPhase('swing');

    if (state.settings.sound) {
      // Scheduled on the audio clock so the hit lands on the contact frame.
      playSwoosh({ delay: (SWING.contactMs - 230) / 1000, volume: 0.5 });
      playContact(INTRO_CONTACT, { delay: SWING.contactMs / 1000, volume: 1 });
    }

    timers.current.push(setTimeout(enter, SWING.enterMs));
  }, [phase, prefersReducedMotion, enter, state.settings.sound]);

  // Escape skips the animation for anyone who does not want to sit through it.
  useEffect(() => {
    if (phase !== 'swing') return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') enter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, enter]);

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
          <p className="splash__tagline">
            Every at-bat, rebuilt in three dimensions.
          </p>
        </header>
      </div>

      {phase === 'idle' && (
        <button
          type="button"
          className="splash__trigger"
          onClick={start}
          aria-label="Enter Barrels 3D"
        >
          <span className="splash__hint">
            <span>
              <span className="splash__hint-click">Click</span>
              <span className="splash__hint-tap">Tap</span> anywhere to step in
            </span>
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

/* Two seams, each a seam line and its stitching. True circular arcs on one
   centre per pair, at radii 407 and 424, so the two stay parallel the whole
   way round. The right pair is the left turned half a circle about the middle
   of the frame. Both ends of every arc run off the canvas. */
function SeamBackdrop() {
  return (
    <svg className="splash__seams" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d="M-176.7 619.8A407 407 0 0 0 33.2 -163.5" />
      <path className="stitch" d="M-179.6 636.6A424 424 0 0 0 39 -179.4" />
      <path d="M1376.7 180.2A407 407 0 0 0 1166.8 963.5" />
      <path className="stitch" d="M1379.6 163.4A424 424 0 0 0 1161 979.4" />
    </svg>
  );
}
