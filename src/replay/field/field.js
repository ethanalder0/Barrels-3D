/* ---------------------------------------------------------------------------
   FIELD — the ground, and everything standing on it.
   ---------------------------------------------------------------------------
   The playing surface is one textured plane (see layout.js for why). This file
   adds the parts that have actual shape:

     · the mound, a displaced disc sitting in the painted dirt circle
     · home plate, the bases and the rubber
     · the outfield fence, foul walls and backstop, as one ribbon
     · the foul poles

   Every mesh is positioned from spec.js for the rulebook geometry and from the
   park passed to buildField() for everything that differs between ballparks —
   the wall's shape and height, the backstop, the foul ground, the sun. No
   dimension is written here.
--------------------------------------------------------------------------- */

import * as THREE from 'three';
import * as S from './spec.js';
import { fieldCanvas, fadeEdges } from './layout.js';
import { createPark } from './park.js';

const X_MIN = -S.GROUND.span / 2;
const Z_MAX = S.GROUND.centerZ + S.GROUND.span / 2;

/* The ground texture's uv at a world point. The mound reuses it so its dirt is
   continuous with the circle painted underneath. */
const uvOf = (x, z) => [(x - X_MIN) / S.GROUND.span, (Z_MAX - z) / S.GROUND.span];

/** Anything painted flat on top of the ground needs this, or it z-fights. */
const decal = (material) => {
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  return material;
};

/* --- The playing surface ------------------------------------------------ */

function buildGround(park) {
  const texture = new THREE.CanvasTexture(fieldCanvas(S.GROUND.texture, undefined, park));
  // The painter puts world z = +60 on the canvas's top row, and PlaneGeometry
  // puts uv v = 0 at the -Y edge, which this plane's rotation maps to that same
  // z. Without flipY = false the whole field paints back-to-front.
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(S.GROUND.span, S.GROUND.span),
    new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.z = S.GROUND.centerZ;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return { mesh, texture };
}

/**
 * A second, sharper copy of the surface over the home-plate area.
 *
 * The base texture spreads 4096 px across 520 ft — about 8 px per foot, which
 * is plenty from any camera looking at the field and nowhere near enough from
 * the catcher's view, where the eye is eight feet off the ground and the
 * batter's-box chalk turns into blocks. This paints the same layout over a
 * 64 ft square at the same pixel count: 32 px per foot, four times sharper,
 * for one extra texture.
 *
 * It stops short of the mound on purpose. The mound is its own mesh sampling
 * the base texture, and running the detail patch under it would put a visible
 * step in sharpness right at the mound's rim.
 */
const DETAIL_REGION = { centerX: 0, centerZ: -14, span: 64 };

function buildDetail(park) {
  const texture = new THREE.CanvasTexture(
    fadeEdges(fieldCanvas(2048, DETAIL_REGION, park)),
  );
  texture.flipY = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 16;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(DETAIL_REGION.span, DETAIL_REGION.span),
    decal(
      new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 1,
        metalness: 0,
        transparent: true, // the edge fade is what blends it into the base
      }),
    ),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(DETAIL_REGION.centerX, 0, DETAIL_REGION.centerZ);
  mesh.receiveShadow = true;
  mesh.name = 'ground-detail';
  return mesh;
}

/* --- The mound ---------------------------------------------------------- */

/**
 * A radial grid over the 18 ft circle, lifted by spec.moundHeight(). It shares
 * the ground's texture and uv mapping, so the dirt matches exactly and the rim
 * lands on the painted circle's edge with no visible seam.
 */
function buildMound(texture) {
  const RINGS = 28;
  const SEGMENTS = 96;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let i = 0; i <= RINGS; i++) {
    const r = (i / RINGS) * S.MOUND_RADIUS;
    for (let j = 0; j <= SEGMENTS; j++) {
      const a = (j / SEGMENTS) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const z = S.MOUND_CENTER_Z + Math.sin(a) * r;
      positions.push(x, S.moundHeight(x, z), z);
      uvs.push(...uvOf(x, z));
    }
  }
  // Wind counter-clockwise seen from above. The ring runs +X toward +Z as the
  // angle grows, which is clockwise from up there, so the obvious ordering
  // gives the whole mound downward normals and it renders as a dark blob.
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * (SEGMENTS + 1) + j;
      const b = a + SEGMENTS + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // The innermost ring is the peak, repeated once per segment at the same
  // point, so half its triangles are degenerate and their vertex normals come
  // back as zero — a black speck at the top of the mound. The surface is flat
  // up there, so straight up is the right answer.
  const normal = geometry.attributes.normal;
  for (let i = 0; i < normal.count; i++) {
    if (Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i)) < 1e-6) {
      normal.setXYZ(i, 0, 1, 0);
    }
  }

  const mesh = new THREE.Mesh(
    geometry,
    decal(new THREE.MeshStandardMaterial({ map: texture, roughness: 1, metalness: 0 })),
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'mound';
  return mesh;
}

/* --- Plate, bases, rubber ----------------------------------------------- */

function buildPlate() {
  // Shapes are built in XY and rotated onto the ground, where plane +Y becomes
  // world -Z — hence the sign on z.
  const shape = new THREE.Shape();
  S.PLATE_OUTLINE.forEach((p, i) =>
    i ? shape.lineTo(p.x, -p.z) : shape.moveTo(p.x, -p.z),
  );

  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    decal(new THREE.MeshStandardMaterial({ color: S.COLORS.base, roughness: 0.7 })),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.01; // home plate is set flush; this is just for depth
  mesh.name = 'home-plate';
  return mesh;
}

function buildBases() {
  const group = new THREE.Group();
  group.name = 'bases';
  const geometry = new THREE.BoxGeometry(S.BASE_SIDE, S.BASE_THICK, S.BASE_SIDE);
  const material = new THREE.MeshStandardMaterial({ color: S.COLORS.base, roughness: 0.6 });

  for (const [name, p] of Object.entries(S.basePositions())) {
    const bag = new THREE.Mesh(geometry, material);
    bag.position.set(p.x, S.BASE_THICK / 2, p.z);
    bag.rotation.y = S.BASE_ROTATION;
    bag.castShadow = true;
    bag.name = name;
    group.add(bag);
  }
  return group;
}

function buildRubber() {
  const THICK = 0.5;
  const PROUD = 0.5 * S.IN; // a real rubber sits a touch above the dirt
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(S.RUBBER_WIDTH, THICK, S.RUBBER_DEPTH),
    new THREE.MeshStandardMaterial({ color: S.COLORS.rubber, roughness: 0.6 }),
  );
  // Set into the level table, most of it buried. Sitting it exactly flush hides
  // it: the top face lands on the mound surface and z-fights out of existence.
  mesh.position.set(
    0,
    S.MOUND_HEIGHT + PROUD - THICK / 2,
    -(S.RUBBER_FRONT + S.RUBBER_DEPTH / 2),
  );
  mesh.castShadow = true;
  mesh.name = 'rubber';
  return mesh;
}

/* --- Walls -------------------------------------------------------------- */

/**
 * A vertical ribbon standing on a run of ground points.
 *
 * `bottom` and `top` may each be a number or a function of the ground point, so
 * one ribbon can carry a wall whose height changes along it — which every real
 * park's does, and Fenway's changes by 32 feet.
 */
function ribbon(points, bottom, top, material, name) {
  const at = (v, p) => (typeof v === 'function' ? v(p) : v);
  const positions = [];
  const indices = [];
  for (const p of points) {
    positions.push(p.x, at(bottom, p), p.z, p.x, at(top, p), p.z);
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

function buildWalls(park) {
  const group = new THREE.Group();
  group.name = 'walls';
  const line = park.boundary();
  const closed = [...line, line[0]];

  /* Wall height at a point on the boundary.
     In fair territory it is the park's, which may change along the wall. Past
     the foul poles it is the low side wall: a park's tall wall stops at its
     pole, and carrying Fenway's 37 ft round into foul ground would wall the
     third-base dugout in behind a Green Monster. */
  const heightAt = (p) => {
    const theta = S.thetaOf(p.x, p.z);
    return Math.abs(theta) <= 45 ? park.fenceHeight(theta) : S.FOUL_WALL_HEIGHT;
  };

  group.add(
    ribbon(
      closed,
      0,
      heightAt,
      new THREE.MeshStandardMaterial({
        color: S.COLORS.wall,
        roughness: 0.9,
        side: THREE.DoubleSide,
        /* A little light of its own. The backstop's field side faces away
           from the sun in most parks, and from the broadcast camera, which
           looks straight at it, it went black — a hole behind the plate
           rather than a dark padded wall. */
        emissive: S.COLORS.wall,
        emissiveIntensity: 0.45,
      }),
      'wall',
    ),
  );
  // The yellow cap along the top — the line a ball has to clear.
  group.add(
    ribbon(
      closed,
      (p) => heightAt(p) - 4 / 12,
      heightAt,
      new THREE.MeshStandardMaterial({
        color: S.COLORS.wallTop,
        roughness: 0.8,
        side: THREE.DoubleSide,
      }),
      'wall-cap',
    ),
  );

  for (const sign of [-1, 1]) {
    const at = S.polar(sign * 45, park.fenceDistance(sign * 45));
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, S.FOUL_POLE_HEIGHT, 12),
      new THREE.MeshStandardMaterial({ color: S.COLORS.wallTop, roughness: 0.6 }),
    );
    pole.position.set(at.x, S.FOUL_POLE_HEIGHT / 2, at.z);
    pole.name = sign < 0 ? 'foul-pole-left' : 'foul-pole-right';
    group.add(pole);
  }
  return group;
}

/* --- Lighting ----------------------------------------------------------- */

function buildLights(park) {
  const group = new THREE.Group();
  group.name = 'lights';

  // Sky fill kept low on purpose. Turn it up and the sun stops doing any work,
  // which flattens the one thing on this field that has relief — a 1 in per
  // foot mound only reads at all if the light rakes across it.
  const sky = new THREE.HemisphereLight(0xbcd6ff, 0x486b3a, 0.75);
  group.add(sky);

  /* Late afternoon. WHERE that is depends on which way the park faces, so the
     bearing lives on the park and this only places what it worked out — see
     SUN in park.js. A park turned ninety degrees from its neighbour gets its
     shadows turned with it, which is most of what tells two parks apart from
     the same seat. */
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.6);
  sun.position.set(park.sun.x, park.sun.y, park.sun.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const d = 220;
  sun.shadow.camera.left = -d;
  sun.shadow.camera.right = d;
  sun.shadow.camera.top = d;
  sun.shadow.camera.bottom = -d;
  sun.shadow.camera.far = 700;
  sun.target.position.set(0, 0, -120);
  group.add(sun, sun.target);

  /* The towers on the far side. At night the key light is a bank of lights
     high over the plate, and one source leaves the outfield side of every
     player black — a real park is lit from all round. No shadow: a second set
     of shadows from a fill reads as a bug, not as lighting. Off by day. */
  const towers = new THREE.DirectionalLight(0xdfe8ff, 0);
  towers.position.set(180, 300, -420);
  towers.target.position.set(0, 0, -60);
  group.add(towers, towers.target);

  /* Night game: the sun is replaced by the lights. The key keeps its shadow
     but moves high over home plate, where the main banks are, so shadows
     drop short and close to the feet the way they do under lights; the sky
     fill goes dim and cold, which is what darkens everything the lights
     are not pointed at. */
  const day = { sky: sky.intensity, sun: sun.intensity, sunAt: sun.position.clone() };
  group.userData.setNight = (night) => {
    sky.color.set(night ? 0x4a5d86 : 0xbcd6ff);
    sky.groundColor.set(night ? 0x16200f : 0x486b3a);
    sky.intensity = night ? 0.4 : day.sky;
    sun.color.set(night ? 0xf1f5ff : 0xfff2dc);
    sun.intensity = night ? 2.1 : day.sun;
    if (night) sun.position.set(-40, 420, 170);
    else sun.position.copy(day.sunAt);
    towers.intensity = night ? 0.7 : 0;
  };

  return group;
}

/* --- Assembly ----------------------------------------------------------- */

/** The whole field as one group, plus a dispose() that releases all of it. */
export function buildField(park = createPark()) {
  const group = new THREE.Group();
  group.name = 'field';
  group.userData.park = park;

  const ground = buildGround(park);
  group.add(ground.mesh);
  group.add(buildDetail(park));
  group.add(buildMound(ground.texture));
  group.add(buildPlate());
  group.add(buildBases());
  group.add(buildRubber());
  group.add(buildWalls(park));
  const lights = buildLights(park);
  group.add(lights);
  group.userData.setNight = lights.userData.setNight;

  group.userData.dispose = () => {
    group.traverse((o) => {
      o.geometry?.dispose?.();
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      materials.forEach((m) => {
        m?.map?.dispose?.();
        m?.dispose?.();
      });
    });
  };

  return group;
}
