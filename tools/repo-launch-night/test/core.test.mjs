import test from "node:test";
import assert from "node:assert/strict";

import {
  DIMENSIONS,
  ETHICAL_GUARDRAILS,
  allocateFocus,
  averageReadiness,
  calculateMetricDelta,
  clampRating,
  createOvernightPlan,
  createRepo,
  emptyRatings,
  generateLaunchCopy,
  getPriorityActions,
  normalizeMetrics,
  normalizeRepoReference,
  parseRepoReferences,
  prioritizeRepos,
  scoreRepo,
} from "../lib/core.mjs";

const ratingsAt = (rating) => Object.fromEntries(
  DIMENSIONS.map(({ key }) => [key, rating]),
);

test("the readiness model is transparent and totals 100 points", () => {
  assert.equal(Object.isFrozen(DIMENSIONS), true);
  assert.equal(Object.isFrozen(ETHICAL_GUARDRAILS), true);
  assert.equal(new Set(DIMENSIONS.map(({ key }) => key)).size, DIMENSIONS.length);
  assert.equal(DIMENSIONS.reduce((sum, { weight }) => sum + weight, 0), 100);

  for (const dimension of DIMENSIONS) {
    assert.match(dimension.key, /^[a-z][A-Za-z]+$/);
    assert.ok(dimension.label);
    assert.ok(dimension.guidance);
    assert.ok(dimension.action);
    assert.ok(dimension.actionDetail);
    assert.ok(dimension.weight > 0);
  }
});

test("normalizeRepoReference accepts common GitHub slugs and clone URLs", () => {
  assert.deepEqual(normalizeRepoReference("  OpenAI/openai-node  "), {
    id: "openai/openai-node",
    slug: "OpenAI/openai-node",
    owner: "OpenAI",
    name: "openai-node",
    url: "https://github.com/OpenAI/openai-node",
  });

  assert.equal(
    normalizeRepoReference("https://www.github.com/OpenAI/openai-node.git?utm_source=launch#readme").slug,
    "OpenAI/openai-node",
  );
  assert.equal(normalizeRepoReference("http://github.com/openai/openai-node/").slug, "openai/openai-node");
  assert.equal(normalizeRepoReference("github.com/openai/openai-node").slug, "openai/openai-node");
  assert.equal(normalizeRepoReference("git@github.com:openai/openai-node.git").slug, "openai/openai-node");
  assert.equal(normalizeRepoReference("git+https://github.com/openai/openai-node.git").slug, "openai/openai-node");
  assert.equal(normalizeRepoReference("owner/repo_name.js").slug, "owner/repo_name.js");
});

test("normalizeRepoReference rejects non-repositories and invalid GitHub owners", () => {
  const invalid = [
    "",
    "owner-only",
    "owner/repo/issues",
    "https://gitlab.com/owner/repo",
    "https://github.com.evil.example/owner/repo",
    "../secret",
    "owner/re po",
    "bad_owner/repo",
    "-owner/repo",
    "owner-/repo",
    "owner/..",
    "<script>/repo",
  ];

  for (const value of invalid) {
    assert.throws(
      () => normalizeRepoReference(value),
      /Repository reference is empty|not an owner\/repository GitHub reference/,
      value,
    );
  }
});

test("parseRepoReferences parses many inputs, deduplicates case-insensitively, and reports bad entries", () => {
  const parsed = parseRepoReferences(`
    OpenAI/openai-node,
    https://github.com/openai/OPENAI-node.git
    acme/widgets
    definitely-not-a-repo
  `);

  assert.deepEqual(parsed.repositories.map(({ slug }) => slug), [
    "OpenAI/openai-node",
    "acme/widgets",
  ]);
  assert.equal(parsed.invalid.length, 1);
  assert.equal(parsed.invalid[0].value, "definitely-not-a-repo");
  assert.match(parsed.invalid[0].message, /not an owner\/repository/);

  const fromArray = parseRepoReferences(["a/one", "B/two", "a/ONE", "nope"]);
  assert.deepEqual(fromArray.repositories.map(({ id }) => id), ["a/one", "b/two"]);
  assert.deepEqual(fromArray.invalid.map(({ value }) => value), ["nope"]);
  assert.deepEqual(parseRepoReferences(null), { repositories: [], invalid: [] });
});

test("ratings and metrics normalize hostile or imprecise manual input", () => {
  assert.equal(clampRating(-10), 0);
  assert.equal(clampRating(2.49), 2);
  assert.equal(clampRating(2.5), 3);
  assert.equal(clampRating(99), 5);
  assert.equal(clampRating("not-a-number"), 0);
  assert.deepEqual(emptyRatings(99), ratingsAt(5));
  assert.deepEqual(normalizeMetrics({ stars: -4, forks: 2.6 }), { stars: 0, forks: 3 });
  assert.deepEqual(normalizeMetrics({ stars: "12", forks: Infinity }), { stars: 12, forks: 0 });
});

test("createRepo builds a normalized, independent manual metadata record", () => {
  const repo = createRepo("Acme/Launch-Kit", {
    tagline: "  ship a clearer launch  ",
    audience: "maintainers",
    proof: "a tested demo",
    forkUseCase: "a private adaptation",
    strategicImportance: 9,
    ratings: { valueClarity: 4.6, trust: -1, unknown: 5 },
    baseline: { stars: 10, forks: 3 },
    current: { stars: 14.2, forks: 4 },
    notes: 42,
  });

  assert.equal(repo.id, "acme/launch-kit");
  assert.equal(repo.slug, "Acme/Launch-Kit");
  assert.equal(repo.strategicImportance, 5);
  assert.equal(repo.ratings.valueClarity, 5);
  assert.equal(repo.ratings.trust, 0);
  assert.equal(repo.ratings.activation, 0);
  assert.equal("unknown" in repo.ratings, false);
  assert.deepEqual(repo.baseline, { stars: 10, forks: 3 });
  assert.deepEqual(repo.current, { stars: 14, forks: 4 });
  assert.equal(repo.notes, "42");

  const second = createRepo({ owner: "Acme", name: "Another" });
  second.ratings.activation = 5;
  assert.equal(repo.ratings.activation, 0);
});

test("scoreRepo exposes weighted evidence and readiness statuses", () => {
  const ready = createRepo("acme/ready", { ratings: ratingsAt(5) });
  const polish = createRepo("acme/polish", { ratings: ratingsAt(3) });
  const early = createRepo("acme/early", { ratings: ratingsAt(2) });

  assert.equal(scoreRepo(ready).score, 100);
  assert.equal(scoreRepo(ready).status, "Campaign-ready");
  assert.equal(scoreRepo(polish).score, 60);
  assert.equal(scoreRepo(polish).status, "Polish before launch");
  assert.equal(scoreRepo(early).score, 40);
  assert.equal(scoreRepo(early).status, "Build the surface first");

  const breakdown = scoreRepo(createRepo("acme/mixed", {
    ratings: { valueClarity: 5, activation: 4, demonstrability: 3, trust: 2, discoverability: 1 },
  })).breakdown;
  assert.equal(breakdown.reduce((sum, item) => sum + item.weight, 0), 100);
  assert.deepEqual(
    breakdown.slice(0, 5).map(({ rating, points }) => ({ rating, points })),
    [
      { rating: 5, points: 15 },
      { rating: 4, points: 12 },
      { rating: 3, points: 6 },
      { rating: 2, points: 6 },
      { rating: 1, points: 2 },
    ],
  );
});

test("priority actions rank transparent score gaps without engagement automation", () => {
  const repo = createRepo("acme/actions", {
    ratings: {
      ...ratingsAt(5),
      trust: 1,
      demonstrability: 0,
      discoverability: 4,
    },
  });
  const actions = getPriorityActions(repo, 10);

  assert.deepEqual(actions.map(({ dimension }) => dimension), [
    "trust",
    "demonstrability",
    "discoverability",
  ]);
  assert.deepEqual(actions.map(({ missingPoints }) => missingPoints), [12, 10, 2]);
  assert.deepEqual(actions.map(({ impact }) => impact), ["High", "High", "Fine-tune"]);
  assert.equal(getPriorityActions(repo, 2).length, 2);
  assert.deepEqual(getPriorityActions(repo, -1), []);

  const text = JSON.stringify(actions).toLowerCase();
  assert.doesNotMatch(text, /(?:automate|buy|fake|exchange).{0,40}(?:stars?|forks?)/);
});

test("repository priority is stable, strategic, and does not mutate input", () => {
  const low = createRepo("acme/low", { ratings: ratingsAt(0), strategicImportance: 1 });
  const high = createRepo("acme/high", { ratings: ratingsAt(5), strategicImportance: 5 });
  const input = [low, high];
  const ranked = prioritizeRepos(input);

  assert.deepEqual(input.map(({ slug }) => slug), ["acme/low", "acme/high"]);
  assert.deepEqual(ranked.map(({ repo, rank }) => [repo.slug, rank]), [
    ["acme/high", 1],
    ["acme/low", 2],
  ]);
  assert.ok(ranked[0].priority > ranked[1].priority);
  assert.equal(ranked[0].readiness.score, 100);

  const tied = prioritizeRepos([
    createRepo("acme/first", { ratings: ratingsAt(3) }),
    createRepo("acme/second", { ratings: ratingsAt(3) }),
  ]);
  assert.deepEqual(tied.map(({ repo }) => repo.name), ["first", "second"]);
});

test("focus allocation uses 100, 70/30, and 60/25/15 portfolio lanes", () => {
  const repos = [
    createRepo("acme/one", { ratings: ratingsAt(5) }),
    createRepo("acme/two", { ratings: ratingsAt(4) }),
    createRepo("acme/three", { ratings: ratingsAt(3) }),
    createRepo("acme/four", { ratings: ratingsAt(2) }),
  ];

  assert.deepEqual(allocateFocus([]), []);
  assert.deepEqual(allocateFocus(repos.slice(0, 1)).map(({ allocation }) => allocation), [100]);
  assert.deepEqual(allocateFocus(repos.slice(0, 2)).map(({ allocation }) => allocation), [70, 30]);
  assert.deepEqual(allocateFocus(repos.slice(0, 3)).map(({ allocation }) => allocation), [60, 25, 15]);

  const four = allocateFocus(repos);
  assert.deepEqual(four.map(({ allocation }) => allocation), [60, 25, 15, 0]);
  assert.deepEqual(four.map(({ lane }) => lane), ["Primary", "Secondary", "Experiment", "Hold"]);
  assert.equal(four.reduce((sum, { allocation }) => sum + allocation, 0), 100);
});

test("the overnight plan is deterministic, champion-aware, and human-gated", () => {
  const low = createRepo("acme/low", { ratings: ratingsAt(1) });
  const champion = createRepo("acme/champion", { ratings: ratingsAt(5) });
  const start = new Date("2026-08-02T01:00:00.000Z");
  const plan = createOvernightPlan([low, champion], start);

  assert.equal(plan.length, 9);
  assert.deepEqual(plan.map(({ id, index }) => [id, index]), [
    ["step-1", 1], ["step-2", 2], ["step-3", 3],
    ["step-4", 4], ["step-5", 5], ["step-6", 6],
    ["step-7", 7], ["step-8", 8], ["step-9", 9],
  ]);
  assert.equal(plan[0].time, "2026-08-02T01:00:00.000Z");
  assert.equal(plan.at(-1).time, "2026-08-02T13:00:00.000Z");
  assert.match(plan[1].detail, /acme\/champion/);
  assert.match(plan[2].title, /Human approval gate/);
  assert.match(plan[5].owner, /Manual/);
  assert.match(plan[7].detail, /without auto-sending/);
  assert.ok(plan.every(({ localTime }) => typeof localTime === "string" && localTime.length > 0));
});

test("launch copy is repo-specific, honest, and never asks for manufactured engagement", () => {
  const repo = createRepo("acme/launch", {
    tagline: "turns launch notes into a focused checklist",
    audience: "open-source maintainers",
    proof: "the documented example produces a plan in under a minute",
    forkUseCase: "adapting the checklist to a team workflow",
  });
  const copy = generateLaunchCopy(repo);

  assert.equal(copy.length, 4);
  assert.equal(new Set(copy.map(({ id }) => id)).size, 4);
  assert.deepEqual(copy.map(({ channel }) => channel), [
    "Short post",
    "Builder note",
    "Community draft",
    "Fork invitation",
  ]);
  for (const draft of copy) {
    assert.match(draft.body, /https:\/\/github\.com\/acme\/launch/);
    assert.doesNotMatch(draft.body, /undefined|null/);
    assert.doesNotMatch(draft.body, /(?:buy|purchase|fake|exchange|bot).{0,50}(?:stars?|forks?)/i);
  }
  assert.match(copy[0].body, /open-source maintainers/);
  assert.match(copy[0].body, /documented example/);
  assert.match(copy[3].body, /not as a vanity metric/);

  const placeholders = generateLaunchCopy(createRepo("acme/new"));
  assert.match(placeholders[0].body, /\[who this is for\]/);
  assert.match(placeholders[0].body, /\[verified proof or demo result\]/);
  assert.ok(ETHICAL_GUARDRAILS.some((rule) => /star exchanges/.test(rule)));
  assert.ok(ETHICAL_GUARDRAILS.some((rule) => /human verifies/.test(rule)));
});

test("baseline/current metrics preserve observable negative deltas and aggregate readiness", () => {
  const gaining = createRepo("acme/gaining", {
    ratings: ratingsAt(5),
    baseline: { stars: 10, forks: 4 },
    current: { stars: 14, forks: 7 },
  });
  const declining = createRepo("acme/declining", {
    ratings: ratingsAt(0),
    baseline: { stars: 20, forks: 5 },
    current: { stars: 18, forks: 3 },
  });

  assert.deepEqual(calculateMetricDelta(gaining), { stars: 4, forks: 3 });
  assert.deepEqual(calculateMetricDelta(declining), { stars: -2, forks: -2 });
  assert.equal(averageReadiness([]), 0);
  assert.equal(averageReadiness([gaining]), 100);
  assert.equal(averageReadiness([gaining, declining]), 50);
});
