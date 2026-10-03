/* Small inline SVGs. No icon font, no external assets. */

export function Baseball({ size = 24, className }) {
  return (
    <svg viewBox="0 0 34 34" width={size} height={size} className={className} aria-hidden="true">
      <circle cx="17" cy="17" r="16" fill="#fffdf8" stroke="var(--c-line-strong)" strokeWidth="1" />
      <g fill="none" stroke="var(--c-seam)" strokeWidth="1.6" strokeLinecap="round">
        <path d="M7.2 4.4C10.6 9 11.6 14.6 10 20.4 9.2 23.4 7.6 26.2 5.4 28.6" />
        <path d="M26.8 4.4C23.4 9 22.4 14.6 24 20.4c.8 3 2.4 5.8 4.6 8.2" />
        <g strokeWidth="1.3" strokeDasharray="0.1 3.6">
          <path d="M8.8 6.6c1.6 1 3 2.2 4.2 3.6M8.2 11.4c1.8.5 3.5 1.2 5 2.2M8.6 16.4c1.9 0 3.8.3 5.5.9M7.6 21.2c1.8-.5 3.7-.7 5.5-.6M6.2 25.6c1.6-1 3.3-1.7 5.1-2.2" />
          <path d="M25.2 6.6c-1.6 1-3 2.2-4.2 3.6M25.8 11.4c-1.8.5-3.5 1.2-5 2.2M25.4 16.4c-1.9 0-3.8.3-5.5.9M26.4 21.2c-1.8-.5-3.7-.7-5.5-.6M27.8 25.6c-1.6-1-3.3-1.7-5.1-2.2" />
        </g>
      </g>
    </svg>
  );
}

export function Bat({ className }) {
  return (
    <svg viewBox="0 0 200 26" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="bat-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d8b183" />
          <stop offset="45%" stopColor="#c19560" />
          <stop offset="100%" stopColor="#9a6f42" />
        </linearGradient>
      </defs>
      {/* handle → barrel taper */}
      <path
        d="M12 13c0-3.2 1.4-4 4-4.2l86-2.4c56-1.6 92 .6 96 5.6-4 5-40 7.2-96 5.6l-86-2.4c-2.6-.2-4-1-4-4.2Z"
        fill="url(#bat-wood)"
      />
      {/* knob */}
      <circle cx="8" cy="13" r="6" fill="#8d6338" />
      {/* grip tape */}
      <path d="M18 9.2 18 16.8M24 9 24 17M30 8.9 30 17.1" stroke="#7a5530" strokeWidth="1.6" opacity="0.5" />
      {/* highlight */}
      <path d="M40 9.4l150 1.6" stroke="#f0d7b4" strokeWidth="1.4" opacity="0.55" strokeLinecap="round" />
    </svg>
  );
}

export function IconChevron({ size = 16, dir = 'right' }) {
  const rot = { right: 0, down: 90, left: 180, up: 270 }[dir] ?? 0;
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" style={{ transform: `rotate(${rot}deg)` }}>
      <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconClose({ size = 16 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function IconFullscreen({ size = 16, exit = false }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path
        d={exit ? 'M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4' : 'M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconCube({ size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path
        d="M12 2.5l8.5 4.8v9.4L12 21.5 3.5 16.7V7.3L12 2.5Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M3.7 7.4L12 12l8.3-4.6M12 12v9.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" opacity="0.6" />
    </svg>
  );
}

/* A favourite club. `filled` is the followed state — the outline alone is too
   easy to miss in a grid of thirty, so the two states differ in fill, not just
   in colour. */
export function IconStar({ size = 16, filled = false }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path
        d="M8 1.6l1.94 3.93 4.34.63-3.14 3.06.74 4.32L8 11.5l-3.88 2.04.74-4.32L1.72 6.16l4.34-.63L8 1.6Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* Play and stop, for the highlights button. */
export function IconPlay({ size = 12, stop = false }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      {stop ? (
        <rect x="3.5" y="3.5" width="9" height="9" rx="1.2" fill="currentColor" />
      ) : (
        <path d="M4.5 2.8v10.4L13 8 4.5 2.8Z" fill="currentColor" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/* A film camera, for the replay's camera-mode button. */
export function IconCamera({ size = 16 }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <rect x="1.5" y="4.5" width="9" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 7l4-2v6l-4-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
