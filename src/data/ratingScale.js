/* Percentiles or 20-80 grades. Remembered per browser: it is a reading
   preference, like units, and nobody wants to flip it back on every card. */
const SCALE_KEY = 'barrels.ratingScale';

export function readScale() {
  try {
    return localStorage.getItem(SCALE_KEY) === 'grade' ? 'grade' : 'pct';
  } catch {
    return 'pct';
  }
}

export function saveScale(scale) {
  try {
    localStorage.setItem(SCALE_KEY, scale);
  } catch {
    /* private mode: the toggle still works for this card */
  }
}
