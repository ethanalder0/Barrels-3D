/* ---------------------------------------------------------------------------
   REPLAY TUNING — the knobs worth turning by hand.
   ---------------------------------------------------------------------------
   These only change how a play LOOKS. None of them moves where the ball crosses
   the plate or where it lands: the solves still put every pitch on its recorded
   location and every batted ball on its tracked distance, so the strike-zone
   mark and the result stay honest whatever these are set to.
--------------------------------------------------------------------------- */

/**
 * How fast a pitch plays, as a fraction of real time.
 *
 *   1    real speed (a 95 mph fastball is ~0.4 s, hand to plate)
 *   0.5  half speed
 *   0.25 quarter speed
 *
 * Higher is faster. Every pitch uses the same rate, so a changeup still reads
 * slower than the fastball before it. After contact the clock eases back to
 * real time for the batted ball.
 */
export const PITCH_VELOCITY = .7;

/**
 * How much a pitch breaks, as a multiple of its modelled movement.
 *
 *   1    physical (the spin model's own break)
 *   1.6  exaggerated, easier to see at broadcast distance
 *   2+   cartoonish
 *
 * Scales the spin (Magnus) force on the pitch only — gravity and drag are
 * untouched, and batted balls are never affected.
 */
export const PITCH_MOVEMENT = 2;

/* ---------------------------------------------------------------------------
   HOW LONG A PLAY IS ON SCREEN
   ---------------------------------------------------------------------------
   A pitch is 0.4 s of ball. A PLAY is longer than that at both ends, and those
   two ends are the difference between watching a pitcher pitch and watching a
   ball appear: the wind-up and leg kick happen BEFORE the ball is released, and
   the follow-through happens after the ball has stopped mattering.

   So the play's clock starts before the release and runs on past the last
   sample. t = 0 is the first frame of the wind-up, not the release — see
   play.js, which does the shifting, and player.js, which is what the numbers
   are measured against.
--------------------------------------------------------------------------- */

/**
 * Seconds of wind-up before the ball leaves the hand.
 *
 * The pitching clip takes 1.633 s to get from its first frame to release (the
 * leg kick peaks at 0.67 s), so that is the smallest number that shows the
 * whole motion. Less than that and the clip starts part-way through the
 * wind-up, which reads as a pitcher snatching at the ball. More just adds a
 * pause on the rubber before he starts.
 *
 * Runs at real speed, not in pitch slow motion — a wind-up at 0.7x looks like
 * an injury.
 */
export const WINDUP_LEAD_IN = 1.633;

/**
 * Seconds of play left on the clock after the ball has finished.
 *
 * Without it the picture freezes the instant the ball lands or hits the mitt,
 * halfway through a follow-through. The pitcher needs 2.33 s after release to
 * finish his; a batted ball's own hang time covers most of that, so this is
 * really sizing the case where nothing is put in play.
 */
export const FINISH_TAIL = 2;
