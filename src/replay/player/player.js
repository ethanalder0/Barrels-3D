/* ---------------------------------------------------------------------------
   PLAYERS — the batter and the pitcher, on the same clock as the ball.
   ---------------------------------------------------------------------------
   One GLB carries one character, one 65-bone skeleton and six clips (see
   assets/animations/ and the build notes in the README). Both players are
   clones of it: cloning a skinned mesh needs SkeletonUtils, because a plain
   Object3D.clone() copies the meshes but leaves them bound to the ORIGINAL
   skeleton, so two players share one pose and move as one.

   UNITS. The GLB is exported in metres — deliberately, because baking a scale
   into an armature does not rescale the translation curves inside its
   animations, and a rig scaled in Blender plays back with its feet sliding.
   The conversion happens here instead, where it is one multiply.

   CLOCK. Nothing here runs a timer. `update(playhead)` is handed the play's own
   clock by the engine, which is what keeps a swing landing on contact no matter
   what the pitch is doing to playback speed (see engine.js rateAt).
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { attachBat } from './bat.js';
import { batterStance, pitcherStance } from './stance.js';
import { CLOTH, paintNumberPanel, palette } from './uniform.js';

const MODEL_URL = '/models/player.glb';

/* Metres to feet, times a trim to a plausible ballplayer. The character is
   1.809 m at export (5.94 ft), which is close enough that the trim is 1. */
const M_TO_FT = 3.28084;
const HEIGHT_TRIM = 1.0;
const SCALE = M_TO_FT * HEIGHT_TRIM;

/* Where the players stand and which way they point lives in stance.js, which
   exists to be edited. Re-exported so callers have one import to reach for. */
export { batterStance, pitcherStance, BATTER, PITCHER } from './stance.js';

/* Which clip plays for a given outcome. Every batted ball is a swing that
   connected; a strikeout swinging is the one that did not. */
export const CLIPS = {
  batterIdle: 'batter_idle',
  batterHit: 'batter_hit',
  /* The same swing as batter_hit, frame for frame, cut at frame 40 before the
     run to first begins (assets/animations/lefty_hit.fbx). A left-hander is a
     mirrored right-hander, and a mirrored run to first is a run to THIRD — so
     a lefty takes this one and finishes in his follow-through instead. */
  batterHitLefty: 'batter_hit_lefty',
  batterHomerun: 'batter_homerun',
  batterMiss: 'batter_swing_miss',
  pitcherIdle: 'pitcher_idle',
  pitcherPitch: 'pitcher_pitch',
};

/* ---------------------------------------------------------------------------
   THE MOMENT INSIDE EACH CLIP

   A swing is only right if the bat meets the ball at the instant the ball is
   met. These are seconds from the start of each clip to that instant, and they
   are MEASURED, not eyeballed. Re-measure if a clip is replaced.

   THE SWINGS ARE MEASURED OFF THE BAT, which is the second time of asking. The
   first used peak hand speed, and the hands peak AFTER contact — the barrel is
   still accelerating through the ball while they start to slow. Taking the
   hands put batter_hit 73 ms early, which on screen is the ball leaving before
   the bat arrives: the lag you could see.

   So each swing is stepped at 240 Hz with the bat attached (bat.js) and the
   moment taken where the sweet spot — six inches in from the end — passes
   closest to the plate. Both readings of that agree to within 4 ms, and the
   clips disagree with the old hand-speed numbers by -55 to +73 ms:

     clip                 contact   sweet spot passes      was (hands)
     batter_hit           1.073 s   0.34 ft from the plate   1.000 s
     batter_homerun       1.412 s   0.07 ft                  1.467 s
     batter_swing_miss    1.179 s   0.12 ft                  1.300 s
     pitcher_pitch        1.633 s   peak hand speed          1.633 s

   The pitch keeps its hand-speed measurement: a ball IS released at the top of
   the hand's speed, so for a throw the thing that was wrong about the swings is
   exactly right.

   Everything on the play's clock is an absolute time — release at
   path.releaseTime, contact at path.contactTime — so both players are driven by
   offsetting their clip against those instants rather than by starting them and
   hoping.
--------------------------------------------------------------------------- */
export const MOMENT = {
  [CLIPS.batterHit]: 1.073,
  [CLIPS.batterHitLefty]: 1.073, // identical to batter_hit up to its last frame
  [CLIPS.batterHomerun]: 1.412,
  [CLIPS.batterMiss]: 1.179,
  [CLIPS.pitcherPitch]: 1.633,
};

let modelPromise = null;

/** The GLB, fetched and parsed once however many players ask for it. */
function loadModel(url = MODEL_URL) {
  if (!modelPromise) {
    modelPromise = new Promise((resolve, reject) => {
      new GLTFLoader().load(url, resolve, undefined, (e) =>
        reject(new Error(`player model failed to load: ${e?.message ?? url}`)),
      );
    });
  }
  return modelPromise;
}

/**
 * One player: a clone of the character, its own mixer, its own uniform.
 *
 * `kind` is 'batter' or 'pitcher' and only decides which clips it reaches for;
 * the mesh and skeleton are identical.
 */
class Player {
  constructor(gltf, kind) {
    this.kind = kind;
    this.root = new THREE.Group();
    this.root.name = `player-${kind}`;

    this.model = cloneSkinned(gltf.scene);
    this.model.scale.setScalar(SCALE);
    this.root.add(this.model);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = new Map();
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip, this.model);
      action.clampWhenFinished = true;
      this.actions.set(clip.name, action);
    }

    this.current = null;

    /* Materials by region, as the names Blender exported them (see uniform.js
       for why the kit is materials rather than a texture).

       A LIST per region, not one material: the body and the joint shells are
       two meshes, and both carry a region_jersey, a region_sleeve and so on -
       the shells are what fill the gaps at the elbow and the knee, so they have
       to take the colour of whatever they join. Keeping a single material per
       region would leave every shell the colour it was exported with.

       Cloned per player, because two clones of one GLB otherwise share material
       instances and dressing the batter would dress the pitcher to match. */
    this.byRegion = new Map();
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;   // a skinned bounding box is the bind pose, not the swing
      const source = Array.isArray(o.material) ? o.material[0] : o.material;
      const region = source?.name ?? 'region_skin';
      const mat = new THREE.MeshStandardMaterial({
        color: 0xcccccc,
        // A batting helmet is glossy plastic; everything else is cloth or skin.
        roughness: region === 'region_helmet' ? 0.32 : 0.88,
        metalness: 0,
        side: CLOTH.has(region) ? THREE.DoubleSide : THREE.FrontSide,
        /* A double-sided material casts from both faces by default, and the
           front face then shadows itself: contour rings all over the cloth.
           Casting from the back face only is what every single-sided
           material here already does. */
        shadowSide: THREE.BackSide,
      });
      mat.name = `${kind}:${region}:${o.name}`;
      o.material = mat;
      if (!this.byRegion.has(region)) this.byRegion.set(region, []);
      this.byRegion.get(region).push(mat);
    });

    /* Headwear. The GLB carries both a cap and a batting helmet, each skinned
       to the head bone; the pitcher wears the cap and the batter the helmet.
       The helmet's ear flap is on the model's left, which faces the pitcher for
       a right-handed batter — and a left-hander is the mirror image of him (see
       place()), so the flap moves to the other ear with no extra work. */
    const cap = this.model.getObjectByName('Cap');
    const helmet = this.model.getObjectByName('Helmet');
    if (cap) cap.visible = kind !== 'batter';
    if (helmet) helmet.visible = kind === 'batter';

    /* Only the batter carries one. It is parented to a hand bone rather than
       posed each frame, so it follows the swing at no cost and inherits a
       left-hander's mirror along with the rest of him. */
    this.bat = kind === 'batter' ? attachBat(this.model) : null;
  }

  /**
   * Put this player in a club's kit. Safe to call again when the game changes.
   *
   * Synchronous, unlike the first version: with the kit as materials there is
   * nothing to fetch and nothing to decode. Only the number panel builds a
   * texture, and only when the feed actually gave us a number.
   */
  setUniform(abbr, { side = 'home', number = null, mirrored = false } = {}) {
    const key = `${abbr}|${side}|${number}|${mirrored ? 'm' : ''}`;
    if (key === this.uniformKey) return;
    this.uniformKey = key;

    const pal = palette(abbr, side);
    for (const [region, materials] of this.byRegion) {
      const hex = pal[region];
      for (const material of materials) {
        if (hex) material.color.set(hex);
        material.map = null;
      }
    }

    this.numberTexture?.dispose();
    this.numberTexture = null;

    const panel = paintNumberPanel(abbr, { side, number, mirrored });
    const back = this.byRegion.get('region_jersey_back');
    if (panel && back?.length) {
      const texture = new THREE.CanvasTexture(panel);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;    // glTF uv origin is top-left
      texture.channel = 1;      // the number panel's own unwrap, not the stacked atlas
      texture.anisotropy = 8;
      for (const material of back) {
        material.map = texture;
        material.color.set(0xffffff); // the panel already carries the cloth colour
      }
      this.numberTexture = texture;
    }
    for (const materials of this.byRegion.values()) {
      for (const material of materials) material.needsUpdate = true;
    }
  }

  /**
   * Place the player.
   *
   * `facing` is a rotation about Y in radians, and `mirror` reflects the model
   * so a right-handed clip reads as a left-hander — see stance.js for why a
   * rotation will not do it.
   *
   * The reflection goes on the MODEL, inside the root's rotation, which is what
   * makes the whole transform a true mirror of the right-handed one: the chain
   * is translate x rotate x scale, and reflecting after the rotation is the
   * same as reflecting the finished right-hander across the plate's centre
   * line. Reflecting the root instead would mirror the position too and put
   * him back in the box he came from.
   */
  place({ x = 0, y = 0, z = 0, facing = 0, mirror = false } = {}) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = facing;
    this.model.scale.set(mirror ? -SCALE : SCALE, SCALE, SCALE);
    this.mirrored = !!mirror;
  }

  /**
   * Take the player off the field, or put him back.
   *
   * A plate appearance ends and the batter is gone — he struck out, or he is
   * on first. Leaving him standing in the box while the screen cuts back to the
   * empty zone is the one thing that reads as a bug rather than as a replay,
   * because the feed has already said he is out.
   */
  setVisible(visible) {
    this.root.visible = !!visible;
  }

  /**
   * Cross-fade to a clip.
   *
   * `hold` leaves the last frame standing instead of looping, which is what a
   * swing wants — it ends in a follow-through and should stay there rather than
   * snapping back to a stance the play has moved past.
   */
  play(name, { fade = 0.18, hold = false, from = 0 } = {}) {
    const next = this.actions.get(name);
    if (!next || next === this.current) return next;

    next.reset();
    next.setLoop(hold ? THREE.LoopOnce : THREE.LoopRepeat, hold ? 1 : Infinity);
    next.clampWhenFinished = hold;
    next.time = from;
    next.enabled = true;
    next.setEffectiveWeight(1);

    if (this.current) next.crossFadeFrom(this.current, fade, false);
    next.play();
    this.current = next;
    return next;
  }

  /** Park a clip at an exact time, for scrubbing rather than playing. */
  seek(name, t) {
    const action = this.actions.get(name);
    if (!action) return;
    if (action !== this.current) {
      this.current?.stop();
      action.reset().play();
      this.current = action;
    }
    action.paused = true;
    action.time = Math.max(0, Math.min(action.getClip().duration, t));
    this.mixer.update(0);
  }

  update(dt) {
    this.mixer.update(dt);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.numberTexture?.dispose();
    if (this.bat) {
      this.bat.geometry.dispose();
      this.bat.material.dispose();
      this.bat.removeFromParent();
    }
    for (const materials of this.byRegion.values()) {
      for (const material of materials) {
        material.map?.dispose();
        material.dispose();
      }
    }
    this.root.removeFromParent();
  }
}

/**
 * Build the batter and the pitcher.
 *
 * Resolves once the model is in; the caller adds `group` to the scene and calls
 * update() from its own loop. Throws nothing on a missing model — a replay
 * without characters is the engine's existing behaviour and better than a
 * black viewport.
 */
export async function createPlayers() {
  const gltf = await loadModel();
  const group = new THREE.Group();
  group.name = 'players';

  const batter = new Player(gltf, 'batter');
  const pitcher = new Player(gltf, 'pitcher');
  group.add(batter.root, pitcher.root);

  // Right-handed until an at-bat says otherwise; the engine re-places both on
  // every load from the at-bat's own batSide / pitchHand.
  batter.place(batterStance('R'));
  pitcher.place(pitcherStance('R'));
  batter.play(CLIPS.batterIdle);
  pitcher.play(CLIPS.pitcherIdle);

  return {
    group,
    batter,
    pitcher,
    clips: gltf.animations.map((a) => ({ name: a.name, duration: +a.duration.toFixed(3) })),
    update(dt) {
      batter.update(dt);
      pitcher.update(dt);
    },
    dispose() {
      batter.dispose();
      pitcher.dispose();
      group.removeFromParent();
    },
  };
}
