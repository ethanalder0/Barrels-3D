/* ---------------------------------------------------------------------------
   THE BAT — turned, not modelled.
   ---------------------------------------------------------------------------
   A bat is a solid of revolution: a profile of radius against length, spun
   about its own axis. So it is built here from that profile rather than
   authored as an asset, for the same reason the mound is real geometry and the
   playing surface is painted (see field/layout.js) — the dimensions are the
   description, and a lathe reproduces them exactly where a modelled bat would
   be somebody's recollection of one.

   RULEBOOK: no more than 2.61 in in diameter at the thickest part and no more
   than 42 in long. Nobody swings the maximum; 34 in and 2.5 in is an ordinary
   big-league bat and is what these default to.

   HOW IT IS HELD

   The bat is parented to the TOP hand's bone, so it follows the swing for free
   and needs no per-frame work — and because it hangs inside the model, a
   left-hander's mirrored scale mirrors the bat with him (see stance.js).

   Two things have to be right for it to sit in the hands: which way it points,
   and where across the palm it lies. Both are MEASURED off the rig, in the top
   hand's own local space, where they come out as constants instead of curves.

   DIRECTION. Not the line between the wrists — that was the first guess and it
   is about 70 degrees off, because a wrist bone sits at the base of the hand
   while the bat runs through the fingers. The giveaway is the KNUCKLE ROW:
   with a fist closed round a shaft, the four metacarpal heads lie along it.
   The two fists' knuckle rows are parallel to within 1.3 degrees in every clip
   at every frame sampled, which is what you get when both hands hold one
   straight object, and the row is fixed in hand space because the finger pose
   is baked.

   SEAT. The shaft is the cylinder the fingers wrap around, so it was fitted:
   all 32 finger joints of both hands projected onto the plane across that axis
   and a least-squares circle taken through them. The centre lands 2.5 in into
   the hand from the wrist and barely moves across the swing (2.4 to 2.7 in).

   LENGTH ALONG THE GRIP. Projected onto the axis, the top fist spans -1.2 to
   +2.5 in about that seat and the bottom fist -4.5 to -1.1 in: adjacent and
   not overlapping, which is a proper two-handed grip. The knob goes just past
   the bottom of the lower fist.

   UNITS. Bone space carries Mixamo's centimetres, so one bone-local unit is
   0.0328 ft. The bat is built in FEET at true size and then divided by the
   bone's own world scale, which keeps it correct if the character is ever
   rescaled.
--------------------------------------------------------------------------- */

import * as THREE from 'three';

const IN = 1 / 12; // one inch, in feet — same convention as field/spec.js

/* ---------------------------------------------------------------------------
   TUNABLES — edit these to change the bat or how it sits in the hands.
--------------------------------------------------------------------------- */
export const BAT = {
  /** Overall length, inches. The rulebook's ceiling is 42. */
  lengthIn: 34,

  /** Barrel diameter at the thickest point, inches. The ceiling is 2.61. */
  barrelDiameterIn: 2.5,

  /** Handle diameter, inches. */
  handleDiameterIn: 0.94,

  /** The knob at the very bottom, inches across. */
  knobDiameterIn: 1.9,

  /** Which hand carries it. For a right-hander this is the upper hand. */
  bone: 'mixamorigRightHand',

  /**
   * Which way the barrel points, in that hand's local space — the knuckle row,
   * measured (see above). Normalised on use, so only the ratio matters.
   *
   * For bearings while nudging it: in this hand's space +Y runs out toward the
   * fingertips and +X from the pinky side across toward the thumb, so the bat
   * lies very nearly along +X.
   */
  axis: [0.986, 0.168, 0.005],

  /**
   * Where the shaft crosses the hand, in INCHES in that same local space,
   * measured from the wrist bone. Mostly +Y: the bat rides across the palm,
   * it does not pass through the wrist joint.
   *
   * Raise the middle number to push it out toward the knuckles, lower it to
   * pull it back into the palm.
   */
  seatIn: [-0.43, 2.5, 0.2],

  /**
   * How far the knob sits back down the grip from that seat, in inches. The
   * bottom fist ends about 4.5 in down, so this leaves the knob just past it.
   */
  knobFromGripIn: 5.2,

  /**
   * Extra rotation about the grip axis, in degrees. Purely cosmetic: it spins
   * the bat in the hands and only shows once a bat has a label on it.
   */
  rollDeg: 0,

  /** Ash, roughly. The barrel end is a touch darker, as a finished bat is. */
  wood: '#c49a6c',
  knobWood: '#a87f52',
};

/**
 * The bat's silhouette, as [distance from the knob, radius], both in inches.
 *
 * Read down the list to see the shape: a knob, a thin handle, the long taper
 * out to the barrel, then a cupped end. The lathe closes the ends itself.
 */
function profileInches() {
  const rBarrel = BAT.barrelDiameterIn / 2;
  const rHandle = BAT.handleDiameterIn / 2;
  const rKnob = BAT.knobDiameterIn / 2;
  const L = BAT.lengthIn;

  return [
    [0.0, 0.0],
    [0.0, rKnob * 0.72],
    [0.25, rKnob],
    [0.7, rKnob * 0.86],
    [1.1, rHandle * 1.06],
    [L * 0.24, rHandle],
    [L * 0.42, rHandle * 1.22],
    [L * 0.58, rHandle * 1.72],
    [L * 0.72, rBarrel * 0.87],
    [L * 0.82, rBarrel],
    [L * 0.97, rBarrel],
    [L - 0.25, rBarrel * 0.94],
    [L, rBarrel * 0.72],   // the cup at the end
    [L, 0.0],
  ];
}

/** The bat mesh, in feet, lying along its own +Y with the knob at the origin. */
export function makeBat() {
  const points = profileInches().map(([y, r]) => new THREE.Vector2(r * IN, y * IN));
  const geometry = new THREE.LatheGeometry(points, 24);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(BAT.wood),
      roughness: 0.55,
      metalness: 0,
    }),
  );
  mesh.name = 'bat';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Hang a bat in a character's hands.
 *
 * `model` is the cloned glTF scene. Returns the mesh, or null when the hand
 * bone is missing — a replay without a bat is better than one that throws.
 */
export function attachBat(model) {
  let hand = null;
  model.traverse((o) => {
    if (!hand && o.isBone && o.name === BAT.bone) hand = o;
  });
  if (!hand) {
    console.warn(`[bat] no bone named ${BAT.bone}; the batter goes without`);
    return null;
  }

  const bat = makeBat();

  /* Bone space is Mixamo centimetres scaled by the model, so the bat — built in
     feet — has to be divided by whatever that came to. Taken from the matrix
     rather than assumed, so rescaling the character cannot silently resize the
     bat. A mirrored player has a negative scale here; its magnitude is what
     matters, and the sign is left to the parent so the bat mirrors with him. */
  hand.updateWorldMatrix(true, false);
  const scale = new THREE.Vector3();
  hand.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
  const perUnit = Math.abs(scale.x) || 1;

  /* Feet into this bone's units, which is what every length below needs: the
     tunables are inches and the bone is centimetres. */
  const toUnits = (feet) => feet / perUnit;

  bat.scale.setScalar(toUnits(1));

  const axis = new THREE.Vector3(...BAT.axis).normalize();
  bat.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  if (BAT.rollDeg) {
    bat.quaternion.multiply(
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        (BAT.rollDeg * Math.PI) / 180,
      ),
    );
  }

  /* Start at the seat — across the palm rather than at the wrist — then run
     back down the grip to put the knob below the bottom hand. */
  const seat = BAT.seatIn.map((inches) => toUnits(inches * IN));
  bat.position.set(seat[0], seat[1], seat[2]);
  bat.position.addScaledVector(axis, -toUnits(BAT.knobFromGripIn * IN));

  hand.add(bat);
  return bat;
}
