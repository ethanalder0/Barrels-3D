/**
 * Feed state → the chip in the header.
 *
 * A plain function rather than a hook: it needs no React, and keeping
 * non-component exports out of LiveDataProvider.jsx keeps Fast Refresh working
 * for the provider during development.
 */
export function connectionLabel({ mode, connection, replay }) {
  if (mode === 'demo') return { text: 'Demo data', tone: 'muted' };
  if (replay?.replay && connection !== 'closed') return { text: 'Replay', tone: 'live' };

  switch (connection) {
    case 'live':
      return { text: 'Live', tone: 'live' };
    case 'waiting':
      return { text: 'Pre-game', tone: 'muted' };
    case 'complete':
      return { text: 'Final', tone: 'muted' };
    case 'connecting':
    case 'starting':
    case 'open':
      return { text: 'Connecting', tone: 'muted' };
    case 'reconnecting':
      return { text: 'Reconnecting', tone: 'warn' };
    case 'error':
      return { text: 'Feed error', tone: 'warn' };
    default:
      return { text: 'Idle', tone: 'muted' };
  }
}
