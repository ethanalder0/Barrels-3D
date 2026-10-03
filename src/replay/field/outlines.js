/* ---------------------------------------------------------------------------
   OUTLINES — the parks five numbers cannot describe.
   ---------------------------------------------------------------------------
   Nearly every park is fairly reported by the distances at the two foul lines,
   the two power alleys and center field: the wall between those markers is a
   long gentle run, and interpolating it is not a guess about anything anyone
   would notice.

   A few parks are not like that. Their walls have real corners in real places,
   the corners are between the markers, and the shape IS the park — draw Fenway
   as a smooth curve through 310 / 335 / 390 / 378 / 302 and you get a stadium
   nobody would recognise, because the Monster and the triangle both live in the
   gaps.

   An outline here replaces that park's wall outright. Every point is a corner
   the wall actually turns at, so the engine joins them with straight runs
   rather than smoothing them (see `authored` in park.js), and each carries its
   own height so a wall that changes partway along does it in the right place.

   The bar for adding one: the park must fail the fair-territory check in
   scripts/build_parks.py by enough that the shape, not the measurement, is
   clearly what is wrong -- and the outline must be built from published
   landmarks, not from tuning numbers until the area matches.
--------------------------------------------------------------------------- */

/* FENWAY PARK

   Built from the Monster's own geometry rather than from the power-alley
   numbers, and the two agree, which is what makes it trustworthy:

   The Green Monster is a straight wall 231 ft long, and it runs from the left
   field pole at 310 ft to the center field corner at 379 ft. Three sides of a
   triangle with home plate, so the corner's angle follows from the law of
   cosines alone -- 37.5 degrees off the foul line, which puts it at theta
   -7.5, nearly in dead center. That is not a fitted number, it is forced.

   Two independent checks on it:

     · the wall that reconstruction implies is 230.9 ft long against the
       published 231 -- a tenth of a foot, from distances measured to the foot
     · it crosses theta -22.5 at 330 ft, where the sheet lists 335 as an
       estimate. The sheet's own estimate of the left-center distance falls out
       of the Monster's length, which nothing in the construction used.

   What does NOT agree is the area. This outline encloses 98.6k sq ft of fair
   territory against the sheet's listed 105.5k, and no plausible wall through
   Fenway's published landmarks reaches 105.5k. The sheet would make Fenway
   roomier than Citizens Bank Park and Guaranteed Rate Field; every account of
   the place has it as the smallest outfield in the majors, which 98.6k makes it
   by a distance. The geometry is left as the landmarks give it and the
   disagreement is reported rather than tuned away.

   Heights: the Monster is 37 ft to its far corner, the center field wall 18,
   and right field is the low 5 ft fence around to the pole. */
const FENWAY = {
  fence: [
    { theta: -45, distance: 310, height: 37 }, // left field pole, base of the Monster
    { theta: -7.5, distance: 379, height: 37 }, // the Monster's far corner
    { theta: 0, distance: 390, height: 18 }, // center field
    { theta: 9, distance: 420, height: 17 }, // the triangle -- the deepest point
    { theta: 22.5, distance: 378, height: 5 },
    { theta: 45, distance: 302, height: 5 }, // Pesky's Pole
  ],
};

export const OUTLINES = {
  fenwaypark: FENWAY,
};
