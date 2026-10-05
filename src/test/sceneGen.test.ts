// Scene Builder unit tests — routing, offline three.js inlining, and the
// self-checks that stand between a model's raw reply and a blank browser tab.
//
// Field failure this guards (qwen3.8:27b, 2026-10-04): the first one-shot
// "voxel pagoda garden" wrote its own unpkg import map, declared
// `const solidMat.color.set(…)` (a syntax error) and then looped on
// `for (let x = cx; x <= cx; x++) {}` until it stopped — a blank page if shipped.

import { describe, it, expect, beforeAll } from "vitest";
import {
  BUNDLED_ADDONS,
  buildImportMap,
  checkSceneSyntax,
  dryRunScene,
  dryRunSource,
  stubImports,
  moduleScriptsOf,
  syntaxProbeSource,
  topLevelDeclaredNames,
  detectSceneRequest,
  finalizeSceneHtml,
  hasRepetitionLoop,
  isRunaway,
  sceneMaxTokens,
  lintSceneScript,
  loadThreeSources,
  normalizeThreeSpecifier,
  sceneFixPrompt,
  asksForCameraMotion,
  directorNotes,
  ensureImpliedWeather,
  impliedWeather,
  lineFromReply,
  repairSplitHexLiterals,
  sceneLineFixPrompt,
  sceneOverrides,
  spliceSceneLine,
  sceneIdea,
  scenePrompt,
  type ThreeSources,
} from "../lib/sceneGen";

let sources: ThreeSources;
beforeAll(async () => {
  sources = await loadThreeSources();
});

const decode = (dataUrl: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0)));

const importMapOf = (html: string): Record<string, string> => {
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no import map");
  return JSON.parse(m[1]).imports;
};

const page = (moduleCode: string, head = "") =>
  `FILENAME: test-scene.html\n<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>Test</title>${head}</head>\n<body>\n<script type="module">\n${moduleCode}\n</script>\n</body></html>`;

describe("detectSceneRequest", () => {
  it("routes one-line scene prompts, with or without a verb", () => {
    expect(detectSceneRequest("a voxel pagoda garden")).toBe(true);
    expect(detectSceneRequest("A voxel pagoda garden")).toBe(true);
    expect(detectSceneRequest("build a voxel pagoda garden")).toBe(true);
    expect(detectSceneRequest("make a low-poly island at sunset")).toBe(true);
    expect(detectSceneRequest("create a 3D solar system")).toBe(true);
    expect(detectSceneRequest("an isometric 3d city at night")).toBe(true);
    expect(detectSceneRequest("can you render a diorama of a lighthouse in a storm")).toBe(true);
    expect(detectSceneRequest("make an animated aquarium")).toBe(true);
    expect(detectSceneRequest("create an animation of fireflies over a lake")).toBe(true);
  });

  it("routes the explicit /scene command whatever the phrasing", () => {
    expect(detectSceneRequest("/scene a lighthouse on a rocky island at sunset")).toBe(true);
    expect(detectSceneRequest("/Scene  cozy cabin in the snow")).toBe(true);
    expect(detectSceneRequest("/scene")).toBe(false);
    expect(sceneIdea("/scene a lighthouse at sunset")).toBe("a lighthouse at sunset");
    expect(sceneIdea("a voxel pagoda garden")).toBe("a voxel pagoda garden");
  });

  it("leaves questions, documents, data and web apps to their own lanes", () => {
    expect(detectSceneRequest("what is a voxel?")).toBe(false);
    expect(detectSceneRequest("how do I make a 3d scene in three.js")).toBe(false);
    expect(detectSceneRequest("explain webgl shaders")).toBe(false);
    expect(detectSceneRequest("create a presentation about 3D printing")).toBe(false);
    expect(detectSceneRequest("make a 3d printing checklist")).toBe(false);
    expect(detectSceneRequest("write a report on voxel engines")).toBe(false);
    expect(detectSceneRequest("create a 3d chart of sales")).toBe(false);
    expect(detectSceneRequest("build a landing page with a 3d hero")).toBe(false);
    expect(detectSceneRequest("build a 3d racing game")).toBe(false);
    expect(detectSceneRequest("make a garden planner app")).toBe(false);
    expect(detectSceneRequest("summarize my notes on the garden")).toBe(false);
    expect(detectSceneRequest("a garden")).toBe(false);
  });
});

describe("prompts", () => {
  it("carries the request, the offline contract and the output format", () => {
    const p = scenePrompt("a voxel pagoda garden");
    expect(p).toContain('User request: "a voxel pagoda garden"');
    expect(p).toContain("import { createWorld } from 'prismos/scene'");
    expect(p).toContain("Never write an import map");
    expect(p).toContain("FILENAME:");
    expect(p).toContain("world.start()");
    // Only what really moves should move: the camera stays still unless asked.
    expect(p).toContain("Buildings, terrain and the camera stay still");
    expect(p).toContain("autoRotate: true ONLY if the user asks");
    // Moving pieces have their own home, so nothing else needs to move.
    expect(p).toContain("world.part({ x, y, z })");
    expect(p).toContain("world.beam({ x, y, z, color, length, width, speed })");
    expect(p).toContain("boat.position.y = 0.5 + Math.sin(t * 1.6) * 0.12");
  });

  it("fix pass lists the problems and asks to keep what works", () => {
    const p = sceneFixPrompt("a voxel pagoda garden", "<html>…</html>", ["top-level name(s) declared twice: scene"]);
    expect(p).toContain("- top-level name(s) declared twice: scene");
    expect(p).toContain("Keep everything that already works");
    expect(p).toContain("PREVIOUS VERSION:\n<html>…</html>");
  });
});

describe("offline three.js import map", () => {
  it("serves three and its core from data: URLs, with the core import rewired", () => {
    const { imports, unknown } = buildImportMap([], sources);
    expect(unknown).toEqual([]);
    expect(Object.keys(imports).sort()).toEqual(["three", "three/core"]);
    const mod = decode(imports.three);
    expect(mod).toContain('"three/core"');
    expect(mod).not.toContain("./three.core.min.js");
    expect(decode(imports["three/core"])).toContain('const t="185"');
  });

  it("pulls each addon's own dependencies in, rewritten to bare specifiers", () => {
    const { imports, unknown } = buildImportMap(["postprocessing/UnrealBloomPass.js"], sources);
    expect(unknown).toEqual([]);
    expect(imports).toHaveProperty(["three/addons/postprocessing/Pass.js"]);
    expect(imports).toHaveProperty(["three/addons/shaders/CopyShader.js"]);
    expect(imports).toHaveProperty(["three/addons/shaders/LuminosityHighPassShader.js"]);
    const bloom = decode(imports["three/addons/postprocessing/UnrealBloomPass.js"]);
    expect(bloom).not.toMatch(/from\s*["']\.{1,2}\//);
    expect(bloom).toContain("'three/addons/postprocessing/Pass.js'");
  });

  it("bundled addon set is closed under its own imports", () => {
    const { unknown } = buildImportMap([...BUNDLED_ADDONS], sources);
    expect(unknown).toEqual([]);
  });

  it("reports addons PrismOS does not bundle", () => {
    expect(buildImportMap(["objects/Water2.js"], sources).unknown).toEqual(["objects/Water2.js"]);
  });
});

describe("normalizeThreeSpecifier", () => {
  it("maps CDN and legacy forms to the bundled specifiers", () => {
    expect(normalizeThreeSpecifier("three")).toBe("three");
    expect(normalizeThreeSpecifier("https://unpkg.com/three@0.185.0/build/three.module.js")).toBe("three");
    expect(normalizeThreeSpecifier("https://cdn.jsdelivr.net/npm/three@0.160/build/three.module.min.js")).toBe("three");
    expect(normalizeThreeSpecifier("https://esm.sh/three@0.170.0")).toBe("three");
    expect(normalizeThreeSpecifier("https://unpkg.com/three@0.185.0/examples/jsm/controls/OrbitControls.js")).toBe(
      "three/addons/controls/OrbitControls.js",
    );
    expect(normalizeThreeSpecifier("three/examples/jsm/controls/OrbitControls.js")).toBe("three/addons/controls/OrbitControls.js");
    expect(normalizeThreeSpecifier("three/addons/controls/OrbitControls")).toBe("three/addons/controls/OrbitControls.js");
    expect(normalizeThreeSpecifier("lil-gui")).toBeNull();
    expect(normalizeThreeSpecifier("https://cdn.skypack.dev/gsap")).toBeNull();
  });
});

describe("self-checks", () => {
  it("stops a runaway pass early: a loop, or far more lines than a scene needs", () => {
    const loop = Array.from({ length: 30 }, () => "  for (let x = cx; x <= cx; x++) {}").join("\n");
    expect(isRunaway(`const a = 1;\n${loop}`)).toBe(true);
    expect(isRunaway(Array.from({ length: 950 }, (_, i) => `voxels.set(${i}, 0, 0, C);`).join("\n"))).toBe(true);
    expect(isRunaway(Array.from({ length: 300 }, (_, i) => `voxels.set(${i}, 0, 0, C);`).join("\n"))).toBe(false);
    expect(sceneMaxTokens(false)).toBeLessThan(sceneMaxTokens(true));
  });

  it("catches the loop the 27B model fell into", () => {
    const looped = Array.from({ length: 30 }, () => "  for (let x = cx; x <= cx; x++) {}").join("\n");
    expect(hasRepetitionLoop(`const a = 1;\n${looped}`)).toBe(true);
    const normal = Array.from({ length: 60 }, (_, i) => `addVoxel(${i}, 0, 0, PAL.stone);`).join("\n");
    expect(hasRepetitionLoop(normal)).toBe(false);
  });

  it("flags a property declared with const and duplicate top-level names", () => {
    expect(lintSceneScript("const solidMat = new THREE.MeshStandardMaterial();\nconst solidMat.color.set(0xffffff);").join(" ")).toMatch(
      /invalid declaration "const solidMat\.color/,
    );
    expect(lintSceneScript("const scene = 1;\nconst scene = 2;").join(" ")).toMatch(/declared twice: scene/);
    expect(lintSceneScript("function a() {\n  const x = 1;\n}\nfunction b() {\n  const x = 2;\n}")).toEqual([]);
  });

  it("counts brackets in code only — strings, comments, templates and regexes don't count", () => {
    const ok = [
      "const s = '{ not a brace';",
      "// } nor this",
      "/* ( nor this */",
      "const t = `${a} [ ${b}`;",
      "const r = /[{(]/g;",
      "function f(a) { return [a, (a + 1)]; }",
    ].join("\n");
    expect(lintSceneScript(ok)).toEqual([]);
    expect(lintSceneScript("function f() {\n  if (x) {\n    go();\n").join(" ")).toMatch(/unbalanced/);
  });
});

describe("scene kit", () => {
  it("serves 'prismos/scene' plus the addons the kit imports", () => {
    const raw = page("import * as THREE from 'three';\nimport { createWorld } from 'prismos/scene';\nconst world = createWorld({ title: 'T' });\nworld.voxels.set(0, 0, 0, 0xff0000);\nworld.start();");
    const r = finalizeSceneHtml(raw, sources);
    expect(r.issues).toEqual([]);
    const map = importMapOf(r.html);
    expect(map).toHaveProperty(["prismos/scene"]);
    expect(map).toHaveProperty(["three/addons/controls/OrbitControls.js"]);
    expect(map).toHaveProperty(["three/addons/postprocessing/UnrealBloomPass.js"]);
    expect(decode(map["prismos/scene"])).toContain("export function createWorld");
  });

  it("flags a kit scene that never calls start()", () => {
    const raw = page("import { createWorld } from 'prismos/scene';\nconst world = createWorld({ title: 'T' });\nworld.voxels.set(0, 0, 0, 0xff0000);");
    expect(finalizeSceneHtml(raw, sources).issues.join(" ")).toMatch(/never calls world\.start\(\)/);
  });

  it("keeps the camera still unless a turntable is asked for, and offers parts, beams and lightning", () => {
    expect(sources.kit).toContain("autoRotate: false");
    expect(sources.kit).toMatch(/return \{[^}]*\bpart\b[^}]*\bbeam\b[^}]*\blightning\b[^}]*\}/);
    expect(sources.kit).toMatch(/return \{[^}]*\bweather\b[^}]*\}/);
  });

  it("kit source only imports what PrismOS bundles", () => {
    const specs = [...sources.kit.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const s of specs) expect(s === "three" || BUNDLED_ADDONS.some((a) => s === `three/addons/${a}`)).toBe(true);
  });
});

describe("only what really moves (field feedback: the whole lighthouse island spun)", () => {
  it("flags the whole scene turning every frame, in onUpdate or a hand-written loop", () => {
    expect(lintSceneScript("world.onUpdate((t) => { world.scene.rotation.y = t * 0.1; });").join(" ")).toMatch(/whole scene/);
    const loop = "function animate() {\n  requestAnimationFrame(animate);\n  scene.rotation.y += 0.002;\n  renderer.render(scene, camera);\n}\nanimate();";
    expect(lintSceneScript(loop).join(" ")).toMatch(/whole scene/);
  });

  it("flags a camera moved every frame and an unrequested autoRotate", () => {
    expect(lintSceneScript("world.onUpdate((t) => { world.camera.position.x = Math.sin(t) * 40; });").join(" ")).toMatch(/camera is moved/);
    expect(lintSceneScript("world.onUpdate((t) => {\n  camera.position.set(Math.sin(t) * 30, 12, Math.cos(t) * 30);\n  camera.lookAt(0, 4, 0);\n});").join(" ")).toMatch(/camera is moved/);
    expect(lintSceneScript("const world = createWorld({ title: 'T', autoRotate: true });").join(" ")).toMatch(/autoRotate/);
  });

  it("lets the real movers move: parts, beams, boats, water", () => {
    const js = [
      "const sails = world.part({ x: 0, y: 20, z: 3 });",
      "world.onUpdate((t) => {",
      "  sails.rotation.z = t;",
      "  beamGroup.rotation.y = t * 0.5;",
      "  boat.position.y = Math.sin(t) * 0.2;",
      "  if (water && water.position) water.position.y = -2.4 + Math.sin(t * 1.3) * 0.25;",
      "});",
    ].join("\n");
    expect(lintSceneScript(js)).toEqual([]);
    // One-off placement at setup is not motion.
    expect(lintSceneScript("world.camera.position.set(10, 10, 10);\nscene.rotation.y = 0.3;")).toEqual([]);
  });

  it("honours a request for a turntable or a moving camera", () => {
    expect(asksForCameraMotion("a voxel robot on a turntable")).toBe(true);
    expect(asksForCameraMotion("a camera flying through a canyon")).toBe(true);
    expect(asksForCameraMotion("a lighthouse in a storm at night")).toBe(false);
    const raw = page("import { createWorld } from 'prismos/scene';\nconst world = createWorld({ title: 'T', autoRotate: true });\nworld.voxels.set(0, 0, 0, 0xff0000);\nworld.start();");
    expect(finalizeSceneHtml(raw, sources, { idea: "a voxel robot on a turntable" }).issues).toEqual([]);
    expect(finalizeSceneHtml(raw, sources, { idea: "a voxel robot" }).issues.join(" ")).toMatch(/autoRotate/);
  });
});

describe("the scene fills in its own detail (one line in, a finished world out)", () => {
  it("turns the words into a set designer's notes in kit terms", () => {
    const notes = directorNotes("a voxel lighthouse on a rocky island in a storm at night").join(" | ");
    expect(notes).toMatch(/world\.beam/);
    expect(notes).toMatch(/keeper's cottage/);
    expect(notes).toMatch(/world\.weather\('storm'\)/);
    expect(notes).toMatch(/mood: 'night'/);
    expect(notes).toMatch(/runs on to the horizon/);
    expect(directorNotes("a cozy cabin in the snow").join(" | ")).toMatch(/world\.weather\('snow'\)/);
    expect(directorNotes("something nobody planned for")).toEqual([]);
  });

  it("asks the model to plan the details first and to add its own", () => {
    const p = scenePrompt("a voxel lighthouse in a storm");
    expect(p).toContain("DIRECTOR'S NOTES");
    expect(p).toContain("// Details: <at least six specific props");
    expect(p).toContain("three small story details of your own");
    expect(scenePrompt("a quiet thing")).toContain("everything that naturally belongs in this place");
  });

  it("guarantees the weather the request named, once, before start()", () => {
    expect(impliedWeather("a lighthouse in a storm at night")).toBe("storm");
    expect(impliedWeather("a cabin in the snow")).toBe("snow");
    expect(impliedWeather("a rainy street")).toBe("rain");
    expect(impliedWeather("a sunny meadow")).toBeNull();
    const js = "const w = createWorld({ title: 'T' });\nw.voxels.set(0, 0, 0, 1);\nw.start();";
    expect(ensureImpliedWeather(js, "a storm at sea")).toEqual({ code: "const w = createWorld({ title: 'T' });\nw.voxels.set(0, 0, 0, 1);\nw.weather('storm');\nw.start();", added: "storm" });
    expect(ensureImpliedWeather(js.replace("w.start()", "w.lightning({ every: 5 });\nw.start()"), "a storm").added).toBeNull();
    expect(ensureImpliedWeather(js.replace("w.start()", "w.particles({ type: 'snow' });\nw.start()"), "snowy hills").added).toBeNull();
    const raw = page("import { createWorld } from 'prismos/scene';\nconst world = createWorld({ title: 'T', mood: 'night' });\nworld.voxels.set(0, 0, 0, 0xff0000);\nworld.start();");
    const r = finalizeSceneHtml(raw, sources, { idea: "a lighthouse in a storm" });
    expect(r.html).toContain("world.weather('storm');\nworld.start();");
    expect(r.notes.join(" ")).toMatch(/added the storm the request asked for/);
  });
});

describe("repairs (the in-app storm lighthouse: `0xcc c6 b8` on line 15, unfixed by a full fix pass)", () => {
  it("rejoins a hex colour the model split with spaces, and nothing else", () => {
    expect(repairSplitHexLiterals("const S = () => (random() < 0.5 ? 0xd8d2c4 : 0xcc c6 b8 | 0);")).toEqual({
      code: "const S = () => (random() < 0.5 ? 0xd8d2c4 : 0xccc6b8 | 0);",
      count: 1,
    });
    expect(repairSplitHexLiterals("const a = 0xff ? 1 : 2; const b = 0x10 in o;").count).toBe(0);
    expect(repairSplitHexLiterals("const c = 0xab cd;").count).toBe(0); // 4 digits: left for the checks
    expect(repairSplitHexLiterals("const d = 0xffffff\nab();").count).toBe(0); // never across lines
  });

  it("finalize applies it and says so", () => {
    const raw = page("import { createWorld } from 'prismos/scene';\nconst world = createWorld({ title: 'T' });\nworld.voxels.set(0, 0, 0, 0xcc c6 b8);\nworld.start();");
    const r = finalizeSceneHtml(raw, sources);
    expect(r.html).toContain("world.voxels.set(0, 0, 0, 0xccc6b8);");
    expect(r.notes.join(" ")).toMatch(/rejoined 1 colour value/);
    expect(r.issues).toEqual([]);
  });

  it("repairs one unparseable line without touching the others", () => {
    const lines = ["const a = 1;", "  const b = (2;", "const c = 3;"];
    const p = sceneLineFixPrompt(lines, 2, "SyntaxError: Unexpected token ';'");
    expect(p).toContain(">>2:   const b = (2;");
    expect(p).toContain("  1: const a = 1;");
    expect(p).toContain("Return ONLY the corrected line 2");
    expect(lineFromReply("```js\n2: const b = (2);\n```", 2)).toBe("const b = (2);");
    expect(lineFromReply("  0: 0xff0000,", 7)).toBe("  0: 0xff0000,"); // a real object key is kept
    const html = `<html><head></head><body><script type="module">\n${lines.join("\n")}\n</script></body></html>`;
    const out = spliceSceneLine(html, 0, 3, "const b = (2);");
    expect(out).toContain("\nconst a = 1;\n  const b = (2);\nconst c = 3;\n");
    expect(spliceSceneLine(html, 1, 1, "x")).toBeNull();
  });

  it("writes with a moderate presence penalty and copies with a light one", () => {
    expect(sceneOverrides(false).presencePenalty).toBeLessThan(1.5);
    expect(sceneOverrides(false, "fix").presencePenalty).toBeLessThan(sceneOverrides(false).presencePenalty);
  });
});

describe("InstancedMesh capacity check (run A's invisible pagoda)", () => {
  it("flags appending at mesh.count without resetting it", () => {
    const js = "const vmesh = new THREE.InstancedMesh(geo, mat, 46000);\nfunction addVoxel(x) {\n  const i = vmesh.count;\n  vmesh.setMatrixAt(i, m);\n  vmesh.count = i + 1;\n}";
    expect(lintSceneScript(js).join(" ")).toMatch(/vmesh\.count starts at the InstancedMesh capacity/);
  });

  it("accepts a reset, or a loop bound that merely reads count", () => {
    expect(lintSceneScript("const v = new THREE.InstancedMesh(g, m, 10);\nv.count = 0;\nconst i = v.count;\nv.count++;")).toEqual([]);
    expect(lintSceneScript("const v = new THREE.InstancedMesh(g, m, 10);\nfor (let i = 0; i <= v.count; i++) {}")).toEqual([]);
  });
});

/** Parse without running: the Function constructor compiles its body and stops. */
const parseOnly = (source: string) => new Function(source);

describe("duplicate names and the syntax probe (run D: `const stoneC` declared twice)", () => {
  const runD = [
    "import * as THREE from 'three';",
    "import { createWorld } from 'prismos/scene';",
    "const grassA = 0x7a9c4e, grassB = 0x6b8c42;",
    "const stoneA = 0xc8b896, stoneB = 0xb3a17e, stoneC = 0xa8946f;",
    "const stoneC = () => [stoneA, stoneB][0];",
    "const world = createWorld({ title: 'T' });",
    "world.start();",
  ].join("\n");

  it("sees every declarator of a top-level const, not just the first", () => {
    expect(topLevelDeclaredNames("const a = f(1, 2), b = [3, 4], c = { d: 5 };\nlet e;\nfunction g() { const h = 1; }\nclass K {}")).toEqual(["a", "b", "c", "e", "g", "K"]);
    expect(lintSceneScript(runD).join(" ")).toMatch(/declared twice: stoneC/);
  });

  it("the probe parses like a browser would, without running anything", () => {
    const probe = syntaxProbeSource(runD);
    expect(probe).not.toMatch(/^\s*import\s/m);
    expect(probe.split("\n").length).toBe(runD.split("\n").length + 3);
    expect(() => parseOnly(probe)).toThrow(/stoneC.*already been declared/);
    const fine = runD.replace("const stoneC = () =>", "const stonePick = () =>");
    expect(() => parseOnly(syntaxProbeSource(fine))).not.toThrow();
    // Never executed: a top-level await and side effects stay inert.
    expect(() => parseOnly(syntaxProbeSource("await fetch('x');\nwhile (true) {}"))).not.toThrow();
  });

  it("probe keeps line numbers and survives multi-line imports and exports", () => {
    const code = "import {\n  OrbitControls\n} from 'three/addons/controls/OrbitControls.js';\nexport const a = 1;\nconst b = import.meta.url;";
    const probe = syntaxProbeSource(code);
    expect(probe.split("\n").length).toBe(code.split("\n").length + 3);
    expect(() => parseOnly(probe)).not.toThrow();
  });

  it("without a Worker (tests, old webviews) the probe abstains instead of guessing", async () => {
    expect(await checkSceneSyntax("const a = ;")).toBeNull();
  });

  it("finds module scripts in the finished file", () => {
    const r = finalizeSceneHtml(page("import * as THREE from 'three';\nconst a = 1;"), sources);
    const scripts = moduleScriptsOf(r.html);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain("const a = 1;");
  });
});

describe("dry run (the in-app lighthouse: `bands.find(b => b.y === y).r` on a missing band)", () => {
  /** Run the worker script in-process: postMessage is the only thing it needs. */
  const runDry = (code: string) =>
    new Promise<{ ok: boolean; error?: string }>((resolve) => {
      new Function("postMessage", dryRunSource(code))(resolve);
    });

  const lighthouse = [
    "import * as THREE from 'three';",
    "import { createWorld } from 'prismos/scene';",
    "const world = createWorld({ title: 'The Keeper', mood: 'night' });",
    "const { voxels, random } = world;",
    "const bands = [{ y: 4, r: 3.6 }, { y: 7, r: 3.35 }];",
    "bands.forEach((b) => voxels.cylinder(0, b.y, 0, b.r, 3, () => (random() < 0.5 ? 0xe8eef3 : 0xc0271d)));",
    "const beam = new THREE.Mesh(new THREE.ConeGeometry(9, 60, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0c0 }));",
    "beam.rotation.x = Math.PI / 2; world.add(beam);",
    "[5, 8].forEach((y) => voxels.remove(0, y, Math.round(bands.find((b) => b.y === y).r)));",
    "world.start();",
  ].join("\n");

  it("catches the model's own runtime error, with three.js and the kit stubbed out", async () => {
    const r = await runDry(lighthouse);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/reading 'r'/);
  });

  it("passes a scene whose logic is sound, even with heavy three.js use", async () => {
    const fixed = lighthouse.replace("[5, 8].forEach", "[4, 7].forEach");
    expect(await runDry(fixed)).toEqual({ ok: true });
  });

  it("calls update callbacks and colour functions, so errors inside them surface", async () => {
    const inUpdate = "import { createWorld } from 'prismos/scene';\nconst w = createWorld({});\nconst boats = [];\nw.onUpdate((t) => { boats[0].position.y = t; });\nw.start();";
    expect((await runDry(inUpdate)).error).toMatch(/position/);
    const inColour = "import { createWorld } from 'prismos/scene';\nconst w = createWorld({});\nconst PAL = {};\nw.voxels.box(0, 0, 0, 3, 3, 3, () => PAL.stone.dark);\nw.start();";
    expect((await runDry(inColour)).error).toMatch(/dark/);
  });

  it("knows the kit's moving parts, beams and lightning, and samples part colours too", async () => {
    const ok = [
      "import { createWorld } from 'prismos/scene';",
      "const world = createWorld({ title: 'Mill', mood: 'night' });",
      "const sails = world.part({ x: 0, y: 20, z: 3 });",
      "for (let i = -8; i <= 8; i++) sails.voxels.set(i, 0, 0, () => 0xeeeeee);",
      "world.beam({ x: 0, y: 30, z: 0, length: 30 });",
      "world.lightning({ every: 6 });",
      "world.onUpdate((t) => { sails.rotation.z = t * 0.8; });",
      "world.start();",
    ].join("\n");
    expect(await runDry(ok)).toEqual({ ok: true });
    const bad = ok.replace("() => 0xeeeeee", "() => PAL.sail.white").replace("const sails", "const PAL = {};\nconst sails");
    expect((await runDry(bad)).error).toMatch(/white/);
  });

  it("turns imports into stand-ins without moving any line", () => {
    const code = "import * as THREE from 'three';\nimport {\n  OrbitControls as OC\n} from 'three/addons/controls/OrbitControls.js';\nimport { createWorld } from 'prismos/scene';\nconst a = 1;";
    const out = stubImports(code);
    expect(out.split("\n").length).toBe(code.split("\n").length);
    expect(out).toContain("const THREE = __any();");
    expect(out).toContain("const OC = __any();");
    expect(out).toContain("const createWorld = __createWorld;");
    const outLines = out.split("\n");
    expect(outLines[outLines.length - 1]).toBe("const a = 1;");
  });

  it("without a Worker the dry run abstains", async () => {
    expect(await dryRunScene(lighthouse)).toBeNull();
  });
});

describe("finalizeSceneHtml", () => {
  it("ships a clean scene: import map first, CDN map removed, error panel added", () => {
    const raw = page(
      "import * as THREE from 'three';\nimport { OrbitControls } from 'three/addons/controls/OrbitControls.js';\nconst scene = new THREE.Scene();",
      '<script type="importmap">{"imports":{"three":"https://unpkg.com/three@0.185.0/build/three.module.js"}}</script>',
    );
    const r = finalizeSceneHtml(raw, sources);
    expect(r.issues).toEqual([]);
    expect(r.regenerate).toBe(false);
    expect(r.title).toBe("test-scene");
    expect(r.html).not.toContain("unpkg.com");
    expect(r.html.match(/type="importmap"/g)).toHaveLength(1);
    expect(r.html.indexOf('type="importmap"')).toBeLessThan(r.html.indexOf('type="module"'));
    expect(Object.keys(importMapOf(r.html))).toContain("three/addons/controls/OrbitControls.js");
    expect(r.html).toContain("__prismos_err");
    expect(r.notes.join(" ")).toMatch(/import map/);
    // Offline is enforced by the file itself, ahead of every script.
    const csp = r.html.indexOf('http-equiv="Content-Security-Policy"');
    expect(csp).toBeGreaterThan(-1);
    expect(csp).toBeLessThan(r.html.indexOf('type="importmap"'));
    expect(r.html).toContain("connect-src 'none'");
  });

  it("replaces a model-written CSP with PrismOS's offline policy", () => {
    const r = finalizeSceneHtml(page("import * as THREE from 'three';", '<meta http-equiv="Content-Security-Policy" content="default-src *">'), sources);
    expect(r.html).not.toContain("default-src *");
    expect(r.html.match(/Content-Security-Policy/g)).toHaveLength(1);
  });

  it("rewrites CDN imports and shims named imports that r185 no longer exports", () => {
    const raw = page(
      "import { Scene, sRGBEncoding as enc } from 'https://unpkg.com/three@0.150.0/build/three.module.js';\nimport { OrbitControls } from 'https://unpkg.com/three@0.150.0/examples/jsm/controls/OrbitControls.js';\nconst s = new Scene();",
    );
    const r = finalizeSceneHtml(raw, sources);
    expect(r.issues).toEqual([]);
    expect(r.html).toContain("import * as __THREE1 from 'three'; const { Scene, sRGBEncoding: enc } = __THREE1;");
    expect(r.html).toContain("from 'three/addons/controls/OrbitControls.js'");
  });

  it("upgrades legacy THREE.OrbitControls and global-THREE classic scripts", () => {
    const raw = `<!DOCTYPE html><html><head><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script></head><body><script>\nconst scene = new THREE.Scene();\nconst c = new THREE.OrbitControls(cam, el);\n</script></body></html>`;
    const r = finalizeSceneHtml(raw, sources);
    expect(r.issues).toEqual([]);
    expect(r.html).not.toContain("cdnjs");
    expect(r.html).toContain('<script type="module">');
    expect(r.html).toContain("import * as THREE from 'three';");
    expect(r.html).toContain("import { OrbitControls } from 'three/addons/controls/OrbitControls.js';");
    expect(r.html).toContain("new OrbitControls(cam, el)");
  });

  it("drops web fonts and reports online resources and unavailable modules", () => {
    const raw = page(
      "import * as THREE from 'three';\nimport GUI from 'lil-gui';\nconst tex = new THREE.TextureLoader().load('https://example.com/grass.jpg');",
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
    );
    const r = finalizeSceneHtml(raw, sources);
    expect(r.html).not.toContain("fonts.googleapis.com");
    expect(r.issues.join(" ")).toMatch(/imports "lil-gui"/);
    expect(r.issues.join(" ")).toMatch(/online resource \(https:\/\/example\.com\/grass\.jpg/);
    expect(r.regenerate).toBe(false);
  });

  it("keeps the SVG namespace URL, which is not a network request", () => {
    const r = finalizeSceneHtml(
      page("import * as THREE from 'three';\nconst svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');"),
      sources,
    );
    expect(r.issues).toEqual([]);
  });

  it("asks for a regenerate when the output was cut off or looped", () => {
    const cut = finalizeSceneHtml("FILENAME: x.html\n<!DOCTYPE html><html><head></head><body><script type=\"module\">\nimport * as THREE from 'three';\nconst a = [", sources);
    expect(cut.regenerate).toBe(true);
    expect(cut.issues.join(" ")).toMatch(/cut off/);
    const looped = finalizeSceneHtml(
      page(`import * as THREE from 'three';\n${Array.from({ length: 30 }, () => "for (let x = cx; x <= cx; x++) {}").join("\n")}`),
      sources,
    );
    expect(looped.regenerate).toBe(true);
    const flagged = finalizeSceneHtml(page("import * as THREE from 'three';"), sources, { truncated: true });
    expect(flagged.regenerate).toBe(true);
  });

  it("asks for a fix pass (not a regenerate) for the pagoda's invalid declaration", () => {
    const r = finalizeSceneHtml(
      page("import * as THREE from 'three';\nconst solidMat = new THREE.MeshStandardMaterial();\nconst solidMat.color.set(0xffffff);"),
      sources,
    );
    expect(r.regenerate).toBe(false);
    expect(r.issues.join(" ")).toMatch(/invalid declaration/);
  });

  it("closes a complete document that only lacks </html>", () => {
    const r = finalizeSceneHtml(
      "FILENAME: a.html\n<!DOCTYPE html><html><head></head><body><script type=\"module\">\nimport * as THREE from 'three';\n</script></body>",
      sources,
    );
    expect(r.issues).toEqual([]);
    expect(r.html.trimEnd().endsWith("</html>")).toBe(true);
  });
});
