/* ---------------------------------------------------------------------------
   STANCE — where the players stand, and which way they point.
   ---------------------------------------------------------------------------
   EDIT THIS FILE TO MOVE OR TURN A PLAYER. Nothing else needs touching, and
   nothing else should hold a position or an angle for a player.

   Angles are in DEGREES because they are meant to be typed by hand and nudged
   until they look right. Distances are in FEET, like everything else in the
   engine (see field/spec.js).

   THE AXES, so a number can be changed on purpose rather than by trial:

     · home plate's back point is the origin
     · -Z is centre field, so the pitcher is at about z = -60
     · +X is the first-base side, -X is the third-base side
     · +Y is up

   WHICH WAY IS `facing`

   `facing` rotates the player about Y. The character models face +Z when
   unrotated, and +Z points from centre field back toward home plate — so:

       facing =    0   looking toward home plate     (+Z)
       facing =  180   looking out to centre field   (-Z)
       facing =   90   looking toward first base     (+X)
       facing =  -90   looking toward third base     (-X)

   The pitcher stands out at z = -60 and looks in at the plate, so he is 0.

   A batter does not face the pitcher: he stands side-on with his chest toward
   the plate. A right-hander works from the third-base side (-X) and therefore
   faces +X, which is +90.

   MIRRORING, and why a left-hander is not just a rotation

   All the batting clips are right-handed swings. Turning one 180 degrees puts
   the batter in the left-hand box but has him swinging AWAY from the plate,
   because a rotation preserves handedness and a swing direction is handedness.
   A left-hander is the MIRROR IMAGE of a right-hander, so `mirror: true`
   negates the model's X scale, which reverses the swing with it.

   Three.js handles the consequences of a negative scale on its own: it flips
   the winding order for the depth of the render, and the normal matrix is an
   inverse transpose, so the lighting stays correct.

   The one thing a mirror gets wrong is anything with writing on it, which is
   why paintNumberPanel() takes a `mirrored` flag and pre-flips the canvas —
   mirrored twice is the right way round. See uniform.js.
--------------------------------------------------------------------------- */

import * as S from '../field/spec.js';

/** Degrees to radians, so the constants above can be written as degrees. */
export const rad = (deg) => (deg * Math.PI) / 180;

/* The batter's box is 4 ft wide and starts 6 in off the plate, which puts its
   centre a bit over 3 ft from the middle of the plate. Nobody stands in the
   middle of their box, though — they crowd the plate — so `crowd` is how far
   in from the box's centre the player actually sets up, as a fraction. */
const BOX_CENTRE_X =
  S.PLATE_WIDTH / 2 + S.BATTERS_BOX.offsetFromPlate + S.BATTERS_BOX.width / 2;

export const BATTER = {
  /* How far from the middle of the plate, in feet. Larger = further away.
     Raise it if the batter is standing on top of the plate, lower it if he
     looks like he could not reach a strike. */
  distanceFromPlate: BOX_CENTRE_X * 0.95,

  /* Fore and aft within the box, in feet. NEGATIVE is toward the pitcher,
     positive is deeper in the box toward the catcher. */
  depth: S.PLATE_CENTER_Z - 0.4,

  /* Which way each side points, in degrees. See the note above: +90 looks
     toward first base, -90 toward third. A right-hander stands on the third
     base side and faces across the plate, so he is +90 and the left-hander is
     his mirror at -90. Nudge these together to open or close both stances. */
  facingRight: 180,
  facingLeft: -180,

  /* Left-handed batting clips do not exist — every clip is a right-handed
     swing — so the left-hander is drawn as a mirror of one. Set this false
     only if you supply genuinely left-handed animations, in which case the
     stance becomes a plain rotation and the number needs no pre-flip. */
  mirrorLefties: true,
};

export const PITCHER = {
  /* Along the rubber, in feet. 0 is the middle; a real pitcher works from one
     side of it depending on his handedness and the hitter. */
  alongRubber: 0,

  /* The rubber itself is fixed by the rulebook, so this is an offset from it
     rather than an absolute: negative moves him toward second base. */
  depthOffset: 0,

  /* Facing the plate, which is 0: he is out at z = -60 looking back along +Z
     toward home. */
  facing: 0,

  /* Same reasoning as the batter: the pitching clip is right-handed, so a
     left-hander is drawn as its mirror. */
  mirrorLefties: true,
};

/** The batter's placement for a side ('R' or 'L'). */
export function batterStance(batSide) {
  const lefty = batSide === 'L';
  return {
    x: lefty ? BATTER.distanceFromPlate : -BATTER.distanceFromPlate,
    y: 0,
    z: BATTER.depth,
    facing: rad(lefty ? BATTER.facingLeft : BATTER.facingRight),
    mirror: lefty && BATTER.mirrorLefties,
  };
}

/** The pitcher's placement for a throwing hand ('R' or 'L'). */
export function pitcherStance(pitchHand) {
  const lefty = pitchHand === 'L';
  return {
    x: PITCHER.alongRubber,
    // The mound is real geometry, so standing him at y = 0 buries his ankles.
    y: S.MOUND_HEIGHT,
    z: -(S.RUBBER_FRONT + S.RUBBER_DEPTH / 2) + PITCHER.depthOffset,
    facing: rad(PITCHER.facing),
    mirror: lefty && PITCHER.mirrorLefties,
  };
}
