/* ---------------------------------------------------------------------------
   SKY — the park floats in space.
   ---------------------------------------------------------------------------
   There is no stadium and no horizon. The field is an island, and everything
   around it, below it included, is sky:

     night   near-black, a faint band of galaxy, thousands of stars and a big
             moon hanging over the outfield
     day     a lighter field of cosmic dust — lavender, peach and teal clouds
             over a periwinkle gradient — with the stars still faintly there

   Everything here is painted in code once, at load, like the field texture:
   the clouds are baked into a canvas by direction on the sphere (so there is
   no seam and no pinch at the poles), the stars are points, the moon is a
   canvas disc. Per frame it only follows the camera and twinkles.

   It FOLLOWS THE CAMERA. A sky has no parallax — flying across the park in
   free roam must not bring the moon any closer — and centring it on the eye
   keeps it inside the far plane from anywhere a camera can go.

   The day sky is kept mid-toned on purpose: the ball is white, and a sky
   near white would swallow a fly ball at its apex.
--------------------------------------------------------------------------- */

import * as THREE from 'three';

const RADIUS = 1500; // ft; inside the camera's 2000 ft far plane from its centre
const STARS = 6000;

/* Where the moon hangs, in the field's own angles: theta 0 is centre field
   and negative is toward left, elevation is above the horizon. Low over
   left-centre, because the catcher's view — the one the app opens on —
   looks out that way and only about 11 degrees up. */
const MOON = { theta: -17, elevation: 6.5, radius: 2.8 }; // degrees

/* --- Noise -------------------------------------------------------------- */

/* Value noise in 3D, sampled on the unit sphere so the clouds wrap. */
function hash(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function noise(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const s = (t) => t * t * (3 - 2 * t);
  const u = s(x - xi);
  const v = s(y - yi);
  const w = s(z - zi);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

function fbm(x, y, z, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * f, y * f, z * f);
    f *= 2.03;
    amp *= 0.5;
  }
  return sum / (1 - 0.5 ** octaves);
}

const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (lo, hi, v) => {
  const t = clamp01((v - lo) / (hi - lo));
  return t * t * (3 - 2 * t);
};

/* --- The dome ----------------------------------------------------------- */

const W = 1024;
const H = 512;

/**
 * Paint an equirectangular sky by direction. Texel (col, row) is the direction
 * three.js's SphereGeometry puts at that uv, so whatever `shade` returns for a
 * direction is exactly what appears in that direction.
 */
function paintDome(shade) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(W, H);
  const data = image.data;
  for (let row = 0; row < H; row++) {
    const theta = ((row + 0.5) / H) * Math.PI;
    const y = Math.cos(theta);
    const r = Math.sin(theta);
    for (let col = 0; col < W; col++) {
      const phi = ((col + 0.5) / W) * Math.PI * 2;
      const rgb = shade(-Math.cos(phi) * r, y, Math.sin(phi) * r);
      const k = (row * W + col) * 4;
      data[k] = rgb[0];
      data[k + 1] = rgb[1];
      data[k + 2] = rgb[2];
      data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/* A great circle tilted across the sky: the galaxy's plane at night and the
   densest lane of dust by day. Its normal, in world space. */
const BAND = new THREE.Vector3(0.45, 0.55, 0.7).normalize();
const bandOf = (x, y, z) => 1 - Math.abs(x * BAND.x + y * BAND.y + z * BAND.z);

const NIGHT = {
  zenith: hex(0x03050c),
  horizon: hex(0x0b1230),
  below: hex(0x020309),
  galaxy: hex(0x5a4f8f),
  core: hex(0x9a86b8),
};

function nightShade(x, y, z) {
  // Brightest a little above the horizon, as if there were thin air there.
  const up = y >= 0 ? smooth(0, 0.6, y) : 0;
  let c = y >= 0 ? mix(NIGHT.horizon, NIGHT.zenith, up) : mix(NIGHT.horizon, NIGHT.below, smooth(0, 0.5, -y));
  const band = smooth(0.82, 1, bandOf(x, y, z));
  const clouds = fbm(x * 3 + 7, y * 3, z * 3);
  const lane = band * smooth(0.35, 0.8, clouds);
  c = mix(c, NIGHT.galaxy, lane * 0.45);
  c = mix(c, NIGHT.core, band ** 6 * smooth(0.5, 0.85, clouds) * 0.35);
  return c;
}

const DAY = {
  zenith: hex(0x4f5fa3),
  mid: hex(0x7a7fc0),
  horizon: hex(0xb79ac4),
  below: hex(0x3b3f78),
  peach: hex(0xe8a998),
  lavender: hex(0x9d86d2),
  teal: hex(0x6fb0c4),
};

function dayShade(x, y, z) {
  let c;
  if (y >= 0) {
    c = y < 0.35 ? mix(DAY.horizon, DAY.mid, smooth(0, 0.35, y)) : mix(DAY.mid, DAY.zenith, smooth(0.35, 1, y));
  } else {
    c = mix(DAY.horizon, DAY.below, smooth(0, 0.6, -y));
  }
  const band = smooth(0.55, 1, bandOf(x, y, z));
  const a = fbm(x * 2.2, y * 2.2 + 3, z * 2.2);
  const b = fbm(x * 4 + 11, y * 4, z * 4 - 5, 4);
  const dust = smooth(0.42, 0.8, a) * (0.45 + 0.55 * band);
  // Warm where one field of noise leads, cool where the other does.
  const tint = b > 0.5 ? mix(DAY.lavender, DAY.peach, smooth(0.5, 0.75, b)) : mix(DAY.teal, DAY.lavender, smooth(0.25, 0.5, b));
  c = mix(c, tint, dust * 0.55);
  // Fine grain in the lane: the "dust" up close.
  const grain = smooth(0.62, 0.9, fbm(x * 14, y * 14, z * 14, 3)) * band;
  c = mix(c, DAY.peach, grain * 0.18);
  return c;
}

/* --- Stars -------------------------------------------------------------- */

function buildStars() {
  const positions = new Float32Array(STARS * 3);
  const colors = new Float32Array(STARS * 3);
  const sizes = new Float32Array(STARS);
  const phases = new Float32Array(STARS);
  const tints = [
    [1, 1, 1],
    [0.8, 0.88, 1],
    [1, 0.92, 0.8],
    [0.9, 0.85, 1],
  ];
  const v = new THREE.Vector3();
  let seed = 1;
  const rand = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967295;
  for (let i = 0; i < STARS; i++) {
    // Uniform on the sphere, with a third more crowded into the galaxy band.
    do {
      v.set(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1);
    } while (v.lengthSq() > 1 || v.lengthSq() < 1e-4);
    v.normalize();
    if (i % 3 === 0 && bandOf(v.x, v.y, v.z) < 0.85) {
      i--;
      continue;
    }
    v.multiplyScalar(RADIUS * 0.98);
    positions.set([v.x, v.y, v.z], i * 3);
    const t = tints[Math.floor(rand() * tints.length)];
    const bright = 0.7 + 0.6 * rand() ** 2;
    colors.set([t[0] * bright, t[1] * bright, t[2] * bright], i * 3);
    // Most stars are faint pinpricks; a few are big and bright.
    sizes[i] = 2 + 4 * rand() ** 5;
    phases[i] = rand() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      opacity: { value: 1 },
      pixelRatio: { value: 1 },
    },
    vertexShader: /* glsl */ `
      attribute float size;
      attribute float phase;
      uniform float time;
      uniform float pixelRatio;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = color;
        // Slow and slight: a shimmer, not a blink.
        vTwinkle = 0.75 + 0.25 * sin(time * (0.8 + fract(phase * 3.7) * 1.6) + phase);
        gl_PointSize = size * pixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float opacity;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vColor * vTwinkle, a * a * opacity);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'stars';
  points.frustumCulled = false;
  points.renderOrder = -9;
  return points;
}

/* --- The moon ----------------------------------------------------------- */

function moonCanvas() {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(S, S);
  const data = image.data;
  const R = S / 2 - 2;

  // Craters: a few big ones and many small, fixed by seed.
  let seed = 7;
  const rand = () => ((seed = Math.imul(seed ^ (seed >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967295;
  const craters = [];
  for (let i = 0; i < 70; i++) {
    const big = i < 9;
    craters.push({
      x: (rand() * 2 - 1) * 0.85,
      y: (rand() * 2 - 1) * 0.85,
      r: big ? 0.08 + rand() * 0.12 : 0.015 + rand() * 0.045,
      depth: big ? 0.1 + rand() * 0.08 : 0.12 + rand() * 0.1,
    });
  }
  // Light from the upper right, a little in front: a moon just past full.
  const light = new THREE.Vector3(0.45, 0.35, 0.82).normalize();

  for (let py = 0; py < S; py++) {
    for (let px = 0; px < S; px++) {
      const x = (px + 0.5 - S / 2) / R;
      const y = (S / 2 - py - 0.5) / R;
      const rr = x * x + y * y;
      const k = (py * S + px) * 4;
      if (rr > 1) {
        data[k + 3] = 0;
        continue;
      }
      const z = Math.sqrt(1 - rr);
      // The dark maria: broad low-frequency patches.
      const maria = smooth(0.5, 0.7, fbm(x * 1.6 + 4, y * 1.6, z * 1.6, 4));
      let tone = 0.92 - maria * 0.28 + (fbm(x * 9, y * 9, z * 9, 3) - 0.5) * 0.12;
      let nx = x;
      let ny = y;
      for (const c of craters) {
        const dx = x - c.x;
        const dy = y - c.y;
        const d = Math.hypot(dx, dy) / c.r;
        if (d > 1.25) continue;
        if (d < 1) {
          // A bowl: tilt the normal toward the centre, darken the floor.
          const s = (d * c.depth) / Math.max(d, 1e-3);
          nx -= (dx / c.r) * s;
          ny -= (dy / c.r) * s;
          tone -= 0.06 * (1 - d);
        } else {
          tone += 0.08 * (1.25 - d) * 4 * 0.25; // the bright rim
        }
      }
      const n = new THREE.Vector3(nx, ny, z).normalize();
      const lit = Math.max(0, n.dot(light));
      const limb = 0.55 + 0.45 * z ** 0.4;
      const v = clamp01(tone * (0.3 + 0.95 * lit) * limb);
      data[k] = 255 * v * 0.97;
      data[k + 1] = 255 * v * 0.97;
      data[k + 2] = 255 * v;
      // Antialiased edge.
      data[k + 3] = 255 * clamp01((1 - Math.sqrt(rr)) * R);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function glowCanvas() {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(210,220,255,0.55)');
  g.addColorStop(0.18, 'rgba(180,195,255,0.28)');
  g.addColorStop(0.45, 'rgba(130,150,230,0.08)');
  g.addColorStop(1, 'rgba(100,120,220,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return canvas;
}

function buildMoon() {
  const group = new THREE.Group();
  group.name = 'moon';
  const th = (MOON.theta * Math.PI) / 180;
  const el = (MOON.elevation * Math.PI) / 180;
  const at = new THREE.Vector3(Math.sin(th) * Math.cos(el), Math.sin(el), -Math.cos(th) * Math.cos(el))
    .multiplyScalar(RADIUS * 0.9);
  const size = 2 * RADIUS * 0.9 * Math.tan((MOON.radius * Math.PI) / 180);

  const sprite = (canvas, scale, order, blending) => {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        fog: false,
        toneMapped: false,
        blending,
      }),
    );
    s.position.copy(at);
    s.scale.setScalar(size * scale);
    s.renderOrder = order;
    s.frustumCulled = false;
    return s;
  };
  group.add(sprite(glowCanvas(), 5, -8, THREE.AdditiveBlending));
  group.add(sprite(moonCanvas(), 1, -7, THREE.NormalBlending));
  return group;
}

/* --- Assembly ----------------------------------------------------------- */

export function createSky() {
  const group = new THREE.Group();
  group.name = 'sky';

  /* Each sky is painted the first time it is shown — a game that never goes
     to night never pays for the night sky. */
  const textures = {};
  const skyTexture = (night) => {
    const key = night ? 'night' : 'day';
    textures[key] ??= paintDome(night ? nightShade : dayShade);
    return textures[key];
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(RADIUS, 64, 32),
    new THREE.MeshBasicMaterial({
      map: null,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  dome.name = 'sky-dome';
  dome.renderOrder = -10;
  dome.frustumCulled = false;

  const stars = buildStars();
  const moon = buildMoon();
  group.add(dome, stars, moon);

  let starOpacity = 0.35;
  function setNight(night) {
    dome.material.map = skyTexture(night);
    dome.material.needsUpdate = true;
    // By day the stars are still there, faintly, through the dust.
    starOpacity = night ? 1 : 0.35;
    stars.material.uniforms.opacity.value = starOpacity;
    moon.visible = night;
  }

  function update(seconds, camera, pixelRatio = 1) {
    group.position.copy(camera.position);
    stars.material.uniforms.time.value = seconds;
    stars.material.uniforms.pixelRatio.value = pixelRatio;
  }

  function dispose() {
    group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
    Object.values(textures).forEach((t) => t.dispose());
  }

  setNight(false);
  return { group, setNight, update, dispose };
}
