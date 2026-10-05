// Scene Builder — one short prompt becomes one polished, real-time 3D scene.
//
// "a voxel pagoda garden" → a single self-contained HTML file the browser opens
// straight away. The local model only builds the world, on top of the PrismOS
// Scene Kit (sceneKit.js: renderer, mood lighting, sky, fog, shadows, bloom,
// instanced voxels, movable parts, light beams, a still framed camera, title
// card). PrismOS then:
//   • inlines the kit and its own bundled copy of three.js (MIT) as data: URLs
//     in an import map, so the file works with Wi-Fi off and never touches a CDN;
//   • rewrites the CDN/legacy import styles models habitually emit to that copy;
//   • checks the result (cut-off output, repetition loops, invalid declarations,
//     duplicate top-level names, online resources, unknown modules) and spends
//     one fix pass on anything it finds;
//   • reports honest generation stats (tokens, seconds, tokens/s).

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { GeneratedAttachment } from "../types";
import { hasCreateVerb } from "./docGen";

// ─── Detection ────────────────────────────────────────────────────────────────

/** Unmistakably 3D/real-time-graphics words. "3d printing" is not a scene. */
const SCENE_STRONG =
  /\b(voxel(?:s|ated)?|3-?d(?![\s-]*print)|three\.?js|webgl|low[\s-]?poly|isometric|diorama|shaders?|ray-?march(?:ed|ing)?)\b/;
const SCENE_MOTION = /\b(animated|animation|scene|simulation|screensaver|particles?)\b/;
const SCENE_SUBJECT =
  /\b(garden|city|cityscape|town|village|island|forest|ocean|sea|beach|lake|river|mountains?|landscape|terrain|planet|solar system|galaxy|space|universe|aquarium|reef|castle|temple|pagoda|shrine|lighthouse|campfire|fireflies|snow(?:fall)?|rain|storm|aurora|night sky|stars|fireworks|robot|spaceship|dragon|trees?|flowers?|waterfall|volcano|desert|cave|world)\b/;
/** Requests that belong to other lanes (documents, data, web apps, games). */
const NOT_A_SCENE =
  /\b(power\s?point|pptx?|presentation|slides?|slide\s?deck|deck|docx?|word\s+doc(?:ument)?|report|memo|essay|letter|spreadsheet|xlsx|csv|markdown|chart|graph|plot|table|dashboard|website|web\s?site|web\s?app|landing\s+page|store(?:front)?|e-?commerce|tracker|portfolio|games?|playable|resume|email)\b/;
const QUESTION =
  /^(what|why|where|when|who|which|how|is|are|does|do|did|should|would|could|can\s+(?:i|we)|explain|describe|tell\s+me|compare|summari[sz]e|review|analy[sz]e|translate)\b/;
const DRAW_VERB =
  /^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:show\s+me|render|draw|animate|visuali[sz]e|paint|sculpt)\b/;

/**
 * Detect a request for a real-time 3D scene. Checked after document requests
 * and before the App Builder (a "3d" request is better served by one scene
 * file than by a multi-file static site with no graphics library).
 */
export function detectSceneRequest(input: string): boolean {
  const t = input.toLowerCase().replace(/\s+/g, " ").trim();
  // The explicit command always wins: "/scene a lighthouse at sunset".
  if (/^\/scene\b/.test(t)) return t.replace(/^\/scene\b/, "").trim().length > 0;
  if (!t || t.length > 400) return false;
  if (QUESTION.test(t) || NOT_A_SCENE.test(t)) return false;
  const verb = hasCreateVerb(t) || DRAW_VERB.test(t);
  const strong = SCENE_STRONG.test(t);
  // "build a voxel pagoda garden", "make a low-poly island in three.js"
  if (strong && verb) return true;
  // The bare one-liner people paste from demos: "a voxel pagoda garden".
  if (strong && /^(?:a|an)\s/.test(t) && t.split(" ").length <= 14) return true;
  // "make an animated aquarium", "create a fireflies-at-dusk scene"
  return verb && SCENE_MOTION.test(t) && SCENE_SUBJECT.test(t);
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

/** three.js addons bundled for offline use (closed under their own imports). */
export const BUNDLED_ADDONS = [
  "controls/OrbitControls.js",
  "math/ImprovedNoise.js",
  "math/SimplexNoise.js",
  "objects/Sky.js",
  "geometries/RoundedBoxGeometry.js",
  "utils/BufferGeometryUtils.js",
  "environments/RoomEnvironment.js",
  "postprocessing/EffectComposer.js",
  "postprocessing/RenderPass.js",
  "postprocessing/UnrealBloomPass.js",
  "postprocessing/OutputPass.js",
  "postprocessing/ShaderPass.js",
  "postprocessing/MaskPass.js",
  "postprocessing/Pass.js",
  "shaders/CopyShader.js",
  "shaders/LuminosityHighPassShader.js",
  "shaders/OutputShader.js",
] as const;

const SCENE_BRIEF = `You are PrismOS Scene, a world-class voxel artist and creative coder. The user gives you a short idea; you turn it into ONE complete HTML file containing a polished, real-time 3D scene that someone would screenshot and share.

BUILD ON THE PRISMOS SCENE KIT. It already provides the renderer, mood lighting with soft shadows, sky, fog, a ground that fades into the distance, bloom, a still camera framed on whatever you build (the viewer drags to look around), resize and the title card. You only build the world. Use ONE <script type="module">:

    import * as THREE from 'three';
    import { createWorld } from 'prismos/scene';
    const world = createWorld({ title: 'Voxel Pagoda Garden', subtitle: 'one short poetic line', mood: 'golden-hour' });
    // mood: 'day' | 'golden-hour' | 'sunset' | 'night' | 'space' | 'underwater' — golden-hour unless the request implies another
    // add autoRotate: true ONLY if the user asks for a turntable or rotating display; otherwise the camera stays still
    const { voxels, random } = world;   // random() is seeded (0..1): use it instead of Math.random

KIT API (integer voxel coordinates, 1 voxel = 1 unit, y is up, ground level is y = 0):
    voxels.set(x, y, z, color)                      // one voxel
    voxels.box(x0, y0, z0, x1, y1, z1, color)       // filled box, inclusive corners
    voxels.shell(x0, y0, z0, x1, y1, z1, color)     // hollow walls only (no floor or ceiling)
    voxels.cylinder(cx, y0, cz, radius, height, color)
    voxels.sphere(cx, cy, cz, radius, color, fill)  // fill 0..1 < 1 makes it airy, e.g. foliage 0.8
    voxels.glow(x, y, z, color)                     // emissive voxel: lanterns, lit windows, lava, crystals
    voxels.remove(x, y, z)   voxels.has(x, y, z)    // carve doors, windows, arches
    // any color argument may be a hex number or a function (x, y, z) => hex, for natural variation
    world.add(object3D)                              // your own THREE meshes (they cast and receive shadows)
    world.water({ x, y, z, width, depth, color, waves })   // animated water; waves 0.05 calm … 0.4 stormy (foam on the crests)
    world.weather(kind)                              // rain | storm | snow | fireflies | embers | leaves | petals | bubbles | dust: sized to your world automatically; 'storm' adds lightning, clouds and a rough sea
    world.particles({ type, count, center: [x, y, z], area: [w, h, d] })  // the same particle types, placed by hand (e.g. embers over one chimney)
    world.light({ x, y, z, color, intensity, distance, flicker })          // warm point light, at most 8
    world.beam({ x, y, z, color, length, width, speed })   // lighthouse / searchlight: shafts of light sweeping round the lamp, lighting what they pass
    world.lightning({ every })                       // storm: a lightning bolt and flash every ~N seconds
    const sails = world.part({ x, y, z })            // a MOVING piece pivoting at (x, y, z): build it with sails.voxels (same API as voxels, coordinates relative to the pivot)
    world.onUpdate((t, dt) => { sails.rotation.z = t * 0.8; })   // move parts only: rotation (sails, a door), position (a bobbing boat, a gull), scale
    world.start()                                    // ALWAYS the last line: builds, frames the camera, starts rendering

Tiny example of the style (a different subject — do not copy it):
    const world = createWorld({ title: 'Lakeside Cabin', subtitle: 'a quiet morning', mood: 'day' });
    const { voxels, random } = world;
    voxels.box(-9, -1, -9, 9, -1, 9, () => (random() < 0.5 ? 0x6f9a4a : 0x5e8a3e));
    voxels.shell(-3, 0, -3, 3, 3, 3, 0x8a5a36);
    voxels.remove(0, 0, 3); voxels.remove(0, 1, 3);
    for (let i = 0; i <= 4; i++) voxels.box(-4 + i, 4 + i, -4, 4 - i, 4 + i, 4, 0x7a3b2e);
    voxels.cylinder(6, 0, -5, 0.5, 4, 0x5a3a22); voxels.sphere(6, 6, -5, 2.6, 0x4f8f3a, 0.8);
    world.water({ x: -6, y: 0.1, z: 6, width: 6, depth: 4 });
    const boat = world.part({ x: -6, y: 0.5, z: 6 });
    boat.voxels.box(-1, 0, 0, 1, 0, 0, 0x7a4a2a); boat.voxels.set(0, 1, 0, 0xf2efe6);
    world.onUpdate((t) => { boat.position.y = 0.5 + Math.sin(t * 1.6) * 0.12; boat.rotation.z = Math.sin(t * 1.2) * 0.06; });
    world.particles({ type: 'leaves', count: 120, center: [0, 8, 0], area: [24, 12, 24] });
    world.start();

YOU FILL IN THE DETAIL. The user types one short line and expects a finished world: everything that belongs in that place, at that time, in that weather, without being told. Start the script with a short plan as comments, then build exactly that:
    // Hero: <the main subject, its size and architecture>
    // Setting: <ground, water, terrain shape>
    // Details: <at least six specific props and small story details that belong here>
    // Motion: <the one hero motion, plus ambient motion>
    // Light: <mood, light sources that make sense: windows, lanterns, fire, beams>
    // Palette: <5-7 colours>

ART DIRECTION — this is what makes it great
- Scale and composition: a clear hero subject 20–35 voxels tall in the centre, standing on terrain about 1.5–2 times its footprint — an island or garden with an organic, irregular edge (use distance and noise), never a big square slab. Put foreground, midground and background interest around the hero (paths, plants, water, props). Everything stands on terrain or a plinth at y >= -3 — nothing floats.
- Structure: give the hero real architecture or anatomy with correct proportion — e.g. a pagoda has stacked tiers that shrink upward, each with walls, window openings, a floor, and a roof that overhangs by 2 and turns up at the corners, then a spire; a tree has a tapering trunk, branches and layered canopy clumps; a castle has walls, crenellations, towers and a gate.
- Palette: a cohesive 5–7 colour palette chosen for the subject. Vary grass, stone, roof tiles and foliage by passing a colour FUNCTION (e.g. const ROOF = () => random() < 0.5 ? 0x9c3b2a : 0x8f3426; then voxels.box(…, ROOF) — pass ROOF itself, not ROOF()) so every voxel gets its own shade.
- Life: move only what would really move. Give the scene one hero motion people notice — a lighthouse beam sweeping (world.beam), windmill sails turning, a boat rocking, a gull circling (world.part + onUpdate) — plus ambient water, particles or flickering lanterns. Buildings, terrain and the camera stay still — never rotate or move the whole scene, never move the camera.
- Write compact code: helper functions and loops (tier(), tree(x, z), lantern(x, z)), small arrays of positions. Roughly 120–300 lines of world-building.

RULES
- Import only 'three' and 'prismos/scene'. Never write an import map, <script src>, CDN URLs, fetch(), web fonts, images or textures — everything is procedural, so the file works with Wi-Fi off.
- Do not create your own renderer, camera, lights, controls, fog or animation loop — the kit owns them.
- Complete, working code only: no placeholders, TODOs, ellipses, empty loops or repeated filler lines.`;

const OUTPUT_FORMAT = [
  "Output format — follow EXACTLY:",
  "Line 1: FILENAME: <short-kebab-case-name>.html",
  "Line 2 onward: ONLY the raw HTML document. No code fences, no commentary before or after.",
].join("\n");

/**
 * What a set designer would add for the words in the request, in kit terms:
 * the user writes "a lighthouse in a storm", the scene gets the beam, the
 * keeper's cottage, the boat at the jetty, the rough sea and the lightning.
 */
const DIRECTOR_CUES: Array<{ match: RegExp; notes: string[] }> = [
  { match: /\blighthouse\b/, notes: ["a tall tower that dominates: 22-30 voxels from the rocks to the lantern, tapering, in red and white bands, with a gallery and a lantern room", "the lamp: world.beam({ x, y, z }) at the lantern room, shafts sweeping out over the sea", "a keeper's cottage with a warm lit window (voxels.glow + world.light)", "steps or a small jetty down to the water, with a rowing boat that rocks (world.part)"] },
  { match: /\b(storm\w*|thunder\w*|lightning|tempest|hurricane|gale)\b/, notes: ["world.weather('storm'): rain, lightning, a drifting cloud deck and a rough sea", "world.water waves: 0.4", "trees and flags leaning with the wind"] },
  { match: /\b(rain\w*|drizzle|downpour|monsoon)\b/, notes: ["world.weather('rain')", "a darker, wetter palette and small puddles (flat water, waves: 0.02)"] },
  { match: /\b(snow\w*|blizzard|winter\w*|frozen|icy|christmas)\b/, notes: ["world.weather('snow')", "snow on roofs, branches and the ground (white voxels on top)", "a chimney with embers rising over it (world.particles type 'embers' above the chimney) and warm windows"] },
  { match: /\b(night|midnight|moonlit|moonlight|starry)\b/, notes: ["mood: 'night'", "light sources that make sense: lit windows, lanterns, a fire (world.light with flicker)"] },
  { match: /\b(sunset|dusk|twilight)\b/, notes: ["mood: 'sunset'", "first lights coming on in windows and lanterns"] },
  { match: /\b(island|sea|ocean|coast\w*|beach|harbou?r|bay|cliffs?|shore)\b/, notes: ["world.water much wider than the land (3x or more): it runs on to the horizon, with surf on every shore", "a shoreline the waves can break on: rocks or sand at the waterline, a sea stack or two", "life on the water: a boat or buoy on world.part, bobbing"] },
  { match: /\b(forest|woods?|grove|jungle|trees)\b/, notes: ["several tree species and sizes with layered canopies, undergrowth, a fallen log", "world.weather('fireflies') at dusk or night, world.weather('leaves') by day"] },
  { match: /\b(village|town|city|street|market|harbou?r)\b/, notes: ["buildings that differ in height, roof and colour along a street or quay", "lit windows and lamp posts at night (world.light)", "props: carts, barrels, crates, signs, a well or fountain"] },
  { match: /\b(castle|fortress|keep|citadel)\b/, notes: ["walls with crenellations, towers, a gate", "banners that wave (world.part)", "torches flickering at the gate"] },
  { match: /\b(windmill|mill|farm)\b/, notes: ["windmill sails on world.part at the hub, turning (rotation.z in onUpdate)", "fields in strips of different crops, a fence, haystacks"] },
  { match: /\b(volcano|lava|magma|eruption)\b/, notes: ["glowing lava (voxels.glow) in the crater and running down a channel", "world.weather('embers')"] },
  { match: /\b(underwater|reef|coral|aquarium|seabed|ocean floor)\b/, notes: ["mood: 'underwater'", "coral in several colours, kelp swaying on world.part", "fish on world.part swimming slow loops, world.weather('bubbles')"] },
  { match: /\b(space|planet|galaxy|asteroid|space station|orbit\w*)\b/, notes: ["mood: 'space'", "small moons or satellites orbiting on world.part", "lit windows or running lights on any station"] },
  { match: /\b(desert|dunes?|oasis|canyon)\b/, notes: ["dunes or mesas with soft layered colour", "an oasis or camp as the focal point", "world.weather('dust')"] },
  { match: /\b(garden|pagoda|temple|shrine|zen)\b/, notes: ["paths, a little bridge over a pond, stone lanterns that glow", "blossom trees with world.weather('petals')"] },
  { match: /\b(campfire|camp(?:ing)?|bonfire|fireplace|cabin)\b/, notes: ["a fire: glow voxels + world.light({ flicker: true }) + embers over it", "logs to sit on, a tent or a woodpile"] },
  { match: /\b(waterfall|river|stream|lake|pond)\b/, notes: ["water that belongs to the land: a river or pond of world.water at the right level, with surf where it meets stone", "reeds, stepping stones, a small dock"] },
];

/** The director's notes for one request (deduplicated, at most 12). */
export function directorNotes(idea: string): string[] {
  const t = idea.toLowerCase();
  const notes: string[] = [];
  for (const cue of DIRECTOR_CUES) {
    if (!cue.match.test(t)) continue;
    for (const n of cue.notes) if (!notes.includes(n)) notes.push(n);
  }
  return notes.slice(0, 12);
}

/** Phase-1 prompt: write the scene from the user's one-liner. */
export function scenePrompt(input: string, context?: string): string {
  const notes = directorNotes(input);
  return [
    SCENE_BRIEF,
    "",
    ...(context ? ["Recent conversation (the request may refer to it):", context, ""] : []),
    `User request: "${input}"`,
    "",
    "DIRECTOR'S NOTES: the user wrote one line; fold these in, then add three small story details of your own that nobody asked for but everyone notices. Keep the land low and the hero tall, so the hero clearly rises above everything else:",
    ...(notes.length ? notes.map((n) => `- ${n}`) : ["- everything that naturally belongs in this place, at this time of day, in this weather"]),
    "",
    OUTPUT_FORMAT,
  ].join("\n");
}

/** Fix pass: the previous file plus the concrete problems the checks found. */
export function sceneFixPrompt(input: string, previousHtml: string, issues: string[]): string {
  return [
    SCENE_BRIEF,
    "",
    `User request: "${input}"`,
    "",
    "Your previous version is below. PrismOS's checks found these problems:",
    ...issues.map((i) => `- ${i}`),
    "",
    "Return the COMPLETE corrected file. Keep everything that already works and fix only what is listed. Leave the import map out — PrismOS injects it.",
    "",
    "PREVIOUS VERSION:",
    previousHtml,
    "",
    OUTPUT_FORMAT,
  ].join("\n");
}

/** Regenerate pass for output that was cut off or looped — no code to keep. */
export function sceneRetryPrompt(input: string, issues: string[], context?: string): string {
  return [
    scenePrompt(input, context),
    "",
    "Your previous attempt failed PrismOS's checks:",
    ...issues.map((i) => `- ${i}`),
    "Write it again, more compactly (under 450 lines), finishing the whole document.",
  ].join("\n");
}

// ─── Offline three.js ─────────────────────────────────────────────────────────

export interface ThreeSources {
  core: string;
  module: string;
  /** PrismOS Scene Kit runtime (served as 'prismos/scene'). */
  kit: string;
  /** Addon path relative to examples/jsm (e.g. "controls/OrbitControls.js") → source. */
  addons: Record<string, string>;
}

// Static loader table so Vite bundles exactly these files (lazily, as raw text).
// The relative paths are deliberate: three's package `exports` map doesn't
// expose build/*.min.js, and the minified builds keep each scene file ~1 MB.
const ADDON_LOADERS: Record<(typeof BUNDLED_ADDONS)[number], () => Promise<{ default: string }>> = {
  "controls/OrbitControls.js": () => import("../../node_modules/three/examples/jsm/controls/OrbitControls.js?raw"),
  "math/ImprovedNoise.js": () => import("../../node_modules/three/examples/jsm/math/ImprovedNoise.js?raw"),
  "math/SimplexNoise.js": () => import("../../node_modules/three/examples/jsm/math/SimplexNoise.js?raw"),
  "objects/Sky.js": () => import("../../node_modules/three/examples/jsm/objects/Sky.js?raw"),
  "geometries/RoundedBoxGeometry.js": () => import("../../node_modules/three/examples/jsm/geometries/RoundedBoxGeometry.js?raw"),
  "utils/BufferGeometryUtils.js": () => import("../../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js?raw"),
  "environments/RoomEnvironment.js": () => import("../../node_modules/three/examples/jsm/environments/RoomEnvironment.js?raw"),
  "postprocessing/EffectComposer.js": () => import("../../node_modules/three/examples/jsm/postprocessing/EffectComposer.js?raw"),
  "postprocessing/RenderPass.js": () => import("../../node_modules/three/examples/jsm/postprocessing/RenderPass.js?raw"),
  "postprocessing/UnrealBloomPass.js": () => import("../../node_modules/three/examples/jsm/postprocessing/UnrealBloomPass.js?raw"),
  "postprocessing/OutputPass.js": () => import("../../node_modules/three/examples/jsm/postprocessing/OutputPass.js?raw"),
  "postprocessing/ShaderPass.js": () => import("../../node_modules/three/examples/jsm/postprocessing/ShaderPass.js?raw"),
  "postprocessing/MaskPass.js": () => import("../../node_modules/three/examples/jsm/postprocessing/MaskPass.js?raw"),
  "postprocessing/Pass.js": () => import("../../node_modules/three/examples/jsm/postprocessing/Pass.js?raw"),
  "shaders/CopyShader.js": () => import("../../node_modules/three/examples/jsm/shaders/CopyShader.js?raw"),
  "shaders/LuminosityHighPassShader.js": () => import("../../node_modules/three/examples/jsm/shaders/LuminosityHighPassShader.js?raw"),
  "shaders/OutputShader.js": () => import("../../node_modules/three/examples/jsm/shaders/OutputShader.js?raw"),
};

let threeSourcesPromise: Promise<ThreeSources> | null = null;

/** Load (once) the bundled three.js build and addons as raw source text. */
export function loadThreeSources(): Promise<ThreeSources> {
  threeSourcesPromise ??= (async () => {
    const [core, module, kit] = await Promise.all([
      import("../../node_modules/three/build/three.core.min.js?raw"),
      import("../../node_modules/three/build/three.module.min.js?raw"),
      import("./sceneKit.js?raw"),
    ]);
    const entries = await Promise.all(
      BUNDLED_ADDONS.map(async (path) => [path, (await ADDON_LOADERS[path]()).default] as const),
    );
    return { core: core.default, module: module.default, kit: kit.default, addons: Object.fromEntries(entries) };
  })();
  return threeSourcesPromise;
}

function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const jsDataUrl = (source: string) => `data:text/javascript;base64,${base64Utf8(source)}`;

/** Posix-normalize "postprocessing/../shaders/CopyShader.js" style joins. */
function joinAddonPath(fromFile: string, relative: string): string {
  const parts = fromFile.split("/").slice(0, -1);
  for (const seg of relative.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

/** Relative imports inside an addon, rewritten to bare `three/addons/…` specifiers. */
function addonDependencies(path: string, source: string): { source: string; deps: string[] } {
  const deps: string[] = [];
  const rewritten = source.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])(\.{1,2}\/[^"']+)\2/g,
    (_all, lead: string, quote: string, rel: string) => {
      const target = joinAddonPath(path, rel);
      deps.push(target);
      return `${lead}${quote}three/addons/${target}${quote}`;
    },
  );
  return { source: rewritten, deps };
}

/**
 * Import map that serves three.js and the requested addons (plus their own
 * dependencies) from data: URLs — the scene file needs no network and no
 * server. Unknown addons are returned so the caller can report them.
 */
export function buildImportMap(
  addonPaths: string[],
  sources: ThreeSources,
  opts: { kit?: boolean } = {},
): { imports: Record<string, string>; unknown: string[] } {
  const imports: Record<string, string> = {
    "three/core": jsDataUrl(sources.core),
    three: jsDataUrl(sources.module.split('"./three.core.min.js"').join('"three/core"')),
  };
  const unknown: string[] = [];
  const queue = [...addonPaths];
  if (opts.kit) {
    imports[KIT_SPECIFIER] = jsDataUrl(sources.kit);
    for (const m of sources.kit.matchAll(/from\s*["']three\/addons\/([^"']+)["']/g)) queue.push(m[1]);
  }
  const seen = new Set<string>();
  while (queue.length) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const source = sources.addons[path];
    if (source === undefined) {
      unknown.push(path);
      continue;
    }
    const { source: rewritten, deps } = addonDependencies(path, source);
    imports[`three/addons/${path}`] = jsDataUrl(rewritten);
    queue.push(...deps);
  }
  return { imports, unknown };
}

// ─── Checks + finalize ────────────────────────────────────────────────────────

/** The kit's module specifier inside generated scenes. */
export const KIT_SPECIFIER = "prismos/scene";

/** Map a module specifier a model wrote to the bundled one, or null if foreign. */
export function normalizeThreeSpecifier(spec: string): string | null {
  const s = spec.trim();
  if (s === KIT_SPECIFIER) return KIT_SPECIFIER;
  const addon = (p: string) => `three/addons/${/\.js$/.test(p) ? p : `${p}.js`}`;
  if (s === "three" || /^three\/build\/three\.module(\.min)?\.js$/.test(s)) return "three";
  if (s.startsWith("three/addons/")) return addon(s.slice("three/addons/".length));
  if (s.startsWith("three/examples/jsm/")) return addon(s.slice("three/examples/jsm/".length));
  const cdn = s.match(/^https?:\/\/[^\s"']*?\/three(?:@[^/\s"']*)?(\/[^\s"']*)?$/);
  if (cdn) {
    const rest = (cdn[1] ?? "").replace(/\?.*$/, "");
    if (rest === "" || rest === "/" || /^\/build\/three\.module(\.min)?\.js$/.test(rest)) return "three";
    const jsm = rest.match(/^\/(?:examples\/jsm|addons)\/(.+)$/);
    if (jsm) return addon(jsm[1]);
  }
  return null;
}

const SPECIFIER_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\2/g;

/** A non-trivial line repeated many times in a short window: the model looped. */
export function hasRepetitionLoop(text: string): boolean {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 3);
  for (let end = 40; end <= Math.max(40, lines.length); end += 20) {
    const counts = new Map<string, number>();
    for (const l of lines.slice(Math.max(0, end - 40), end)) {
      const n = (counts.get(l) ?? 0) + 1;
      if (n >= 15) return true;
      counts.set(l, n);
    }
  }
  return false;
}

/** Strip comments and string/template/regex bodies so brace counting and
 *  declaration checks only see code. Approximate, but safe for both checks. */
function codeSkeleton(js: string): string {
  let out = "";
  let i = 0;
  let prevSignificant = "";
  while (i < js.length) {
    const c = js[i];
    const n = js[i + 1];
    if (c === "/" && n === "/") {
      while (i < js.length && js[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      const end = js.indexOf("*/", i + 2);
      i = end < 0 ? js.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < js.length && js[i] !== quote) {
        if (js[i] === "\\") i++;
        else if (quote !== "`" && js[i] === "\n") break;
        i++;
      }
      i++;
      out += quote + quote;
      prevSignificant = quote;
      continue;
    }
    if (c === "/" && /[(,=:[!&|?{};+\-*%<>~^]$|^$/.test(prevSignificant)) {
      // regex literal
      i++;
      let inClass = false;
      while (i < js.length && js[i] !== "\n") {
        if (js[i] === "\\") i++;
        else if (js[i] === "[") inClass = true;
        else if (js[i] === "]") inClass = false;
        else if (js[i] === "/" && !inClass) break;
        i++;
      }
      i++;
      out += "/r/";
      prevSignificant = "/";
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out;
}

/** Names declared at the top level of a script skeleton: every declarator of a
 *  column-0 const/let/var statement (so `const a = 1, b = 2` yields a and b),
 *  plus column-0 function and class declarations. Destructuring is skipped. */
export function topLevelDeclaredNames(code: string): string[] {
  const names: string[] = [];
  const lines = code.split("\n");
  let depth = 0;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (depth === 0) {
      const fn = line.match(/^(?:async\s+)?(?:function\*?|class)\s+([A-Za-z_$][\w$]*)/);
      if (fn) names.push(fn[1]);
      const decl = line.match(/^(?:const|let|var)\s+/);
      if (decl) {
        // Gather the statement until a depth-0 semicolon or the end of a depth-0 line.
        let stmt = "";
        let d = 0;
        let done = false;
        for (let lj = li; lj < lines.length && !done; lj++) {
          const text = lj === li ? lines[lj].slice(decl[0].length) : lines[lj];
          for (const ch of text) {
            if (ch === "{" || ch === "(" || ch === "[") d++;
            else if (ch === "}" || ch === ")" || ch === "]") d--;
            if (d === 0 && ch === ";") { done = true; break; }
            stmt += ch;
          }
          if (d <= 0 && !/[,=]\s*$/.test(stmt.trimEnd())) done = true;
          stmt += "\n";
        }
        let part = "";
        let pd = 0;
        const parts: string[] = [];
        for (const ch of stmt) {
          if (ch === "{" || ch === "(" || ch === "[") pd++;
          else if (ch === "}" || ch === ")" || ch === "]") pd--;
          if (pd === 0 && ch === ",") { parts.push(part); part = ""; continue; }
          part += ch;
        }
        parts.push(part);
        for (const p of parts) {
          const id = p.match(/^\s*([A-Za-z_$][\w$]*)\s*(?:=|$)/);
          if (id) names.push(id[1]);
        }
      }
    }
    for (const ch of line) {
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    }
  }
  return names;
}

const OPENERS = "({[";
const CLOSERS = ")}]";

/** Text between the bracket at `open` and its partner. */
function bracketBody(code: string, open: number): string {
  let depth = 1;
  let i = open + 1;
  while (i < code.length && depth > 0) {
    if (OPENERS.includes(code[i])) depth++;
    else if (CLOSERS.includes(code[i])) depth--;
    i++;
  }
  return code.slice(open + 1, i - 1);
}

/** The code that runs every frame, in a code skeleton: the bodies of
 *  onUpdate(...) and setAnimationLoop(...) calls, and the block around each
 *  requestAnimationFrame(...) call (a hand-written animate() loop). */
function perFrameBodies(code: string): string[] {
  const bodies: string[] = [];
  for (const m of code.matchAll(/\b(?:onUpdate|setAnimationLoop)\s*\(/g)) {
    bodies.push(bracketBody(code, (m.index ?? 0) + m[0].length - 1));
  }
  for (const m of code.matchAll(/\brequestAnimationFrame\s*\(/g)) {
    let depth = 0;
    for (let i = (m.index ?? 0) - 1; i >= 0; i--) {
      const ch = code[i];
      if (CLOSERS.includes(ch)) depth++;
      else if (OPENERS.includes(ch)) {
        if (depth > 0) depth--;
        else if (ch === "{") {
          bodies.push(bracketBody(code, i));
          break;
        }
      }
    }
  }
  return bodies;
}

/** The request itself asks for a moving camera or a rotating display. */
export function asksForCameraMotion(idea: string): boolean {
  return /\b(turntable|rotat\w*|spin\w*|orbit\w*|revolv\w*|360|fly\w*|fly-?through|camera|tour)\b/i.test(idea);
}

const MOVES_WORLD = /\bscene\s*\.\s*(?:rotation|position|quaternion)\b[^;\n]*?(?:[-+*/]?=(?!=)|\.\s*(?:set|copy|add|applyAxisAngle|setFromAxisAngle)\s*\()/;
const MOVES_CAMERA = /\bcamera\s*\.\s*(?:position|rotation|quaternion)\b[^;\n]*?(?:[-+*/]?=(?!=)|\.\s*(?:set|copy|add|lerp|applyAxisAngle|applyQuaternion|setFromSpherical)\s*\()|\bcamera\s*\.\s*lookAt\s*\(/;

/** Static checks a browser would otherwise report as a blank page — plus the
 *  "only what really moves" rule: the world and the camera stay still unless
 *  the request asked for a turntable or a moving camera. */
export function lintSceneScript(js: string, opts: { allowCameraMotion?: boolean } = {}): string[] {
  const issues: string[] = [];
  const code = codeSkeleton(js);
  let depth = 0;
  let minDepth = 0;
  for (const ch of code) {
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    else if (ch === "}" || ch === ")" || ch === "]") minDepth = Math.min(minDepth, --depth);
  }
  if (depth !== 0 || minDepth < 0) {
    issues.push(`brackets are unbalanced in the script (${depth > 0 ? `${depth} left open` : "extra closing bracket"}) — part of the code is missing or garbled`);
  }
  const memberDecl = code.match(/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*\.\s*[A-Za-z_$][\w$]*[^\n;]*/);
  if (memberDecl) issues.push(`invalid declaration "${memberDecl[0].trim().slice(0, 60)}" — a property can't be declared with const/let/var`);
  const topLevel = new Map<string, number>();
  for (const name of topLevelDeclaredNames(code)) topLevel.set(name, (topLevel.get(name) ?? 0) + 1);
  const dupes = [...topLevel].filter(([, n]) => n > 1).map(([name]) => name);
  if (dupes.length) issues.push(`top-level name(s) declared twice: ${dupes.slice(0, 5).join(", ")}`);
  // InstancedMesh starts with count === capacity; code that appends at
  // mesh.count without first resetting it to 0 silently adds nothing.
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+(?:THREE\.)?InstancedMesh\b/g)) {
    const name = m[1].replace(/\$/g, "\\$");
    const appends = new RegExp(`(?<![<>!=])=\\s*${name}\\.count\\b|\\b${name}\\.count\\s*(?:\\+\\+|\\+=)`).test(code);
    const resets = new RegExp(`\\b${name}\\.count\\s*=\\s*0\\b`).test(code);
    if (appends && !resets) {
      issues.push(`${m[1]}.count starts at the InstancedMesh capacity, so instances appended at ${m[1]}.count are never added — set ${m[1]}.count = 0 before adding (or create the mesh after collecting the instances)`);
    }
  }
  if (!opts.allowCameraMotion) {
    const perFrame = perFrameBodies(code);
    if (perFrame.some((body) => MOVES_WORLD.test(body))) {
      issues.push("the whole scene is rotated or moved every frame, so the buildings and the ground swing around — keep the world still and move only what really moves (world.part pieces, world.beam, water, particles)");
    }
    if (perFrame.some((body) => MOVES_CAMERA.test(body))) {
      issues.push("the camera is moved every frame — the kit's camera stays still (the viewer drags to look around); animate only the things that really move");
    }
    if (/\bautoRotate\s*(?::|=)\s*true\b/.test(code)) {
      issues.push("autoRotate is on, which spins the whole view although the request didn't ask for a turntable — remove it");
    }
  }
  return issues;
}

export interface SceneFinalizeResult {
  /** kebab-case stem from the FILENAME line or <title>, if any. */
  title: string | null;
  html: string;
  /** Problems worth a fix pass (empty = ship it). */
  issues: string[];
  /** What PrismOS changed, for an honest result card. */
  notes: string[];
  /** True when the output was cut off or looped — regenerate, don't patch. */
  regenerate: boolean;
  /** First parse error the syntax probe found (module script index, line), for a one-line repair. */
  parse?: { script: number; line: number; message: string };
}

const W3_NAMESPACE = /^https?:\/\/www\.w3\.org\//;

/**
 * "0xcc c6 b8" → "0xccc6b8": a hex colour the model split with spaces, a
 * sampling glitch seen on 2026-10-04 (the storm lighthouse's line 15). JS never
 * allows a hex literal followed by bare hex digits, so joining cannot change
 * valid code; only results of exactly six digits are joined.
 */
export function repairSplitHexLiterals(js: string): { code: string; count: number } {
  let count = 0;
  const code = js.replace(/\b0[xX]([0-9a-fA-F]{1,5})((?:[ \t]+[0-9a-fA-F]{1,5})+)\b/g, (all: string, head: string, rest: string) => {
    const digits = head + rest.replace(/[ \t]+/g, "");
    if (digits.length !== 6) return all;
    count++;
    return `0x${digits}`;
  });
  return { code, count };
}

/** The weather the words ask for, if any (storm beats snow beats rain). */
export function impliedWeather(idea: string): "storm" | "snow" | "rain" | null {
  const t = idea.toLowerCase();
  if (/\b(storm\w*|thunder\w*|lightning|tempest|hurricane|gale)\b/.test(t)) return "storm";
  if (/\b(snow\w*|blizzard)\b/.test(t)) return "snow";
  if (/\b(rain\w*|drizzle|downpour|monsoon)\b/.test(t)) return "rain";
  return null;
}

/**
 * A kit scene that forgot the weather its request named gets it: one
 * world.weather(...) call before world.start(), sized by the kit. Returns the
 * script unchanged when the scene already has it (or isn't a kit scene).
 */
export function ensureImpliedWeather(js: string, idea: string): { code: string; added: string | null } {
  const kind = impliedWeather(idea);
  if (!kind) return { code: js, added: null };
  const name = js.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createWorld\s*\(/)?.[1];
  if (!name) return { code: js, added: null };
  const has =
    kind === "storm"
      ? /\.lightning\s*\(|\.weather\s*\(\s*["']storm["']/.test(js)
      : new RegExp(`\\.weather\\s*\\(\\s*["']${kind}["']|type\\s*:\\s*["']${kind}["']`).test(js);
  if (has) return { code: js, added: null };
  const escaped = name.replace(/\$/g, "\\$");
  const starts = [...js.matchAll(new RegExp(`\\b${escaped}\\s*\\.\\s*start\\s*\\(\\s*\\)`, "g"))];
  const last = starts[starts.length - 1];
  if (!last || last.index === undefined) return { code: js, added: null };
  const code = `${js.slice(0, last.index)}${name}.weather('${kind}');\n${js.slice(last.index)}`;
  return { code, added: kind };
}

/** Content-Security-Policy baked into every scene file: inline code and the
 *  data: modules PrismOS inlines may run; nothing may touch the network. */
export const SCENE_CSP =
  "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; media-src 'none'; worker-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";

/**
 * Turn the model's raw reply into the shippable offline scene file.
 * Pure (given the preloaded sources) so it is unit-testable.
 */
export function finalizeSceneHtml(
  raw: string,
  sources: ThreeSources,
  opts: { truncated?: boolean; idea?: string } = {},
): SceneFinalizeResult {
  const notes: string[] = [];
  const issues: string[] = [];
  let regenerate = false;
  const unfence = (t: string) => t.replace(/^```[a-z]*\s*\n/i, "").replace(/\n```\s*$/, "");

  let text = unfence(raw.trim());
  let title: string | null = null;
  const fileLine = text.match(/^FILENAME:\s*(\S+)\s*\n/i);
  if (fileLine) {
    title = fileLine[1].replace(/\.html?$/i, "");
    text = text.slice(fileLine[0].length);
  }
  text = unfence(text.trim()).trim();
  const start = text.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) text = text.slice(start);
  const end = text.toLowerCase().lastIndexOf("</html>");
  if (end >= 0) text = text.slice(0, end + "</html>".length);

  if (hasRepetitionLoop(raw)) {
    issues.push("the output fell into a loop, repeating the same line over and over");
    regenerate = true;
  }
  const lastScriptOpen = text.toLowerCase().lastIndexOf("<script");
  const lastScriptClose = text.toLowerCase().lastIndexOf("</script>");
  if (opts.truncated || lastScriptOpen < 0 || lastScriptClose < lastScriptOpen) {
    issues.push(lastScriptOpen < 0 ? "the file has no script, so nothing would render" : "the output was cut off before the script finished");
    regenerate = true;
  } else if (end < 0) {
    text += "\n</html>";
  }

  // The model's own import map / CDN tags / web fonts go — PrismOS serves three.js itself.
  text = text.replace(/<script[^>]*type\s*=\s*["']importmap["'][^>]*>[\s\S]*?<\/script>/gi, () => {
    notes.push("replaced the model's online import map with PrismOS's bundled three.js");
    return "";
  });
  text = text.replace(/<script[^>]*\bsrc\s*=\s*["']([^"']*)["'][^>]*>\s*<\/script>/gi, (tag, src: string) => {
    if (/three/i.test(src)) {
      notes.push("removed a CDN three.js script tag (bundled copy used instead)");
      return "";
    }
    issues.push(`loads an online script (${src.slice(0, 80)}), which won't work offline`);
    return tag;
  });
  text = text.replace(/<link[^>]*href\s*=\s*["']https?:\/\/[^"']*["'][^>]*>/gi, () => {
    notes.push("removed an online web-font/stylesheet link (system fonts used)");
    return "";
  });
  text = text.replace(/@import\s+url\(\s*["']?https?:\/\/[^)]*\)\s*;?/gi, () => {
    notes.push("removed an online CSS @import");
    return "";
  });

  // Classic scripts written against a global THREE (old CDN style) become modules.
  text = text.replace(/<script(?![^>]*\btype\s*=\s*["']module["'])(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attrs: string, body: string) => {
    if (!/\bTHREE\./.test(body) || /\bimport\s/.test(body)) return tag;
    notes.push("converted a classic script that used a global THREE into a module");
    return `<script type="module"${attrs.replace(/\btype\s*=\s*["'][^"']*["']/i, "")}>\nimport * as THREE from 'three';\n${body}</script>`;
  });

  // Specifiers: CDN/legacy forms → bundled ones; anything else is reported.
  const addonPaths = new Set<string>();
  let usesKit = false;
  text = text.replace(SPECIFIER_RE, (all, lead: string, quote: string, spec: string) => {
    const normalized = normalizeThreeSpecifier(spec);
    if (normalized === null) {
      if (/^(?:data:|blob:)/.test(spec)) return all;
      issues.push(`imports "${spec.slice(0, 80)}", which isn't available offline — use only the three.js modules listed in the brief`);
      return all;
    }
    if (normalized === KIT_SPECIFIER) usesKit = true;
    if (normalized !== spec) notes.push(`rewrote import "${spec.slice(0, 60)}" to the bundled copy`);
    if (normalized.startsWith("three/addons/")) addonPaths.add(normalized.slice("three/addons/".length));
    return `${lead}${quote}${normalized}${quote}`;
  });

  // Legacy THREE.OrbitControls → the addon import it needs today.
  if (/\bTHREE\.OrbitControls\b/.test(text)) {
    text = text.replace(/\bTHREE\.OrbitControls\b/g, "OrbitControls");
    if (!/\bimport\s*\{[^}]*\bOrbitControls\b[^}]*\}\s*from/.test(text)) {
      text = text.replace(/(<script[^>]*type\s*=\s*["']module["'][^>]*>)/i, `$1\nimport { OrbitControls } from 'three/addons/controls/OrbitControls.js';`);
    }
    addonPaths.add("controls/OrbitControls.js");
    notes.push("added the OrbitControls import (THREE.OrbitControls was removed from three.js)");
  }

  // Named imports from 'three' → namespace + destructure, so a name that no
  // longer exists in r185 (e.g. sRGBEncoding) is undefined instead of a fatal
  // module-link error that blanks the page.
  let shim = 0;
  text = text.replace(/import\s*\{([^}]*)\}\s*from\s*(["'])three\2\s*;?/g, (_all, names: string) => {
    shim++;
    const fields = names
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/\s+as\s+/, ": "))
      .join(", ");
    return `import * as __THREE${shim} from 'three'; const { ${fields} } = __THREE${shim};`;
  });

  // Online resources the model may still reference (textures, fetch, fonts).
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)) {
    if (W3_NAMESPACE.test(m[0])) continue;
    issues.push(`references an online resource (${m[0].slice(0, 80)}), which won't load offline — make it procedural`);
    break;
  }

  // Deterministic repairs before judging the code.
  let rejoined = 0;
  text = text.replace(/(<script[^>]*type\s*=\s*["']module["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (_all: string, open: string, body: string, close: string) => {
    const r = repairSplitHexLiterals(body);
    rejoined += r.count;
    return open + r.code + close;
  });
  if (rejoined) notes.push(`rejoined ${rejoined} colour value${rejoined > 1 ? "s" : ""} the model had split with spaces (like 0xcc c6 b8)`);
  if (opts.idea) {
    let addedWeather: string | null = null;
    text = text.replace(/(<script[^>]*type\s*=\s*["']module["'][^>]*>)([\s\S]*?)(<\/script>)/gi, (_all: string, open: string, body: string, close: string) => {
      const r = ensureImpliedWeather(body, opts.idea ?? "");
      if (r.added) addedWeather = r.added;
      return open + r.code + close;
    });
    if (addedWeather) {
      notes.push(addedWeather === "storm" ? "added the storm the request asked for (rain, lightning, clouds, a rough sea)" : `added the ${addedWeather} the request asked for`);
    }
  }

  // Script-level checks on the module code.
  const scripts = [...text.matchAll(/<script[^>]*type\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  if (!regenerate) {
    const allowCameraMotion = asksForCameraMotion(opts.idea ?? "");
    for (const js of scripts) issues.push(...lintSceneScript(js, { allowCameraMotion }));
    if (usesKit && !scripts.some((js) => /\.start\s*\(\s*\)/.test(js))) {
      issues.push("the scene never calls world.start(), so nothing would render — call it as the last line");
    }
  }

  const { imports, unknown } = buildImportMap([...addonPaths], sources, { kit: usesKit });
  for (const u of unknown) {
    issues.push(`imports three/addons/${u}, which PrismOS doesn't bundle — available: ${BUNDLED_ADDONS.slice(0, 7).join(", ")} and the bloom post-processing passes`);
  }

  const importMap = `<script type="importmap">${JSON.stringify({ imports })}</script>`;
  // The file itself enforces offline: a CSP that only allows its own inline
  // code and the data: modules above, and blocks every network request — even
  // one the model wrote anyway.
  const offlinePolicy = `<meta http-equiv="Content-Security-Policy" content="${SCENE_CSP}">`;
  // Runtime errors show on the page instead of leaving a silent blank canvas.
  const errorPanel =
    "<script>(function(){function show(m){var d=document.getElementById('__prismos_err');if(!d){d=document.createElement('pre');d.id='__prismos_err';d.style.cssText='position:fixed;left:12px;bottom:12px;max-width:70vw;white-space:pre-wrap;font:12px ui-monospace,Menlo,monospace;color:#fff;background:rgba(150,20,20,.92);padding:8px 10px;border-radius:8px;z-index:2147483647';(document.body||document.documentElement).appendChild(d);}d.textContent+=(d.textContent?'\\n':'')+'Scene error: '+m;}addEventListener('error',function(e){show(e.message||'a script failed to load')});addEventListener('unhandledrejection',function(e){show((e.reason&&e.reason.message)||String(e.reason))});})();</script>";
  text = text.replace(/<meta[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, "");
  const head = text.match(/<head[^>]*>/i);
  if (head) {
    text = text.replace(head[0], `${head[0]}\n${offlinePolicy}\n${importMap}\n${errorPanel}`);
  } else {
    text = `<!DOCTYPE html>\n<html><head><meta charset="utf-8">\n${offlinePolicy}\n${importMap}\n${errorPanel}\n</head>\n${text.replace(/<!doctype html>/i, "")}`;
  }

  if (!title) {
    const t = text.match(/<title>([^<]{1,80})<\/title>/i);
    if (t) title = t[1];
  }
  title = title
    ? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || null
    : null;

  return { title, html: text, issues: [...new Set(issues)], notes: [...new Set(notes)], regenerate };
}


// ─── Syntax probe ─────────────────────────────────────────────────────────────

/**
 * The scene's module code wrapped so a classic parser can check its syntax
 * WITHOUT running it: imports and exports are blanked (line count kept, so the
 * reported line still points into the scene), the body sits inside an async
 * function that is never called, and the script only posts "ok" if it parsed.
 */
export function syntaxProbeSource(moduleCode: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, " ");
  const body = moduleCode
    .replace(/^[ \t]*import\s+[^;]*?\bfrom\s*["'][^"'\n]+["'][ \t]*;?/gm, blank)
    .replace(/^[ \t]*import\s*["'][^"'\n]+["'][ \t]*;?/gm, blank)
    .replace(/^([ \t]*)export\s+default\s+/gm, "$1")
    .replace(/^([ \t]*)export\s+(?=(?:const|let|var|function|class|async)\b)/gm, "$1")
    .replace(/\bimport\.meta\b/g, "({})");
  return `"use strict"; async function __prismosSceneProbe() {\n${body}\n}\npostMessage("ok");`;
}

/**
 * Parse-check one module script in a throwaway worker (the app's CSP allows
 * blob: workers, not eval). Resolves to the browser's own SyntaxError message,
 * or null when it parsed — or when no worker is available or it can't decide,
 * so the check never blocks a scene on its own uncertainty.
 */
export async function checkSceneSyntax(moduleCode: string, timeoutMs = 4000): Promise<string | null> {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    return null;
  }
  const url = URL.createObjectURL(new Blob([syntaxProbeSource(moduleCode)], { type: "text/javascript" }));
  try {
    return await new Promise<string | null>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(url);
      } catch {
        resolve(null);
        return;
      }
      const finish = (verdict: string | null) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(verdict);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      worker.onmessage = () => finish(null);
      worker.onerror = (e: ErrorEvent) => {
        e.preventDefault();
        const where = e.lineno ? ` (scene script line ${Math.max(1, e.lineno - 1)})` : "";
        finish(`${(e.message || "syntax error").replace(/^Uncaught\s+/, "")}${where}`);
      };
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Imports turned into stand-in bindings, line count kept: names from the kit
 * get the dry-run kit, everything else (three.js, addons) a permissive stub.
 */
export function stubImports(moduleCode: string): string {
  return moduleCode
    .replace(/^([ \t]*)import\s+([^;]*?)\s*\bfrom\s*(["'])([^"'\n]+)\3[ \t]*;?/gm, (whole, indent: string, clause: string, _q: string, spec: string) => {
      const names: string[] = [];
      const ns = clause.match(/\*\s*as\s+([A-Za-z_$][\w$]*)/);
      if (ns) names.push(ns[1]);
      const braces = clause.match(/\{([^}]*)\}/);
      if (braces) {
        for (const part of braces[1].split(",")) {
          const m = part.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
          if (m) names.push(m[2] ?? m[1]);
        }
      }
      const def = clause.replace(/\{[^}]*\}/, "").replace(/\*\s*as\s+[A-Za-z_$][\w$]*/, "").match(/^\s*([A-Za-z_$][\w$]*)/);
      if (def) names.push(def[1]);
      const value = spec === KIT_SPECIFIER ? "__createWorld" : "__any()";
      const decl = names.length ? `const ${names.map((n) => `${n} = ${value}`).join(", ")};` : "";
      const lines = whole.split("\n").length;
      return indent + decl + "\n".repeat(lines - 1);
    })
    .replace(/^[ \t]*import\s*["'][^"'\n]+["'][ \t]*;?/gm, "");
}

/**
 * A dry run of the scene's own code, for a worker: the kit and three.js are
 * replaced by permissive stand-ins (any property, call or `new` works), so
 * what can still throw is the model's own logic — `bands.find(...).r` on a
 * missing band, a typo'd palette entry, a bad loop. Colour functions are
 * sampled and update callbacks are called twice. No DOM, no network, no
 * rendering; the worker is terminated after it reports.
 */
export function dryRunSource(moduleCode: string): string {
  const body = stubImports(moduleCode)
    .replace(/^([ \t]*)export\s+default\s+/gm, "$1")
    .replace(/^([ \t]*)export\s+(?=(?:const|let|var|function|class|async)\b)/gm, "$1")
    .replace(/\bimport\.meta\b/g, "({})");
  const prelude = [
    '"use strict";',
    "const __any = () => new Proxy(function () {}, { get: (t, p) => (p === Symbol.toPrimitive ? () => 0 : p === 'then' ? undefined : __any()), set: () => true, apply: () => __any(), construct: () => __any(), has: () => true });",
    "const __updates = [];",
    "const __color = (c, x, y, z) => { if (typeof c === 'function') c(x, y, z); };",
    "const __voxels = { set: (x, y, z, c) => __color(c, x, y, z), glow: (x, y, z, c) => __color(c, x, y, z), remove: () => {}, has: () => false, get: () => undefined, box: (a, b, c2, d, e, f, c) => __color(c, a, b, c2), shell: (a, b, c2, d, e, f, c) => __color(c, a, b, c2), cylinder: (x, y, z, r, h, c) => __color(c, x, y, z), sphere: (x, y, z, r, c) => __color(c, x, y, z), count: 0 };",
    "const THREE = __any();",
    "const __part = () => new Proxy(function () {}, { get: (t, p) => (p === 'voxels' ? __voxels : p === Symbol.toPrimitive ? () => 0 : p === 'then' ? undefined : __any()), set: () => true, apply: () => __any(), construct: () => __any(), has: () => true }); const __createWorld = () => ({ THREE, scene: __any(), camera: __any(), renderer: __any(), controls: __any(), voxels: __voxels, part: __part, add: (o) => o, water: () => __any(), particles: () => __any(), weather: () => 'rain', light: () => __any(), beam: () => __any(), lightning: () => __any(), onUpdate: (f) => { __updates.push(f); }, random: Math.random, start: () => {} });",
    // Browser globals a hand-written (non-kit) scene touches, stubbed in the same line.
    "async function __prismosSceneDryRun() { const window = __any(), document = __any(), localStorage = __any(), innerWidth = 1280, innerHeight = 720, devicePixelRatio = 1, requestAnimationFrame = () => 0, cancelAnimationFrame = () => {}, addEventListener = () => {}, removeEventListener = () => {};",
  ].join("\n");
  const epilogue = [
    "",
    "for (const f of __updates) { f(0.5, 0.016); f(1.5, 0.016); }",
    "}",
    "__prismosSceneDryRun().then(() => postMessage({ ok: true }), (e) => postMessage({ ok: false, error: String((e && e.message) || e), stack: String((e && e.stack) || '') }));",
  ].join("\n");
  return `${prelude}\n${body}${epilogue}`;
}

/** Lines the dry-run prelude adds before the scene's first line. */
export const DRY_RUN_PRELUDE_LINES = 8;

/**
 * Run the dry run in a throwaway worker. Resolves to the error the scene's own
 * code throws, or null when it ran clean — or when no worker is available or
 * it can't decide (an endless loop is cut off by the timeout and reported).
 */
export async function dryRunScene(moduleCode: string, timeoutMs = 5000): Promise<string | null> {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    return null;
  }
  const url = URL.createObjectURL(new Blob([dryRunSource(moduleCode)], { type: "text/javascript" }));
  try {
    return await new Promise<string | null>((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(url);
      } catch {
        resolve(null);
        return;
      }
      const finish = (verdict: string | null) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(verdict);
      };
      const timer = setTimeout(() => finish(`the scene code did not finish within ${timeoutMs / 1000} s (an endless loop?)`), timeoutMs);
      worker.onmessage = (event: MessageEvent<{ ok: boolean; error?: string; stack?: string }>) => {
        const d = event.data;
        if (!d || d.ok) {
          finish(null);
          return;
        }
        const m = (d.stack || "").match(/:(\d+):\d+\)?\s*$/m);
        const line = m ? Number(m[1]) - DRY_RUN_PRELUDE_LINES : 0;
        finish(`${d.error}${line > 0 ? ` (scene script line ${line})` : ""}`);
      };
      worker.onerror = (e: ErrorEvent) => {
        e.preventDefault();
        finish(null); // a parse problem is the syntax probe's to report
      };
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Module script bodies of a finished scene file. */
export function moduleScriptsOf(html: string): string[] {
  return [...html.matchAll(/<script[^>]*type\s*=\s*["']module["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
}

/** Finalize + the browser-grade syntax probe, which needs a worker (async). */
async function finalizeAndProbe(raw: string, sources: ThreeSources, truncated: boolean, idea: string): Promise<SceneFinalizeResult> {
  const result = finalizeSceneHtml(raw, sources, { truncated, idea });
  if (result.regenerate) return result;
  const scripts = moduleScriptsOf(result.html);
  for (let index = 0; index < scripts.length; index++) {
    const js = scripts[index];
    const error = await checkSceneSyntax(js);
    if (error) {
      // Quote the line: a fix pass that can see it fixes it.
      const line = Number(error.match(/scene script line (\d+)\)/)?.[1] ?? 0);
      const source = line ? (js.split("\n")[line - 1] ?? "").trim() : "";
      result.issues.push(`the browser can't parse the script: ${error}${source ? `; that line reads: ${source.slice(0, 160)}` : ""}`);
      if (line && !result.parse) result.parse = { script: index, line, message: error };
      continue;
    }
    const thrown = await dryRunScene(js);
    if (thrown) result.issues.push(`the scene throws when it runs: ${thrown}`);
  }
  return result;
}

/** Prompt for repairing the one line the browser can't parse. */
export function sceneLineFixPrompt(lines: string[], line: number, message: string): string {
  const from = Math.max(1, line - 3);
  const to = Math.min(lines.length, line + 2);
  const view: string[] = [];
  for (let n = from; n <= to; n++) view.push(`${n === line ? ">>" : "  "}${n}: ${lines[n - 1]}`);
  return [
    "You are fixing ONE line of a JavaScript module (a three.js voxel scene).",
    `The browser reports: ${message}`,
    "",
    `Lines ${from}-${to} (the broken line is marked >>):`,
    ...view,
    "",
    `Return ONLY the corrected line ${line}: no line number, no code fences, no explanation. Keep what it does; fix only the syntax.`,
  ].join("\n");
}

/** The corrected line out of a line-fix reply (fences and a "15:" prefix removed), or null. */
export function lineFromReply(reply: string, line: number): string | null {
  const prefix = new RegExp(`^\\s*(?:>>)?\\s*${line}\\s*:\\s?`);
  const lines = reply
    .replace(/```[a-z]*\s*/gi, "")
    .split("\n")
    .map((l) => l.replace(prefix, ""))
    .filter((l) => l.trim());
  return lines.length ? lines[0] : null;
}

/** Replace one line of one module script in a finished scene file. */
export function spliceSceneLine(html: string, script: number, line: number, replacement: string): string | null {
  const js = moduleScriptsOf(html)[script];
  if (js === undefined) return null;
  const lines = js.split("\n");
  if (line < 1 || line > lines.length) return null;
  const indent = lines[line - 1].match(/^\s*/)?.[0] ?? "";
  lines[line - 1] = indent + replacement.trim();
  const at = html.indexOf(js);
  if (at < 0) return null;
  return html.slice(0, at) + lines.join("\n") + html.slice(at + js.length);
}

// ─── Generation ───────────────────────────────────────────────────────────────

export interface SceneOptions {
  model: string;
  ollamaUrl?: string | null;
  /** Recent conversation snippet so "make it night" style follow-ups resolve. */
  context?: string;
  /** Let hybrid models (qwen3.x) plan before writing. Off by default: on a
   *  27B model the trace alone cost ~3k tokens (minutes) for no visible gain
   *  over the kit + self-checks in the 2026-10-04 A/B runs. */
  think?: boolean;
  onPhase?: (phase: string) => void;
}

export interface SceneStats {
  /** Answer tokens written across all passes (thinking excluded). */
  tokens: number;
  seconds: number;
  tokensPerSecond: number;
  passes: number;
}

export interface SceneResult {
  attachment: GeneratedAttachment;
  title: string;
  stats: SceneStats;
  notes: string[];
  /** Problems the self-checks caught that a repair or fix pass then fixed. */
  fixed: string[];
  /** Problems still present after the fix pass (shipped anyway, flagged). */
  unresolved: string[];
}

/** Output budget per pass. A kit scene is ~2.5–6k answer tokens; a thinking
 *  trace adds ~1.5–4k. Anything far past that is a runaway, not a scene. */
export function sceneMaxTokens(think: boolean): number {
  return think ? 16384 : 10240;
}

/** Stop a pass early when it is clearly running away: a repetition loop, or
 *  far more lines than any kit scene needs. Checked every 160 tokens. */
export function isRunaway(text: string): boolean {
  return text.split("\n").length > 900 || hasRepetitionLoop(text.slice(-12000));
}

/**
 * Sampling for long one-pass code. Qwen's guidance for its quantized models is
 * a presence penalty (~1.5) against endless repetition — the 2026-10-04 field
 * run without it looped on one line until it stopped. The context window is
 * sized for the fix pass, which re-reads the previous file.
 */
export function sceneOverrides(think: boolean, pass: "write" | "fix" = "write") {
  // 1.5 kept the 27B out of loops but also split repeated hex digits
  // ("0xcc c6 b8"); 1.2 is the compromise for writing. A fix pass mostly copies
  // the previous file, which a strong presence penalty actively fights.
  const presencePenalty = pass === "fix" ? 0.6 : 1.2;
  return think
    ? { numCtx: 32768, temperature: 0.6, topP: 0.95, topK: 20, minP: 0, presencePenalty }
    : { numCtx: 24576, temperature: 0.7, topP: 0.8, topK: 20, minP: 0, presencePenalty };
}

/** Sampling for the one-line repair: short, cold, no penalties. */
const LINE_FIX_TUNING = {
  overrides: { numCtx: 8192, temperature: 0.2, topP: 0.9, topK: 20, minP: 0, presencePenalty: 0 },
  maxTokens: 300,
  think: false,
};

interface StreamEvent {
  token: string;
  done: boolean;
  truncated?: boolean;
}

/** Stream one generation, reporting live tokens/s through onPhase, and stop
 *  it early (cancel_ollama_stream) if it runs away. */
async function streamScene(
  prompt: string,
  opts: SceneOptions,
  label: string,
  tuning?: { overrides: Record<string, number>; maxTokens: number; think?: boolean },
): Promise<{ text: string; tokens: number; seconds: number; truncated: boolean; stopped: boolean }> {
  const think = tuning?.think ?? opts.think ?? false;
  let tokens = 0;
  let firstAt = 0;
  let truncated = false;
  let stopped = false;
  let seen = "";
  const startedAt = Date.now();
  if (think) opts.onPhase?.(`${label} — planning first (thinking)…`);
  const unlisten = await listen<StreamEvent>("ollama-stream", (event) => {
    const e = event.payload;
    if (e.done) {
      truncated = Boolean(e.truncated);
      return;
    }
    if (!e.token) return;
    if (!firstAt) firstAt = Date.now();
    tokens++;
    seen += e.token;
    if (tokens % 16 === 0) {
      const secs = Math.max(0.5, (Date.now() - firstAt) / 1000);
      opts.onPhase?.(`${label} — ${tokens.toLocaleString()} tokens · ${(tokens / secs).toFixed(0)} tok/s`);
    }
    if (!stopped && tokens % 160 === 0 && isRunaway(seen)) {
      stopped = true;
      opts.onPhase?.(`${label} — the model started repeating itself; stopping this pass…`);
      void invoke("cancel_ollama_stream").catch(() => undefined);
    }
  });
  try {
    const text = await invoke<string>("query_ollama_stream", {
      // A trailing /think is the bridge's documented switch for hybrid models.
      prompt: think ? `${prompt}\n/think` : prompt,
      model: opts.model,
      ollamaUrl: opts.ollamaUrl ?? null,
      maxTokens: tuning?.maxTokens ?? sceneMaxTokens(think),
      overrides: tuning?.overrides ?? sceneOverrides(think),
    });
    const seconds = (Date.now() - (firstAt || startedAt)) / 1000;
    return { text, tokens, seconds, truncated: truncated || stopped, stopped };
  } finally {
    unlisten();
  }
}

/** The idea itself, without the explicit "/scene" command word. */
export function sceneIdea(input: string): string {
  return input.replace(/^\s*\/scene\b\s*/i, "").trim();
}

/**
 * One prompt → one offline scene file, opened by the caller. At most two model
 * passes: the scene, then (only if the checks find something) a fix pass that
 * keeps the working code, or a compact regenerate when the output was cut off.
 */
export async function generateScene(rawInput: string, opts: SceneOptions): Promise<SceneResult> {
  const input = sceneIdea(rawInput);
  opts.onPhase?.(`Loading ${opts.model} and planning the scene…`);
  const sourcesPromise = loadThreeSources();

  let pass = await streamScene(scenePrompt(input, opts.context), opts, `Writing the scene with ${opts.model}`);
  const sources = await sourcesPromise;
  opts.onPhase?.("Checking the scene…");
  let result = await finalizeAndProbe(pass.text, sources, pass.truncated, input);
  let tokens = pass.tokens;
  let seconds = pass.seconds;
  let passes = 1;
  const notes = new Set(result.notes);
  const fixed: string[] = [];

  // A line the browser can't parse is repaired on its own (a few dozen tokens),
  // keeping the rest of the file byte for byte. Up to three lines.
  for (let attempt = 0; attempt < 3 && result.parse && !result.regenerate; attempt++) {
    const { script, line, message } = result.parse;
    const lines = (moduleScriptsOf(result.html)[script] ?? "").split("\n");
    const before = lines[line - 1] ?? "";
    const reply = await streamScene(sceneLineFixPrompt(lines, line, message), opts, `Self-check: line ${line} doesn't parse — repairing just that line`, LINE_FIX_TUNING);
    tokens += reply.tokens;
    seconds += reply.seconds;
    const replacement = lineFromReply(reply.text, line);
    if (!replacement || replacement.trim() === before.trim()) break;
    const spliced = spliceSceneLine(result.html, script, line, replacement);
    if (!spliced) break;
    const next = await finalizeAndProbe(`FILENAME: ${result.title || "scene"}.html\n${stripInjected(spliced)}`, sources, false, input);
    if (next.parse && next.parse.line === line && next.parse.message === message) break; // no progress
    fixed.push(`line ${line} didn't parse (${message.replace(/\s*\(scene script line \d+\)$/, "")})`);
    result = next;
  }

  if (result.issues.length) {
    opts.onPhase?.(`Self-check found ${result.issues.length} issue(s) — fixing…`);
    const firstIssues = result.issues;
    const fixPass = !result.regenerate;
    const prompt = fixPass
      ? sceneFixPrompt(input, stripInjected(result.html), result.issues)
      : sceneRetryPrompt(input, result.issues, opts.context);
    pass = await streamScene(
      prompt,
      opts,
      fixPass ? "Fixing the scene" : "Rewriting the scene",
      fixPass ? { overrides: sceneOverrides(opts.think ?? false, "fix"), maxTokens: sceneMaxTokens(opts.think ?? false) } : undefined,
    );
    const second = await finalizeAndProbe(pass.text, sources, pass.truncated, input);
    tokens += pass.tokens;
    seconds += pass.seconds;
    passes = 2;
    // Keep whichever version is healthier; a fix pass must not make things worse.
    if (second.issues.length <= result.issues.length || result.regenerate) {
      result = second;
      for (const n of second.notes) notes.add(n);
      fixed.push(...firstIssues.filter((i) => !second.issues.includes(i)));
    }
  }

  if (result.regenerate) {
    throw new Error(
      `The model couldn't finish a working scene (${result.issues[0]}). Try again, or pick a stronger model in Settings.`,
    );
  }

  opts.onPhase?.("Saving the scene…");
  const resultJson = await invoke<string>("create_text_file", {
    title: result.title || "scene",
    ext: "html",
    content: result.html,
  });
  const attachment = JSON.parse(resultJson) as GeneratedAttachment;
  return {
    attachment,
    title: result.title || "scene",
    stats: { tokens, seconds, tokensPerSecond: seconds > 0 ? tokens / seconds : 0, passes },
    notes: [...notes],
    fixed,
    unresolved: result.issues,
  };
}

/** The fix pass gets the model's code without the 1 MB import map we injected. */
function stripInjected(html: string): string {
  return html
    .replace(/<script type="importmap">[\s\S]*?<\/script>\n?/, "")
    .replace(/<script>\(function\(\)\{function show\(m\)[\s\S]*?<\/script>\n?/, "");
}
