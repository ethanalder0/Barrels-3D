/* ---------------------------------------------------------------------------
   UNIFORMS — a club's kit, as colours rather than cloth.
   ---------------------------------------------------------------------------
   Thirty clubs, home and away, is sixty uniforms. Authored as textures that is
   sixty files to regenerate every time a club changes a colour, and every one
   of them the same image with different fills. Everything a kit needs is
   already in src/data/teams.js — `primary`, `secondary`, and `ink`, which the
   asset generator guarantees reads on a light ground.

   WHY MATERIALS AND NOT A TEXTURE

   The first version of this painted one texture per club and looked the region
   up per texel from a mask baked off the mesh. That cannot work on this
   character, and the reason is worth writing down so nobody tries it again:
   its UV atlas is STACKED. Measured on the exported mesh, the hand islands
   alone cover 92% of the atlas and collide with every other region at 93-100%;
   even the jersey and the trousers share 42% of their texels. Solo coverages
   sum to 181% of the available space. Two regions that share a texel cannot be
   given two colours, so a per-texel kit was never going to be possible.

   So each region is its own MATERIAL instead, assigned per face in Blender and
   exported as its own glTF primitive. A material needs no UVs at all, which
   makes the whole question moot, and a flat colour is exactly what a uniform
   panel is. Ten primitives per player costs nothing.

   THE CLOTHES ARE REAL GEOMETRY. The jersey, the trousers, the belt, the cap
   and the helmet are their own skinned meshes over the body, built in
   player_build.blend and bound to the same skeleton; the body under them has
   been cut away so nothing pokes through in a swing. They carry the same
   region_* material names, so this palette colours them exactly as it
   coloured the painted body before. The cap and the helmet are both in the
   GLB — the player decides which one is worn (see player.js).

   THE NUMBER is the one thing that genuinely needs a texture, and therefore the
   one thing that needed usable UVs. The back-of-jersey faces get their own
   projection in Blender — straight on from behind, normalised over that panel's
   own extent — exported as TEXCOORD_1 and read only by the jersey_back
   material. That panel is the only place a texture is sampled.
--------------------------------------------------------------------------- */

import { teamFor } from '../../data/teams.js';

/** The material names baked into player.glb, one per region. */
export const MATERIALS = [
  'region_skin', 'region_jersey', 'region_jersey_back', 'region_cap',
  'region_face', 'region_sleeve', 'region_forearm', 'region_pants',
  'region_sock', 'region_shoe', 'region_hand', 'region_joints',
  'region_belt', 'region_helmet',
];

/* The regions that are loose cloth rather than body. They are single sheets
   with open hems — you can see into a sleeve, up a trouser cuff, down the
   collar — so they are drawn from both sides. */
export const CLOTH = new Set([
  'region_jersey', 'region_jersey_back', 'region_pants',
]);

/* Skin, and the parts no club colours. Deliberately neutral — this character
   has no real head yet, and a saturated guess at a complexion reads worse than
   an obvious placeholder. */
const SKIN = '#b98a63';
const SHOE = '#1c1c1e';
const JOINTS = '#3a3a3e';

/**
 * A club's kit, as a colour per material.
 *
 * Home is white and away is grey, as they really are, and the club's colour
 * arrives on the cap, the sleeves and the socks. That is both accurate and the
 * only thing that reads at replay distance, where a crest would be four pixels
 * across and the silhouette is most of what you have to go on.
 */
export function palette(abbr, side = 'home') {
  const t = teamFor(abbr);
  const primary = t?.primary ?? '#2b2b2b';
  const secondary = t?.secondary ?? '#8a8a8a';
  /* Home white, road grey — jersey and trousers alike. The grey is a real
     road grey, not a tint: a lighter one (#c9ccd1 was tried) reads as white
     under the stadium light, and then both sides look like the home team. */
  const cloth = side === 'away' ? '#9fa4ab' : '#f4f4f2';

  return {
    region_skin: SKIN,
    region_face: SKIN,
    region_hand: SKIN,
    region_forearm: SKIN,
    region_jersey: cloth,
    region_jersey_back: cloth,
    region_pants: cloth,
    region_cap: primary,
    region_helmet: primary,
    region_belt: primary,
    region_sleeve: primary,
    region_sock: secondary,
    region_shoe: SHOE,
    region_joints: JOINTS,
  };
}

/* The number panel. Square, and small — it covers one flat piece of cloth, so
   there is nothing here that wants resolution. */
const PANEL = 512;

/**
 * The back of the jersey, with the squad number on it.
 *
 * Returns a canvas for the jersey_back material's map. The whole panel is
 * filled with the jersey colour first: this texture IS the back of the shirt,
 * not a decal over it, so anywhere the number is not is simply cloth.
 *
 * Returns null when there is no number to draw, and the caller then leaves the
 * material a flat colour — a blank back is the honest result when the feed has
 * not told us the number, and better than inventing one for a real player.
 *
 * `mirrored` is for a left-handed player, who is drawn as a mirror image of the
 * right-handed model (see stance.js). A mirror reverses everything on him,
 * including his number, so the digits are drawn BACKWARDS here and the model's
 * own mirror turns them the right way round. Flipped twice is forwards.
 */
export function paintNumberPanel(
  abbr,
  { side = 'home', number = null, mirrored = false } = {},
) {
  if (number == null || number === '') return null;

  const t = teamFor(abbr);
  const pal = palette(abbr, side);
  const canvas = document.createElement('canvas');
  canvas.width = PANEL;
  canvas.height = PANEL;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = pal.region_jersey_back;
  ctx.fillRect(0, 0, PANEL, PANEL);

  // Pre-flip, so the model's mirror cancels it and the number reads forwards.
  if (mirrored) {
    ctx.translate(PANEL, 0);
    ctx.scale(-1, 1);
  }

  const text = String(number);
  // `ink` is generated to clear 4.5:1 on a light ground, which is precisely the
  // problem a number on a white jersey has. On grey away cloth the club's own
  // primary has the contrast to carry it.
  ctx.fillStyle = side === 'away' ? (t?.primary ?? '#1b1b1b') : (t?.ink ?? '#1b1b1b');
  ctx.strokeStyle = t?.secondary ?? '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  /* Large on purpose. The panel is only ~26 cm across on the model and the
     arms cover most of it from the side, so a number sized like a real one is
     unreadable at any camera this engine uses. Filling the panel is the only
     way it reads at all. */
  const size = text.length > 1 ? PANEL * 0.62 : PANEL * 0.78;
  ctx.font = `700 ${Math.round(size)}px "Barlow Condensed", Archivo, sans-serif`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * 0.07);

  const cy = PANEL * 0.5;
  ctx.strokeText(text, PANEL / 2, cy);
  ctx.fillText(text, PANEL / 2, cy);

  return canvas;
}
