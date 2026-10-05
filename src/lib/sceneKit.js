// PrismOS Scene Kit — the small real-time 3D runtime a local model builds on.
//
// The model describes the world (voxels, moving parts, water, particles, light);
// the kit owns everything that makes it look finished and run fast: renderer
// and colour pipeline, mood lighting with fitted soft shadows and a rim light,
// sky gradient and fog, a ground that fades into the distance, instanced voxels
// with hidden-voxel culling and subtle shading, bloom, a still camera framed on
// whatever was built, resize and the title card.
//
// Only what really moves moves: buildings, terrain and the camera stay still
// (a turntable is opt-in), while moving pieces live in world.part() groups,
// sweeping beams, water, particles, flickering lights and lightning.
// Served offline as 'prismos/scene'. MIT — part of PrismOS.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const MOODS = {
  day: { water: 0x3a8fb7, top: 0x5d9bd5, bottom: 0xdfeef8, fog: 0xd6e7f3, ground: 0x7c9a5a, sun: 0xfff3dc, sunI: 3.2, sunDir: [0.55, 0.85, 0.35], hemiSky: 0xd4e9ff, hemiGround: 0x6d5b45, hemiI: 1.25, exposure: 1.0, bloom: 0.12, stars: false },
  'golden-hour': { water: 0x3d7897, top: 0x6f8fc2, bottom: 0xf8cf9f, fog: 0xeac9a6, ground: 0x7f8a4e, sun: 0xffc27d, sunI: 3.6, sunDir: [0.75, 0.42, 0.5], hemiSky: 0xc4d6f2, hemiGround: 0x7b5a3a, hemiI: 0.95, exposure: 1.05, bloom: 0.22, stars: false },
  sunset: { water: 0x35557a, top: 0x3c4a8c, bottom: 0xff9a6b, fog: 0xd88a72, ground: 0x6b5d45, sun: 0xff8a50, sunI: 3.4, sunDir: [0.85, 0.25, 0.35], hemiSky: 0x8f9be0, hemiGround: 0x5a3b2e, hemiI: 0.8, exposure: 1.08, bloom: 0.35, stars: false },
  // Night is moonlit, not black: silhouettes and materials stay readable.
  night: { water: 0x10283d, top: 0x040a24, bottom: 0x24396a, fog: 0x0f1a33, ground: 0x1d2a24, sun: 0xc4d4ff, sunI: 2.6, sunDir: [-0.4, 0.8, 0.45], hemiSky: 0x7088c8, hemiGround: 0x1a1a2a, hemiI: 1.55, exposure: 1.45, bloom: 0.75, stars: true },
  space: { water: 0x1a2a4a, top: 0x000005, bottom: 0x070b1c, fog: null, ground: null, sun: 0xffffff, sunI: 3.0, sunDir: [1, 0.3, 0.6], hemiSky: 0x223355, hemiGround: 0x000000, hemiI: 0.35, exposure: 1.1, bloom: 0.7, stars: true },
  underwater: { water: 0x2a7fa0, top: 0x0a4d68, bottom: 0x05263b, fog: 0x0b4a63, ground: 0xc2b280, sun: 0xbff4ff, sunI: 2.0, sunDir: [0.2, 1, 0.3], hemiSky: 0x5fd3e6, hemiGround: 0x0b2a38, hemiI: 1.0, exposure: 1.1, bloom: 0.4, stars: false },
};

/** Deterministic PRNG so a scene looks the same every time it opens. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** World-space sky: horizon colour at eye level fading to the zenith colour, so
 *  fogged ground meets the sky without a seam from any camera angle. With
 *  clouds on (storms), a drifting cloud deck that lightning lights from inside. */
function skyDome(top, bottom, radius) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(top) },
      bottom: { value: new THREE.Color(bottom) },
      uTime: { value: 0 },
      uClouds: { value: 0 },
      uCloudColor: { value: new THREE.Color(0x1a2233) },
      uFlash: { value: 0 },
    },
    vertexShader:
      'varying vec3 vDir;\nvoid main() {\n  vDir = normalize(position);\n  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}',
    fragmentShader: [
      'uniform vec3 top;',
      'uniform vec3 bottom;',
      'uniform float uTime;',
      'uniform float uClouds;',
      'uniform vec3 uCloudColor;',
      'uniform float uFlash;',
      'varying vec3 vDir;',
      'float sHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
      'float sNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y); }',
      'float sFbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * sNoise(p); p = p * 2.02 + vec2(3.1, 1.7); a *= 0.5; } return s; }',
      'void main() {',
      '  float h = smoothstep(-0.04, 0.38, vDir.y);',
      '  vec3 sky = mix(bottom, top, h);',
      '  if (uClouds > 0.0 && vDir.y > -0.02) {',
      '    vec2 uv = vDir.xz / (vDir.y + 0.12) * 1.6 + vec2(uTime * 0.018, uTime * 0.007);',
      '    float c = sFbm(uv);',
      '    float cover = smoothstep(0.62 - uClouds * 0.32, 0.92 - uClouds * 0.2, c);',
      '    float lit = sFbm(uv * 1.7 + 4.0);',
      '    vec3 cloud = uCloudColor * (0.7 + 0.6 * lit) + vec3(0.55, 0.6, 0.75) * uFlash * (0.4 + lit);',
      '    sky = mix(sky, cloud, cover * smoothstep(-0.02, 0.12, vDir.y) * 0.95);',
      '  }',
      '  gl_FragColor = vec4(sky, 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

/** Gerstner swells for the GPU ocean: wavelength, direction offset from the
 *  wind (rad), relative amplitude. Long swells lead, shorter ones cross them. */
const OCEAN_WAVES = [
  [18.0, 0.0, 1.0],
  [12.5, 0.55, 0.7],
  [9.0, -0.42, 0.55],
  [7.7, 0.25, 0.45],
  [6.5, 1.05, 0.38],
  [5.0, -0.95, 0.28],
];

const OCEAN_VERTEX_HEAD = [
  'uniform float uTime;',
  'uniform vec4 uWaves[8];',
  'uniform float uQ[8];',
  'uniform float uOmega[8];',
  'uniform int uCount;',
  'uniform vec3 uFade;',
  'varying vec3 vWaterWorld;',
  'varying float vCrest;',
].join('\n');

// Replaces <beginnormal_vertex>: displacement and its analytic normal, summed
// over the swells (GPU Gems ch. 1), faded out toward the horizon.
const OCEAN_NORMAL = [
  'vec3 wBase = (modelMatrix * vec4(position, 1.0)).xyz;',
  'float wFadeV = 1.0 - smoothstep(uFade.z, uFade.z * 2.4, length(wBase.xz - uFade.xy));',
  'vec3 wDisp = vec3(0.0);',
  'vec3 wNrm = vec3(0.0, 1.0, 0.0);',
  'float wCrest = 0.0;',
  'for (int i = 0; i < 8; i++) {',
  '  if (i >= uCount) break;',
  '  vec4 w = uWaves[i];',
  '  float th = w.z * dot(w.xy, wBase.xz) - uOmega[i] * uTime;',
  '  float c = cos(th);',
  '  float s = sin(th);',
  '  float a = w.w * wFadeV;',
  '  float qa = uQ[i] * a;',
  '  wDisp += vec3(qa * w.x * c, a * s, qa * w.y * c);',
  '  wNrm -= vec3(w.x * w.z * a * c, uQ[i] * w.z * a * s, w.y * w.z * a * c);',
  '  wCrest += uQ[i] * w.z * a * s;',
  '}',
  'vec3 objectNormal = normalize(wNrm);',
  '#ifdef USE_TANGENT',
  '  vec3 objectTangent = vec3(tangent.xyz);',
  '#endif',
].join('\n');

const OCEAN_BEGIN = [
  'vec3 transformed = vec3(position) + wDisp;',
  'vWaterWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
  'vCrest = wCrest;',
].join('\n');

const OCEAN_FRAGMENT_HEAD = [
  'uniform float uTime;',
  'uniform vec3 uDeep;',
  'uniform vec3 uShallow;',
  'uniform vec3 uFoam;',
  'uniform float uFoamAmt;',
  'uniform float uSteep;',
  'uniform float uDetail;',
  'uniform sampler2D uShore;',
  'uniform vec4 uShoreRect;',
  'uniform float uShoreOn;',
  'uniform vec3 uFade;',
  'varying vec3 vWaterWorld;',
  'varying float vCrest;',
  'float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
  'float wNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y); }',
  'float wFbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { s += a * wNoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }',
].join('\n');

// After <color_fragment>: body colour (deep in the troughs, lit turquoise on
// the crests), whitecaps along the crest lines broken up by drifting noise,
// and foam that rolls outward from every shoreline.
const OCEAN_COLOR = [
  '#include <color_fragment>',
  'vec2 wp = vWaterWorld.xz;',
  'float wFar = smoothstep(uFade.z, uFade.z * 2.4, length(wp - uFade.xy));',
  'float crestN = clamp(vCrest / max(uSteep, 0.001), -1.0, 1.0);',
  'float n1 = wFbm(wp * 0.32 + vec2(uTime * 0.05, -uTime * 0.035));',
  'float n2 = wFbm(wp * 1.25 - vec2(uTime * 0.12, uTime * 0.08));',
  'float whitecap = smoothstep(0.5, 0.88, crestN + (n1 - 0.5) * 0.55) * smoothstep(0.3, 0.7, n2) * uFoamAmt;',
  'float shoreFoam = 0.0;',
  'if (uShoreOn > 0.5) {',
  '  vec2 suv = (wp - uShoreRect.xy) / uShoreRect.zw;',
  '  if (suv.x > 0.0 && suv.y > 0.0 && suv.x < 1.0 && suv.y < 1.0) {',
  '    float sd = texture2D(uShore, suv).r;',
  '    float bands = 0.5 + 0.5 * sin(sd * 26.0 - uTime * 2.4 + n1 * 5.0);',
  '    float near = 1.0 - smoothstep(0.0, 0.55, sd);',
  '    float lace = smoothstep(0.42, 0.72, n2 + 0.25 * near);',
  '    shoreFoam = near * near * bands * bands * lace;',
  '    shoreFoam = max(shoreFoam, (1.0 - smoothstep(0.0, 0.06, sd)) * smoothstep(0.3, 0.6, n2 + 0.2));',
  '    shoreFoam *= mix(0.35, 0.9, uFoamAmt);',
  '  }',
  '}',
  'float wFoam = clamp(max(whitecap, shoreFoam), 0.0, 1.0) * (1.0 - wFar);',
  'vec3 wBody = mix(uDeep, uShallow, smoothstep(0.0, 1.0, crestN) * 0.55);',
  'diffuseColor.rgb = mix(wBody, uFoam, wFoam);',
].join('\n');

const OCEAN_ROUGHNESS = '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.85, wFoam);';

// After <normal_fragment_maps>: capillary ripples and drifting noise, so the
// whole surface shimmers continuously between the swells.
const OCEAN_RIPPLES = [
  '#include <normal_fragment_maps>',
  '{',
  '  vec2 g = vec2(0.0);',
  '  g += vec2(0.83, 0.55) * cos(dot(wp, vec2(0.83, 0.55)) * 3.1 - uTime * 2.9) * 0.08;',
  '  g += vec2(-0.47, 0.88) * cos(dot(wp, vec2(-0.47, 0.88)) * 4.3 - uTime * 3.6) * 0.06;',
  '  g += vec2(0.96, -0.28) * cos(dot(wp, vec2(0.96, -0.28)) * 5.9 - uTime * 4.1) * 0.05;',
  '  g += vec2(-0.71, -0.7) * cos(dot(wp, vec2(-0.71, -0.7)) * 7.7 - uTime * 4.8) * 0.04;',
  '  g += (vec2(wFbm(wp * 2.3 + uTime * 0.31), wFbm(wp * 2.3 - uTime * 0.27 + 7.1)) - 0.5) * 0.3;',
  '  g *= uDetail * (1.0 - wFoam) * (1.0 - wFar * 0.85);',
  '  normal = normalize(normal + mat3(viewMatrix) * vec3(-g.x, 0.0, -g.y));',
  '}',
].join('\n');

/** A square grid that is fine over the scene's own water and stretches out
 *  to the horizon, so one mesh (no seams) carries the sea all the way. */
function oceanGeometry(halfW, halfD, outer, segments) {
  const geo = new THREE.PlaneGeometry(2, 2, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const a = 0.62; // share of the grid spent on the scene's own water
  const stretch = (u, inner) => {
    const m = Math.abs(u);
    if (m <= a) return (Math.sign(u) * inner * m) / a;
    const f = (m - a) / (1 - a);
    return Math.sign(u) * (inner + (Math.max(outer, inner) - inner) * f * f);
  };
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, stretch(pos.getX(i), halfW));
    pos.setZ(i, stretch(pos.getZ(i), halfD));
  }
  geo.computeBoundingSphere();
  return geo;
}

/** A light shaft: bright at the lamp, soft at the edges, fading with distance,
 *  with a slow shimmer of mist moving outward through it. */
const BEAM_VERTEX = [
  'uniform float uLength;',
  'varying float vAlong;',
  'varying vec3 vNormalV;',
  'varying vec3 vViewDir;',
  'void main() {',
  '  vAlong = position.x / uLength;',
  '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
  '  vNormalV = normalize(normalMatrix * normal);',
  '  vViewDir = normalize(-mv.xyz);',
  '  gl_Position = projectionMatrix * mv;',
  '}',
].join('\n');
const BEAM_FRAGMENT = [
  'uniform vec3 uColor;',
  'uniform float uOpacity;',
  'uniform float uTime;',
  'varying float vAlong;',
  'varying vec3 vNormalV;',
  'varying vec3 vViewDir;',
  'void main() {',
  '  float edge = pow(abs(dot(normalize(vNormalV), normalize(vViewDir))), 1.7);',
  '  float fade = pow(clamp(1.0 - vAlong, 0.0, 1.0), 1.5);',
  '  float mist = 0.86 + 0.14 * sin(vAlong * 34.0 - uTime * 3.0);',
  '  gl_FragColor = vec4(uColor, clamp(edge * fade * mist * uOpacity, 0.0, 1.0));',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

function addTitleCard(title, subtitle, dark) {
  if (!title) return;
  const card = document.createElement('div');
  card.style.cssText =
    'position:fixed;top:18px;left:18px;z-index:10;padding:12px 16px 11px;border-radius:14px;' +
    'background:rgba(12,16,24,' + (dark ? '0.5' : '0.38') + ');border:1px solid rgba(255,255,255,.12);' +
    'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#f4f1ea;' +
    'font:600 15px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.2px;pointer-events:none;user-select:none;max-width:42vw';
  const h = document.createElement('div');
  h.textContent = title;
  card.appendChild(h);
  const p = document.createElement('div');
  p.style.cssText = 'margin-top:5px;font-weight:400;font-size:11.5px;opacity:.7';
  p.textContent = (subtitle ? subtitle + ' · ' : '') + 'drag to look around · scroll to zoom';
  card.appendChild(p);
  document.body.appendChild(card);
}

/** A set of voxels: the static world, or one movable part (local coordinates). */
function voxelStore(random) {
  const solid = new Map();
  const glowing = new Map();
  const key = (x, y, z) => `${Math.round(x)},${Math.round(y)},${Math.round(z)}`;
  const resolveColor = (color, x, y, z) => (typeof color === 'function' ? color(x, y, z) : color);
  const api = {
    set(x, y, z, color) {
      const c = resolveColor(color, x, y, z);
      if (c === null || c === undefined) return;
      glowing.delete(key(x, y, z));
      solid.set(key(x, y, z), c);
    },
    glow(x, y, z, color) {
      const c = resolveColor(color, x, y, z);
      if (c === null || c === undefined) return;
      solid.delete(key(x, y, z));
      glowing.set(key(x, y, z), c);
    },
    remove(x, y, z) {
      solid.delete(key(x, y, z));
      glowing.delete(key(x, y, z));
    },
    has: (x, y, z) => solid.has(key(x, y, z)) || glowing.has(key(x, y, z)),
    get: (x, y, z) => solid.get(key(x, y, z)) ?? glowing.get(key(x, y, z)),
    box(x0, y0, z0, x1, y1, z1, color) {
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
          for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) api.set(x, y, z, color);
    },
    shell(x0, y0, z0, x1, y1, z1, color) {
      const [ax, bx, ay, by, az, bz] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1), Math.min(z0, z1), Math.max(z0, z1)];
      for (let x = ax; x <= bx; x++)
        for (let y = ay; y <= by; y++)
          for (let z = az; z <= bz; z++)
            if (x === ax || x === bx || z === az || z === bz) api.set(x, y, z, color);
    },
    cylinder(cx, y0, cz, radius, height, color) {
      for (let y = y0; y < y0 + height; y++)
        for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++)
          for (let z = Math.floor(cz - radius); z <= Math.ceil(cz + radius); z++)
            if ((x - cx) ** 2 + (z - cz) ** 2 <= radius * radius + 0.25) api.set(x, y, z, color);
    },
    sphere(cx, cy, cz, radius, color, fill = 1) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++)
        for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++)
          for (let z = Math.floor(cz - radius); z <= Math.ceil(cz + radius); z++)
            if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= radius * radius + 0.25 && random() <= fill) api.set(x, y, z, color);
    },
    get count() {
      return solid.size + glowing.size;
    },
  };
  return { api, solid, glowing };
}

const shade = new THREE.Color();
const hsl = { h: 0, s: 0, l: 0 };

/** One instanced mesh per store and kind, hiding voxels buried on all six sides. */
function buildVoxelMesh(store, emissive) {
  const map = emissive ? store.glowing : store.solid;
  if (!map.size) return null;
  const has = store.api.has;
  const visible = [];
  for (const [k, color] of map) {
    const [x, y, z] = k.split(',').map(Number);
    const enclosed = has(x + 1, y, z) && has(x - 1, y, z) && has(x, y + 1, z) && has(x, y - 1, z) && has(x, y, z + 1) && has(x, y, z - 1);
    if (!enclosed) visible.push([x, y, z, color]);
  }
  const material = emissive
    ? new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.7, 1.7) })
    : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0.02 });
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, visible.length);
  const m = new THREE.Matrix4();
  visible.forEach(([x, y, z, color], i) => {
    m.makeTranslation(x, y, z);
    mesh.setMatrixAt(i, m);
    shade.set(color).getHSL(hsl);
    const covered = !emissive && has(x, y + 1, z) ? -0.07 : 0;
    const jitter = ((hashString(`${x},${y},${z}`) % 1000) / 1000 - 0.5) * 0.06;
    shade.setHSL(hsl.h, hsl.s, THREE.MathUtils.clamp(hsl.l + jitter + covered, 0, 1));
    if (emissive) shade.set(color); // glow voxels keep their exact colour
    mesh.setColorAt(i, shade);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = !emissive;
  mesh.receiveShadow = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

export function createWorld(options = {}) {
  // The camera stays still unless asked: only what really moves should move.
  const opts = { mood: 'golden-hour', bloom: undefined, ground: true, autoRotate: false, ...options };
  const mood = { ...(MOODS[opts.mood] || MOODS['golden-hour']), ...(opts.colors || {}) };
  const random = mulberry32(hashString(String(opts.title || 'prismos')));

  document.documentElement.style.cssText += ';height:100%;background:#000';
  document.body.style.cssText += ';margin:0;height:100%;overflow:hidden;background:#000';

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = mood.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = 'block';
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(mood.bottom);
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 4000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = Boolean(opts.autoRotate);
  controls.autoRotateSpeed = 0.55;

  const hemi = new THREE.HemisphereLight(mood.hemiSky, mood.hemiGround, mood.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(mood.sun, mood.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);
  // A soft rim light from behind keeps silhouettes readable, at night above all.
  const rim = new THREE.DirectionalLight(mood.hemiSky, mood.sunI * (opts.mood === 'night' ? 0.45 : 0.25));
  scene.add(rim, rim.target);

  // ── voxels: the static world, plus movable parts ───────────────────────
  const world = voxelStore(random);
  const voxels = world.api;
  const parts = [];
  const partsGroup = new THREE.Group();
  scene.add(partsGroup);

  // ── helpers the model can call ─────────────────────────────────────────
  const updates = [];
  const extras = new THREE.Group();
  scene.add(extras);
  const effects = new THREE.Group();
  scene.add(effects);
  // Filled in by start(), for helpers that need the finished world's size.
  let bounds = null;
  let dome = null;

  function add(object, { shadows = true } = {}) {
    object.traverse?.((o) => {
      if (o.isMesh) {
        o.castShadow = shadows;
        o.receiveShadow = true;
      }
    });
    extras.add(object);
    return object;
  }

  /** A movable piece (windmill sails, a boat, a door, a flag) pivoting at
   *  (x, y, z). Build it with part.voxels (same API as voxels, coordinates
   *  relative to the pivot) and move it in onUpdate via part.rotation/position. */
  function part(at = {}, py, pz) {
    // part({ x, y, z }), or the positional part(x, y, z) models sometimes write.
    const { x = 0, y = 0, z = 0 } = typeof at === 'number' ? { x: at, y: py, z: pz } : at || {};
    const group = new THREE.Group();
    group.position.set(Number(x) || 0, Number(y) || 0, Number(z) || 0);
    const store = voxelStore(random);
    group.voxels = store.api;
    parts.push({ group, store });
    partsGroup.add(group);
    return group;
  }

  /** Water: a GPU ocean (see OCEAN_*). Swells travel with the wind across
   *  the whole surface, ripples shimmer between them, whitecaps form on the
   *  crests and foam rolls out from the shore. Built in start(), when the
   *  world is known: a sea that spans the scene runs on to the horizon. */
  const pendingWater = [];
  const waters = [];
  let skyEnv = null;

  /** A boat or buoy the model dropped inside the island (a common spatial
   *  slip) is slid straight out from the centre until it floats clear of the
   *  rocks. Only parts sitting at the waterline are touched. */
  function floatOffShore(centerX, centerZ) {
    for (const { group } of parts) {
      const p = group.position;
      for (const w of waters) {
        const wy = w.mesh.position.y;
        if (p.y < wy - 1.5 || p.y > wy + 2) continue;
        if (Math.abs(p.x - w.mesh.position.x) > w.width / 2 || Math.abs(p.z - w.mesh.position.z) > w.depth / 2) continue;
        const aground = (x, z) => {
          for (let dx = -2; dx <= 2; dx++)
            for (let dz = -2; dz <= 2; dz++)
              for (let y = Math.round(wy); y <= Math.round(wy) + 3; y++) if (voxels.has(x + dx, y, z + dz)) return true;
          return false;
        };
        if (!aground(p.x, p.z)) break;
        let dx = p.x - centerX;
        let dz = p.z - centerZ;
        const len = Math.hypot(dx, dz) || 1;
        dx = len > 1e-3 ? dx / len : 1;
        dz = len > 1e-3 ? dz / len : 0;
        for (let step = 1; step <= 160; step++) {
          const x = p.x + dx * step * 0.5;
          const z = p.z + dz * step * 0.5;
          if (!aground(x, z)) {
            p.x = x + dx;
            p.z = z + dz;
            break;
          }
        }
        break;
      }
    }
  }
  function water({ x = 0, y = 0, z = 0, width = 10, depth = 10, color = mood.water, opacity, waves = 0.05 } = {}) {
    const amp = waves === true ? 0.3 : THREE.MathUtils.clamp(Number(waves) || 0, 0, 0.8);
    const stormy = amp > 0.15;
    const alpha = opacity ?? (stormy ? 1 : 0.86);
    const uniforms = {
      uTime: { value: 0 },
      uWaves: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
      uQ: { value: new Array(8).fill(0) },
      uOmega: { value: new Array(8).fill(0) },
      uCount: { value: 0 },
      uSteep: { value: 0.5 },
      uFade: { value: new THREE.Vector3(x, z, 1e6) },
      uDeep: { value: new THREE.Color(color) },
      uShallow: { value: new THREE.Color(color).lerp(new THREE.Color(0x3aa6a0), 0.35).multiplyScalar(1.7) },
      uFoam: { value: new THREE.Color(0xe6eef2).lerp(new THREE.Color(mood.fog ?? mood.bottom), opts.mood === 'night' ? 0.35 : 0.12) },
      uFoamAmt: { value: THREE.MathUtils.smoothstep(amp, 0.1, 0.4) },
      uDetail: { value: 0.35 + amp * 1.2 },
      uShore: { value: null },
      uShoreRect: { value: new THREE.Vector4(0, 0, 1, 1) },
      uShoreOn: { value: 0 },
    };
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: stormy ? 0.3 : 0.1, metalness: 0, transparent: alpha < 0.99, opacity: alpha,
    });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${OCEAN_VERTEX_HEAD}`)
        .replace('#include <beginnormal_vertex>', OCEAN_NORMAL)
        .replace('#include <begin_vertex>', OCEAN_BEGIN);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${OCEAN_FRAGMENT_HEAD}`)
        .replace('#include <color_fragment>', OCEAN_COLOR)
        .replace('#include <roughnessmap_fragment>', OCEAN_ROUGHNESS)
        .replace('#include <normal_fragment_maps>', OCEAN_RIPPLES);
    };
    material.customProgramCacheKey = () => 'prismos-ocean-1';
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth, 1, 1).rotateX(-Math.PI / 2), material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.renderOrder = -0.5; // before rain and beams, so it never paints over them
    effects.add(mesh);
    const entry = { mesh, width: Math.max(1, Number(width) || 10), depth: Math.max(1, Number(depth) || 10), amp, uniforms };
    waters.push(entry);
    if (bounds) buildWater(entry);
    else pendingWater.push(entry);
    updates.push((t) => {
      uniforms.uTime.value = t;
    });
    return mesh;
  }

  function buildWater({ mesh, width, depth, amp, uniforms }) {
    const reach = bounds.radius;
    const sea = Math.min(width, depth) >= reach * 1.6;
    if (sea) {
      mesh.geometry.dispose();
      mesh.geometry = oceanGeometry(width / 2, depth / 2, Math.max(width, depth, reach * 24) / 2, 256);
      uniforms.uFade.value.set(mesh.position.x, mesh.position.z, Math.max(width, depth) / 2);
    } else {
      const segs = THREE.MathUtils.clamp(Math.round(Math.max(width, depth) * 2.5), 16, 200);
      mesh.geometry.dispose();
      mesh.geometry = new THREE.PlaneGeometry(width, depth, segs, segs).rotateX(-Math.PI / 2);
    }
    mesh.frustumCulled = false; // the swells move vertices outside the flat bounding box
    // Swells sized to the water (a pond gets ripples, the sea gets rollers),
    // travelling downwind at deep-water speed (omega = sqrt(g k)).
    const scale = THREE.MathUtils.clamp(Math.min(width, depth) / 40, 0.2, 1);
    const wind = Math.atan2(0.6, 0.8);
    const steep = THREE.MathUtils.clamp(0.25 + amp * 1.5, 0.25, 0.9);
    const n = OCEAN_WAVES.length;
    OCEAN_WAVES.forEach(([wavelength, offset, rel], i) => {
      const k = (2 * Math.PI) / (wavelength * scale);
      const A = amp * 1.2 * rel * (sea ? 1 : scale);
      uniforms.uWaves.value[i].set(Math.cos(wind + offset), Math.sin(wind + offset), k, A);
      uniforms.uOmega.value[i] = Math.sqrt(9.8 * k);
      uniforms.uQ.value[i] = A > 0 ? Math.min(1, steep / (k * A * n)) : 0;
    });
    uniforms.uCount.value = n;
    uniforms.uSteep.value = steep;
    const shore = shoreTexture(mesh.position, width, depth, reach);
    if (shore) {
      uniforms.uShore.value = shore.texture;
      uniforms.uShoreRect.value.copy(shore.rect);
      uniforms.uShoreOn.value = 1;
    }
    // Reflect the sky: grazing angles pick up the bright horizon, like real water.
    mesh.material.envMap = skyEnvironment();
    mesh.material.envMapIntensity = 1;
    mesh.material.needsUpdate = true;
  }

  /** Distance from land at the waterline, as a small texture over the water:
   *  0 at the rocks, 1 at ~a third of the scene's radius out. */
  function shoreTexture(at, width, depth, reach) {
    const size = 256;
    const cell = Math.max(width, depth) / size;
    const nx = Math.min(size, Math.ceil(width / cell));
    const nz = Math.min(size, Math.ceil(depth / cell));
    const minX = at.x - width / 2;
    const minZ = at.z - depth / 2;
    const land = new Uint8Array(nx * nz);
    let any = false;
    for (const k of world.solid.keys()) {
      const [vx, vy, vz] = k.split(',').map(Number);
      if (vy + 0.5 <= at.y || vy > at.y + 3) continue; // must break the surface
      const i0 = Math.max(0, Math.floor((vx - 0.5 - minX) / cell));
      const i1 = Math.min(nx - 1, Math.floor((vx + 0.5 - minX) / cell));
      const j0 = Math.max(0, Math.floor((vz - 0.5 - minZ) / cell));
      const j1 = Math.min(nz - 1, Math.floor((vz + 0.5 - minZ) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) land[j * nx + i] = 1;
      if (i0 <= i1 && j0 <= j1) any = true;
    }
    if (!any) return null;
    // Two-pass chamfer distance, in cells.
    const big = 1e9;
    const d = new Float32Array(nx * nz);
    for (let i = 0; i < d.length; i++) d[i] = land[i] ? 0 : big;
    const relax = (i, j, di, dj, cost) => {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) return;
      const v = d[b * nx + a] + cost;
      if (v < d[j * nx + i]) d[j * nx + i] = v;
    };
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { relax(i, j, -1, 0, 1); relax(i, j, 0, -1, 1); relax(i, j, -1, -1, 1.4142); relax(i, j, 1, -1, 1.4142); }
    for (let j = nz - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) { relax(i, j, 1, 0, 1); relax(i, j, 0, 1, 1); relax(i, j, 1, 1, 1.4142); relax(i, j, -1, 1, 1.4142); }
    const maxDist = THREE.MathUtils.clamp(reach * 0.35, 4, 14);
    const data = new Uint8Array(nx * nz);
    for (let i = 0; i < d.length; i++) data[i] = Math.min(255, Math.round(((d[i] * cell) / maxDist) * 255));
    const texture = new THREE.DataTexture(data, nx, nz, THREE.RedFormat, THREE.UnsignedByteType);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return { texture, rect: new THREE.Vector4(minX, minZ, nx * cell, nz * cell) };
  }

  /** The sky as an environment map, for water reflections (made once). */
  function skyEnvironment() {
    if (skyEnv) return skyEnv;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.add(skyDome(mood.top, mood.bottom, 50));
    skyEnv = pmrem.fromScene(envScene, 0.035).texture;
    pmrem.dispose();
    return skyEnv;
  }

  const PARTICLES = {
    petals: { color: 0xf7b7cf, size: 0.32, fall: 0.6, sway: 0.9, blend: THREE.NormalBlending },
    leaves: { color: 0xd98b3a, size: 0.34, fall: 0.7, sway: 1.0, blend: THREE.NormalBlending },
    snow: { color: 0xffffff, size: 0.24, fall: 0.9, sway: 0.4, blend: THREE.NormalBlending },
    rain: { color: 0xaecbff, size: 0.12, fall: 16, sway: 0.0, blend: THREE.AdditiveBlending },
    fireflies: { color: 0xfff08a, size: 0.38, fall: 0, sway: 1.2, blend: THREE.AdditiveBlending },
    embers: { color: 0xff9a3c, size: 0.26, fall: -1.2, sway: 0.6, blend: THREE.AdditiveBlending },
    bubbles: { color: 0xcff6ff, size: 0.3, fall: -1.0, sway: 0.3, blend: THREE.AdditiveBlending },
    dust: { color: 0xfff4d6, size: 0.12, fall: 0.05, sway: 0.3, blend: THREE.AdditiveBlending },
    stars: { color: 0xffffff, size: 0.9, fall: 0, sway: 0, blend: THREE.AdditiveBlending },
  };
  const particleKinds = new Set();
  function particles({ type = 'petals', count = 300, color, size, center = [0, 8, 0], area = [40, 16, 40] } = {}) {
    const p = PARTICLES[type] || PARTICLES.petals;
    const n = Math.max(1, Math.min(6000, Math.round(count) || 0));
    const lo = center[1] - area[1] / 2;
    const hi = center[1] + area[1] / 2;
    particleKinds.add(type);
    if (type === 'rain') {
      // Rain reads as streaks, slanted by the wind, not as floating dots.
      const len = 0.85;
      const slant = 0.22;
      const pos = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) {
        const x = center[0] + (random() - 0.5) * area[0];
        const y = lo + random() * area[1];
        const z = center[2] + (random() - 0.5) * area[2];
        pos.set([x, y, z, x - slant * len, y - len, z], i * 6);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      // Heavier rain gets fainter streaks, so a downpour reads as rain, not static.
      const opacity = THREE.MathUtils.clamp(0.5 * Math.sqrt(600 / n), 0.16, 0.45);
      const mat = new THREE.LineBasicMaterial({ color: color ?? p.color, transparent: true, opacity, depthWrite: false, blending: p.blend });
      const lines = new THREE.LineSegments(geo, mat);
      lines.frustumCulled = false;
      effects.add(lines);
      updates.push((t, dt) => {
        const d = p.fall * dt;
        for (let i = 0; i < n; i++) {
          const o = i * 6;
          let y = pos[o + 1] - d;
          if (y < lo) y += area[1];
          pos[o + 1] = y;
          pos[o + 4] = y - len;
        }
        geo.attributes.position.needsUpdate = true;
      });
      return lines;
    }
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = center[0] + (random() - 0.5) * area[0];
      pos[i * 3 + 1] = center[1] + (random() - 0.5) * area[1];
      pos[i * 3 + 2] = center[2] + (random() - 0.5) * area[2];
      seed[i] = random() * 100;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: color ?? p.color, size: size ?? p.size, transparent: true, opacity: 0.95,
      depthWrite: false, blending: p.blend, sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    effects.add(points);
    updates.push((t, dt) => {
      for (let i = 0; i < n; i++) {
        let y = pos[i * 3 + 1] - p.fall * dt;
        if (y < lo) y = hi;
        if (y > hi) y = lo;
        pos[i * 3 + 1] = y;
        pos[i * 3] += Math.sin(t * 0.7 + seed[i]) * p.sway * dt;
        pos[i * 3 + 2] += Math.cos(t * 0.6 + seed[i] * 1.3) * p.sway * dt;
      }
      geo.attributes.position.needsUpdate = true;
      if (type === 'fireflies') mat.opacity = 0.65 + Math.sin(t * 3.1) * 0.3;
    });
    return points;
  }

  const pointLights = [];
  function light({ x = 0, y = 4, z = 0, color = 0xffb35c, intensity = 6, distance = 12, flicker = false } = {}) {
    if (pointLights.length >= 8) return null; // more lights cost real fps on laptops
    const l = new THREE.PointLight(color, intensity, distance, 2);
    l.position.set(x, y, z);
    scene.add(l);
    pointLights.push(l);
    if (flicker) {
      const amount = typeof flicker === 'number' ? THREE.MathUtils.clamp(flicker, 0, 1) : 0.28;
      const s = random() * 10;
      updates.push((t) => {
        l.intensity = intensity * (1 - amount * 0.5 + (Math.sin(t * 9 + s) * 0.57 + Math.sin(t * 23 + s) * 0.43) * amount * 0.5);
      });
    }
    return l;
  }

  /** A lighthouse or searchlight: `count` shafts of light sweeping around the
   *  lamp at (x, y, z), each with a real spotlight that lights what it passes.
   *  Built in start(), when the world's size is known: a shaft reaches well
   *  past the island but not to infinity, and is never a laser-thin line. */
  let spotLights = 0;
  const pendingBeams = [];
  const beamRigs = [];
  function beam(params = {}) {
    const group = new THREE.Group();
    const p = params || {};
    group.position.set(Number(p.x) || 0, Number(p.y ?? 10) || 0, Number(p.z) || 0);
    effects.add(group);
    if (bounds) buildBeam(group, p);
    else pendingBeams.push({ group, params: p });
    return group;
  }
  function buildBeam(group, { color = 0xfff1c9, length = 30, width = 3, speed = 0.5, count = 2, tilt = 0.06, intensity = 1 } = {}) {
    const reach = bounds ? bounds.radius : 20;
    const len = THREE.MathUtils.clamp(Number(length) || 30, reach * 1.2, reach * 3.5);
    const wid = THREE.MathUtils.clamp(Number(width) || 3, len * 0.08, len * 0.2);
    const geometry = new THREE.ConeGeometry(wid, len, 40, 1, true);
    geometry.translate(0, -len / 2, 0); // apex at the lamp…
    geometry.rotateZ(Math.PI / 2); // …shining along +x
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uLength: { value: len },
        uOpacity: { value: 0.6 * intensity },
        uTime: { value: 0 },
      },
      vertexShader: BEAM_VERTEX,
      fragmentShader: BEAM_FRAGMENT,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const shafts = THREE.MathUtils.clamp(Math.round(count) || 1, 1, 4);
    const tiltRad = THREE.MathUtils.clamp(Number(tilt) || 0, -0.3, 0.3);
    const rig = { group, len, reach: len, cones: [], spots: [] };
    const shaftMaterials = [];
    for (let i = 0; i < shafts; i++) {
      const arm = new THREE.Group();
      arm.rotation.y = (i / shafts) * Math.PI * 2;
      const tilted = new THREE.Group();
      tilted.rotation.z = -tiltRad;
      const shaftMaterial = i === 0 ? material : material.clone();
      shaftMaterials.push(shaftMaterial);
      const cone = new THREE.Mesh(geometry, shaftMaterial);
      cone.renderOrder = 2;
      tilted.add(cone);
      rig.cones.push(cone);
      if (spotLights < 4) {
        spotLights++;
        // The light starts just outside the lantern room (so the lamp's own
        // walls aren't blown out) and matches the shaft's cone from there;
        // illuminance ~1.6 at the far end, like strong moonlight.
        const near = Math.max(3, reach * 0.12);
        const spot = new THREE.SpotLight(color, 1.6 * len * intensity, len * 1.8, Math.atan(wid / Math.max(1, len - near)) * 1.15, 0.55, 1);
        spot.position.set(near, 0, 0);
        spot.target.position.set(len, 0, 0);
        tilted.add(spot, spot.target);
        rig.spots.push(spot);
      }
      arm.add(tilted);
      group.add(arm);
    }
    beamRigs.push(rig);
    const coreColor = new THREE.Color(color);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 12),
      new THREE.MeshBasicMaterial({ color: coreColor.clone().multiplyScalar(2.2) }),
    );
    group.add(core);
    const lamp = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const rel = new THREE.Vector3();
    const turn = Number(speed) || 0.5;
    const baseOpacity = 0.6 * intensity;
    updates.push((t) => {
      group.rotation.y = t * turn;
      // The shafts stay visible all the way round. Only while a shaft actually
      // passes over the viewer (the camera inside its cone) does its volume
      // dim, and the lamp flashes instead, as a real lighthouse does.
      group.getWorldPosition(lamp);
      rel.subVectors(camera.position, lamp);
      let glare = 0;
      for (let i = 0; i < shafts; i++) {
        const a = group.rotation.y + (i / shafts) * Math.PI * 2;
        axis.set(Math.cos(a) * Math.cos(tiltRad), -Math.sin(tiltRad), -Math.sin(a) * Math.cos(tiltRad));
        const along = rel.dot(axis);
        let fade = 1;
        if (along > 0) {
          const radiusAt = (wid * Math.min(along, rig.reach)) / rig.reach;
          const perp = Math.sqrt(Math.max(0, rel.lengthSq() - along * along));
          fade = THREE.MathUtils.smoothstep(perp, radiusAt, radiusAt * 2.2 + 1.5);
          glare = Math.max(glare, 1 - fade);
        }
        shaftMaterials[i].uniforms.uTime.value = t;
        shaftMaterials[i].uniforms.uOpacity.value = baseOpacity * fade;
      }
      core.scale.setScalar(1 + glare * 2.5);
      core.material.color.copy(coreColor).multiplyScalar(2.2 + glare * 5);
    });
  }

  /** After the camera is placed: a shaft ends before it reaches the viewer, so
   *  a beam swinging toward the camera never turns into a wedge across the
   *  screen. */
  function fitBeamsToView() {
    const lamp = new THREE.Vector3();
    for (const rig of beamRigs) {
      rig.group.getWorldPosition(lamp);
      const toCamera = Math.hypot(camera.position.x - lamp.x, camera.position.z - lamp.z);
      const scale = Math.min(1, (0.8 * toCamera) / rig.len);
      rig.reach = rig.len * scale;
      for (const cone of rig.cones) cone.scale.x = scale;
      for (const spot of rig.spots) {
        spot.target.position.x = rig.len * scale;
        spot.distance = rig.len * scale * 1.8;
      }
    }
  }

  /** Storm lightning: a bolt in the background every ~`every` seconds, with
   *  the flash lighting the whole scene and the sky for a split second. */
  let lightningOn = null;
  function lightning({ every = 7, color = 0xdfe8ff } = {}) {
    if (lightningOn) return lightningOn;
    const flash = new THREE.DirectionalLight(color, 0);
    scene.add(flash, flash.target);
    const bolt = new THREE.Group();
    bolt.visible = false;
    effects.add(bolt);
    const boltMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), fog: false });
    const flashSky = new THREE.Color(0x8d9cc4);
    const baseTop = new THREE.Color(mood.top);
    const baseBottom = new THREE.Color(mood.bottom);
    const period = Math.max(2, Number(every) || 7);
    let next = 2.2 + random() * period * 0.5;
    let began = -1;

    function strike() {
      for (const child of bolt.children) child.geometry.dispose();
      bolt.clear();
      const { center, radius, groundY } = bounds;
      // Behind the hero as seen from where the viewer is looking now.
      const away = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0);
      if (away.lengthSq() < 1e-6) away.set(-1, 0, -1);
      away.normalize();
      const angle = Math.atan2(away.z, away.x) + (random() - 0.5) * 1.4;
      const dist = radius * (1.2 + random() * 0.8);
      const top = center.y + radius * 2.4;
      const steps = 10;
      const points = [];
      let px = center.x + Math.cos(angle) * dist;
      let pz = center.z + Math.sin(angle) * dist;
      for (let i = 0; i <= steps; i++) {
        points.push(new THREE.Vector3(px, top + (groundY - top) * (i / steps), pz));
        px += (random() - 0.5) * radius * 0.16;
        pz += (random() - 0.5) * radius * 0.16;
      }
      const thick = Math.max(0.12, radius * 0.006);
      const up = new THREE.Vector3(0, 1, 0);
      const segment = (a, b, r) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), 5, 1, true), boltMaterial);
        m.position.copy(a).add(b).multiplyScalar(0.5);
        m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
        bolt.add(m);
      };
      for (let i = 0; i < steps; i++) segment(points[i], points[i + 1], thick);
      let p = points[2 + Math.floor(random() * 4)].clone(); // one fork
      for (let i = 0; i < 4; i++) {
        const q = p.clone().add(new THREE.Vector3((random() - 0.5) * radius * 0.2, ((groundY - top) / steps) * 0.8, (random() - 0.5) * radius * 0.2));
        segment(p, q, thick * 0.6);
        p = q;
      }
      flash.position.copy(points[0]);
      flash.target.position.copy(center);
    }

    updates.push((t) => {
      if (!bounds) return;
      let level = 0;
      if (began < 0 && t >= next) {
        began = t;
        strike();
      }
      if (began >= 0) {
        const s = t - began;
        // Two quick pulses, then a fading afterglow.
        level = s < 0.09 ? 1 : s < 0.16 ? 0.15 : s < 0.3 ? 0.1 + 0.8 * (1 - (s - 0.16) / 0.14) : Math.max(0, 0.25 * (1 - (s - 0.3) / 0.35));
        if (s > 0.65) {
          began = -1;
          level = 0;
          next = t + period * (0.55 + random() * 0.9);
        }
      }
      bolt.visible = level > 0.2;
      flash.intensity = level * 1.5;
      hemi.intensity = mood.hemiI * (1 + level * 1.1);
      if (dome) {
        dome.material.uniforms.top.value.lerpColors(baseTop, flashSky, level * 0.35);
        dome.material.uniforms.bottom.value.lerpColors(baseBottom, flashSky, level * 0.25);
        dome.material.uniforms.uFlash.value = level;
      }
    });
    lightningOn = flash;
    return flash;
  }

  /** Weather sized to the finished world (built in start()): 'rain' | 'storm'
   *  | 'snow' | 'fireflies' | 'embers' | 'leaves' | 'petals' | 'bubbles' |
   *  'dust'. A storm brings rain, lightning, a cloud deck and a rough sea. */
  const WEATHER = {
    rain: { type: 'rain', count: 1400, low: 0, high: 1.9 },
    storm: { type: 'rain', count: 1800, low: 0, high: 1.9 },
    snow: { type: 'snow', count: 1100, low: 0, high: 1.7 },
    fireflies: { type: 'fireflies', count: 140, low: 0.05, high: 0.6 },
    embers: { type: 'embers', count: 180, low: 0.1, high: 1.2 },
    leaves: { type: 'leaves', count: 160, low: 0.2, high: 1.2 },
    petals: { type: 'petals', count: 220, low: 0.2, high: 1.2 },
    bubbles: { type: 'bubbles', count: 320, low: 0, high: 1.4 },
    dust: { type: 'dust', count: 260, low: 0.05, high: 1.1 },
  };
  const pendingWeather = [];
  function weather(kind = 'rain', { intensity = 1 } = {}) {
    const name = String(kind).toLowerCase();
    if (!WEATHER[name]) return null;
    pendingWeather.push({ name, intensity: THREE.MathUtils.clamp(Number(intensity) || 1, 0.2, 2) });
    if (name === 'storm') lightning({ every: 6 });
    return name;
  }
  function buildWeather({ name, intensity }) {
    const w = WEATHER[name];
    if (particleKinds.has(w.type)) return; // the scene already has its own
    const r = bounds.radius;
    const low = bounds.groundY + r * w.low;
    const high = bounds.groundY + r * w.high;
    particles({
      type: w.type,
      count: Math.round(w.count * intensity),
      center: [bounds.center.x, (low + high) / 2, bounds.center.z],
      area: [r * 3.2, high - low, r * 3.2],
    });
    // A storm roughens any calm sea the scene laid down.
    if (name === 'storm') for (const entry of pendingWater) entry.amp = Math.max(entry.amp, 0.34);
  }

  const onUpdate = (fn) => updates.push(fn);

  // ── start: build, frame, light, render ─────────────────────────────────
  let composer = null;
  function start() {
    const solidMesh = buildVoxelMesh(world, false);
    const glowMesh = buildVoxelMesh(world, true);
    if (solidMesh) scene.add(solidMesh);
    if (glowMesh) scene.add(glowMesh);
    for (const { group, store } of parts) {
      const s = buildVoxelMesh(store, false);
      const g = buildVoxelMesh(store, true);
      if (s) group.add(s);
      if (g) group.add(g);
    }
    if (solidMesh && waters.length) {
      const c = solidMesh.boundingBox.getCenter(new THREE.Vector3());
      floatOffShore(c.x, c.z);
    }

    const box = new THREE.Box3();
    for (const m of [solidMesh, glowMesh]) if (m) box.union(m.boundingBox);
    const partsBox = partsGroup.children.length ? new THREE.Box3().setFromObject(partsGroup) : new THREE.Box3();
    if (!partsBox.isEmpty()) box.union(partsBox);
    if (extras.children.length) box.union(new THREE.Box3().setFromObject(extras));
    if (box.isEmpty()) box.set(new THREE.Vector3(-5, 0, -5), new THREE.Vector3(5, 5, 5));

    // Frame the hero, not the terrain: when the world stands on ground (many
    // voxels at y <= 0), the camera fits what rises above it, so a big island
    // doesn't shrink the pagoda to a speck. Scenes without ground (space,
    // floating objects) are framed whole.
    const hero = new THREE.Box3();
    let groundCount = 0;
    let total = 0;
    for (const map of [world.solid, world.glowing]) {
      for (const k of map.keys()) {
        const [x, y, z] = k.split(',').map(Number);
        total++;
        if (y <= 0) groundCount++;
        else hero.expandByPoint(new THREE.Vector3(x - 0.5, y - 0.5, z - 0.5)).expandByPoint(new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5));
      }
    }
    if (!partsBox.isEmpty()) hero.union(partsBox);
    if (extras.children.length) hero.union(new THREE.Box3().setFromObject(extras));
    const frameBox = groundCount > total * 0.3 && !hero.isEmpty() && total - groundCount >= 20 ? hero : box;

    const size = frameBox.getSize(new THREE.Vector3());
    const center = frameBox.getCenter(new THREE.Vector3());
    // The true bounding-sphere radius (half the diagonal): half the largest
    // side underestimates a cube-ish build by up to 1.7x and crops it.
    const radius = size.length() * 0.5 + 0.5;
    const worldSize = box.getSize(new THREE.Vector3());
    const worldRadius = Math.max(worldSize.x, worldSize.y, worldSize.z) * 0.5 + 0.5;
    bounds = { center: center.clone(), radius: Math.max(radius, worldRadius), groundY: box.min.y };
    for (const { group, params } of pendingBeams) buildBeam(group, params);
    for (const entry of pendingWeather) buildWeather(entry);
    for (const entry of pendingWater) buildWater(entry);

    // Fog matches the sky's horizon colour so the ground melts into it — no seam.
    const horizon = new THREE.Color(mood.bottom);
    dome = skyDome(mood.top, mood.bottom, Math.max(radius, worldRadius) * 40);
    dome.position.copy(center);
    if (lightningOn) {
      // A storm gets a drifting cloud deck; lightning lights it from inside.
      dome.material.uniforms.uClouds.value = 0.85;
      dome.material.uniforms.uCloudColor.value.set(mood.fog ?? mood.bottom).lerp(new THREE.Color(0x0a0d14), 0.35);
    }
    scene.add(dome);
    updates.push((t) => {
      dome.material.uniforms.uTime.value = t;
    });
    if (opts.ground && mood.ground !== null) {
      const groundColor = new THREE.Color(opts.groundColor ?? mood.ground).lerp(horizon, 0.3);
      const g = new THREE.Mesh(
        new THREE.CircleGeometry(Math.max(radius, worldRadius) * 12, 64).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: groundColor, roughness: 1 }),
      );
      g.position.set(center.x, box.min.y - 0.5, center.z);
      g.receiveShadow = true;
      scene.add(g);
    }
    if (mood.fog !== null) scene.fog = new THREE.Fog(horizon, radius * 2.6, Math.max(radius * 8, worldRadius * 3));
    if (mood.stars) {
      const r = Math.max(radius, worldRadius);
      particles({ type: 'stars', count: 900, center: [center.x, center.y + r * 6, center.z], area: [r * 30, r * 10, r * 30] });
    }

    const dir = new THREE.Vector3(...mood.sunDir).normalize();
    sun.position.copy(center).addScaledVector(dir, Math.max(radius, worldRadius) * 3);
    sun.target.position.copy(center);
    rim.position.copy(center).addScaledVector(new THREE.Vector3(-dir.x, Math.max(0.35, dir.y), -dir.z).normalize(), Math.max(radius, worldRadius) * 3);
    rim.target.position.copy(center);
    const cam = sun.shadow.camera;
    const shadowR = Math.min(worldRadius, radius * 2.2) * 1.15;
    cam.left = cam.bottom = -shadowR;
    cam.right = cam.top = shadowR;
    cam.near = 0.5;
    cam.far = Math.max(radius, worldRadius) * 7;
    cam.updateProjectionMatrix();

    // Frame what was actually built: project sample points of the hero (or the
    // whole build) and solve for the distance and aim that fill ~86% of the
    // narrower dimension, centred — tall towers keep their tops, wide islands
    // their edges, in landscape and portrait windows alike.
    const samples = [];
    const heroOnly = frameBox === hero;
    for (const map of [world.solid, world.glowing]) {
      const stride = Math.max(1, Math.floor(map.size / 3000));
      let i = 0;
      for (const k of map.keys()) {
        if (i++ % stride) continue;
        const [x, y, z] = k.split(',').map(Number);
        if (!heroOnly || y > 0) samples.push(new THREE.Vector3(x, y, z));
      }
    }
    for (const b of [partsBox, extras.children.length ? new THREE.Box3().setFromObject(extras) : null]) {
      if (!b || b.isEmpty()) continue;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) samples.push(new THREE.Vector3(x, y, z));
    }
    if (!samples.length) for (const x of [frameBox.min.x, frameBox.max.x]) for (const y of [frameBox.min.y, frameBox.max.y]) for (const z of [frameBox.min.z, frameBox.max.z]) samples.push(new THREE.Vector3(x, y, z));
    const halfV = THREE.MathUtils.degToRad(camera.fov) / 2;
    const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
    const view = new THREE.Vector3(1, 0.62, 1.25).normalize();
    const ndc = new THREE.Vector3();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    /** Distance and aim that put `points` in ~`fill` of the frame, centred. */
    const solveView = (points, fill, aim, start, reaim = true) => {
      const target = aim.clone();
      let distance = start;
      for (let pass = 0; pass < 10; pass++) {
        camera.position.copy(target).addScaledVector(view, distance);
        camera.near = Math.max(0.05, distance / 200);
        camera.far = Math.max(distance * 30, radius * 90);
        camera.lookAt(target);
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, behind = false;
        for (const p of points) {
          ndc.copy(p).project(camera);
          if (ndc.z > 1) { behind = true; break; }
          minX = Math.min(minX, ndc.x); maxX = Math.max(maxX, ndc.x);
          minY = Math.min(minY, ndc.y); maxY = Math.max(maxY, ndc.y);
        }
        if (behind) { distance *= 1.4; continue; }
        const halfHeight = Math.tan(halfV) * distance;
        right.setFromMatrixColumn(camera.matrixWorld, 0);
        up.setFromMatrixColumn(camera.matrixWorld, 1);
        if (reaim) {
          target.addScaledVector(right, ((minX + maxX) / 2) * halfHeight * camera.aspect).addScaledVector(up, ((minY + maxY) / 2) * halfHeight);
          distance *= THREE.MathUtils.clamp(Math.max((maxX - minX) / 2, (maxY - minY) / 2) / fill, 0.5, 2);
        } else {
          distance *= THREE.MathUtils.clamp(Math.max(-minX, maxX, -minY, maxY) / fill, 0.5, 2);
        }
      }
      return { target, distance };
    };
    const aim = new THREE.Vector3(center.x, frameBox.min.y + size.y * 0.45, center.z);
    const sphereFit = radius / Math.sin(Math.min(halfV, halfH));
    let best = solveView(samples, heroOnly ? 0.8 : 0.86, aim, sphereFit);
    if (heroOnly) {
      // The hero fills the frame, but not so tightly that its garden, island
      // or street disappears: most of the whole build stays in view.
      const whole = [];
      for (const map of [world.solid, world.glowing]) {
        const stride = Math.max(1, Math.floor(map.size / 3000));
        let i = 0;
        for (const k of map.keys()) if (i++ % stride === 0) whole.push(new THREE.Vector3(...k.split(',').map(Number)));
      }
      // Same aim (the hero stays centred); only ever further away.
      const context = solveView(whole, 1.15, best.target, best.distance, false);
      if (context.distance > best.distance) best = { target: best.target, distance: context.distance };
    }
    controls.target.copy(best.target);
    const fitDistance = best.distance;
    camera.position.copy(controls.target).addScaledVector(view, fitDistance);
    camera.near = Math.max(0.05, fitDistance / 200);
    camera.far = Math.max(fitDistance * 30, radius * 90);
    camera.updateProjectionMatrix();
    fitBeamsToView();
    controls.minDistance = fitDistance * 0.3;
    controls.maxDistance = fitDistance * 2.4;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.update();

    const strength = opts.bloom ?? mood.bloom;
    if (strength > 0) {
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), strength, 0.55, 0.88));
      composer.addPass(new OutputPass());
    }
    addTitleCard(opts.title, opts.subtitle, opts.mood === 'night' || opts.mood === 'space');

    const timer = new THREE.Timer();
    renderer.setAnimationLoop((now) => {
      timer.update(now);
      const t = timer.getElapsed();
      const dt = Math.min(timer.getDelta(), 0.05);
      for (const fn of updates) fn(t, dt);
      controls.update(dt); // damping for the viewer's drag; orbits only if autoRotate was asked for
      if (composer) composer.render();
      else renderer.render(scene, camera);
    });
    window.__prismosScene = {
      voxels: voxels.count,
      visibleVoxels: (solidMesh?.count || 0) + (glowMesh?.count || 0),
      parts: parts.length,
      extras: extras.children.length,
      autoRotate: controls.autoRotate,
    };
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer?.setSize(window.innerWidth, window.innerHeight);
  });

  return { THREE, scene, camera, renderer, controls, voxels, part, add, water, particles, weather, light, beam, lightning, onUpdate, random, start };
}
