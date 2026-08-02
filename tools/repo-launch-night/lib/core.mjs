/**
 * Pure campaign logic for Repo Launch Night.
 *
 * This module performs no network, filesystem, or publishing operations. The UI
 * can therefore explain every score and keep all campaign data in the browser.
 */

export const DIMENSIONS = Object.freeze([
  {
    key: "valueClarity",
    label: "Value clarity",
    weight: 15,
    guidance: "The audience and concrete benefit are obvious above the README fold.",
    action: "Rewrite the README opening",
    actionDetail: "Lead with who it helps, the painful job it handles, and the useful outcome.",
  },
  {
    key: "activation",
    label: "Five-minute activation",
    weight: 15,
    guidance: "A new visitor can reach a useful result with a short, tested quickstart.",
    action: "Build a copy-paste quickstart",
    actionDetail: "Test the shortest install-to-result path in a clean environment and show its output.",
  },
  {
    key: "demonstrability",
    label: "Demonstrability",
    weight: 10,
    guidance: "A screenshot, GIF, live demo, or reproducible example proves the core experience.",
    action: "Show the result before the architecture",
    actionDetail: "Add one focused visual or reproducible example near the top of the README.",
  },
  {
    key: "trust",
    label: "Trust",
    weight: 15,
    guidance: "License, CI, releases, security guidance, and limitations are easy to verify.",
    action: "Close the trust gaps",
    actionDetail: "Make the license, release status, security path, limitations, and test signal visible.",
  },
  {
    key: "discoverability",
    label: "Discoverability",
    weight: 10,
    guidance: "The description, topics, homepage, and language match terms the audience uses.",
    action: "Tighten repository metadata",
    actionDetail: "Use a specific description, relevant topics, and a useful homepage or demo link.",
  },
  {
    key: "forkability",
    label: "Forkability",
    weight: 15,
    guidance: "Architecture, customization points, contribution steps, and starter issues are clear.",
    action: "Create a real reason to fork",
    actionDetail: "Document one customization path or template and make the first contribution obvious.",
  },
  {
    key: "freshness",
    label: "Freshness",
    weight: 10,
    guidance: "Recent activity, a current release, and responsive maintenance show the repo is alive.",
    action: "Cut a clean, current release",
    actionDetail: "Resolve stale instructions, update the changelog, and publish accurate release notes.",
  },
  {
    key: "shareability",
    label: "Shareability",
    weight: 10,
    guidance: "The project has a concrete story and a useful artifact people will want to pass along.",
    action: "Package one shareable insight",
    actionDetail: "Turn a lesson, benchmark, demo, or starter into something valuable without asking for a star.",
  },
]);

export const ETHICAL_GUARDRAILS = Object.freeze([
  "No purchased engagement, sockpuppets, star exchanges, engagement rings, or fake accounts.",
  "No automated issue comments, unsolicited bulk DMs, scraped outreach, or cross-community spam.",
  "No fabricated benchmarks, testimonials, adoption numbers, security claims, or guarantees.",
  "A fork invitation must offer a genuine customization, template, experiment, or contribution path.",
  "Every post is a draft until a human verifies the claim, audience fit, and community rules.",
]);

const OWNER_SEGMENT = /^(?!.*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_SEGMENT = /^[A-Za-z0-9_.-]{1,100}$/;

function stripKnownGitHubPrefix(raw) {
  return raw
    .trim()
    .replace(/^git\+/, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
}

export function normalizeRepoReference(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Repository reference is empty.");
  }

  const path = stripKnownGitHubPrefix(raw);
  const parts = path.split("/").filter(Boolean);
  if (
    parts.length !== 2 ||
    !OWNER_SEGMENT.test(parts[0]) ||
    !REPO_SEGMENT.test(parts[1]) ||
    parts[0] === "." ||
    parts[0] === ".." ||
    parts[1] === "." ||
    parts[1] === ".."
  ) {
    throw new Error(`“${raw.trim()}” is not an owner/repository GitHub reference.`);
  }

  const [owner, name] = parts;
  return {
    id: `${owner}/${name}`.toLowerCase(),
    slug: `${owner}/${name}`,
    owner,
    name,
    url: `https://github.com/${owner}/${name}`,
  };
}

export function parseRepoReferences(input) {
  const values = Array.isArray(input)
    ? input
    : String(input ?? "").split(/[\s,]+/);
  const repositories = [];
  const invalid = [];
  const seen = new Set();

  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    try {
      const repo = normalizeRepoReference(value);
      if (!seen.has(repo.id)) {
        repositories.push(repo);
        seen.add(repo.id);
      }
    } catch (error) {
      invalid.push({ value: value.trim(), message: error.message });
    }
  }

  return { repositories, invalid };
}

export function emptyRatings(defaultValue = 0) {
  const safeDefault = clampRating(defaultValue);
  return Object.fromEntries(DIMENSIONS.map(({ key }) => [key, safeDefault]));
}

export function createRepo(reference, overrides = {}) {
  const normalized = typeof reference === "string"
    ? normalizeRepoReference(reference)
    : normalizeRepoReference(reference.slug ?? `${reference.owner}/${reference.name}`);
  const ratings = emptyRatings();

  for (const dimension of DIMENSIONS) {
    const value = overrides.ratings?.[dimension.key];
    if (value !== undefined) ratings[dimension.key] = clampRating(value);
  }

  return {
    ...normalized,
    tagline: String(overrides.tagline ?? ""),
    audience: String(overrides.audience ?? ""),
    proof: String(overrides.proof ?? ""),
    forkUseCase: String(overrides.forkUseCase ?? ""),
    strategicImportance: clampRating(overrides.strategicImportance ?? 3),
    ratings,
    baseline: normalizeMetrics(overrides.baseline),
    current: normalizeMetrics(overrides.current),
    notes: String(overrides.notes ?? ""),
  };
}

export function clampRating(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(5, Math.round(numeric)));
}

export function normalizeMetrics(metrics = {}) {
  return {
    stars: nonNegativeInteger(metrics?.stars),
    forks: nonNegativeInteger(metrics?.forks),
  };
}

function nonNegativeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

export function scoreRepo(repo) {
  const breakdown = DIMENSIONS.map((dimension) => {
    const rating = clampRating(repo?.ratings?.[dimension.key]);
    return {
      ...dimension,
      rating,
      points: Math.round((rating / 5) * dimension.weight * 10) / 10,
    };
  });
  const score = Math.round(breakdown.reduce((total, item) => total + item.points, 0));
  const status = score >= 75
    ? "Campaign-ready"
    : score >= 55
      ? "Polish before launch"
      : "Build the surface first";

  return { score, status, breakdown };
}

export function getPriorityActions(repo, limit = 5) {
  const scored = scoreRepo(repo);
  return scored.breakdown
    .filter((dimension) => dimension.rating < 5)
    .map((dimension) => {
      const missingPoints = dimension.weight - dimension.points;
      return {
        id: `${repo.id}:${dimension.key}`,
        dimension: dimension.key,
        title: dimension.action,
        detail: dimension.actionDetail,
        missingPoints: Math.round(missingPoints * 10) / 10,
        impact: missingPoints >= 9 ? "High" : missingPoints >= 5 ? "Medium" : "Fine-tune",
      };
    })
    .sort((a, b) => b.missingPoints - a.missingPoints || a.title.localeCompare(b.title))
    .slice(0, Math.max(0, limit));
}

function repoPriority(repo) {
  const readiness = scoreRepo(repo).score;
  const forkability = clampRating(repo?.ratings?.forkability) * 3;
  const shareability = clampRating(repo?.ratings?.shareability) * 2;
  const strategic = clampRating(repo?.strategicImportance ?? 3) * 2;
  return Math.round((readiness * 0.65 + forkability + shareability + strategic) * 10) / 10;
}

export function prioritizeRepos(repos) {
  return repos
    .map((repo, inputIndex) => ({
      repo,
      inputIndex,
      priority: repoPriority(repo),
      readiness: scoreRepo(repo),
    }))
    .sort((a, b) => b.priority - a.priority || a.inputIndex - b.inputIndex)
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function allocateFocus(repos) {
  const ranked = prioritizeRepos(repos);
  const presets = {
    0: [],
    1: [100],
    2: [70, 30],
  };
  const allocations = presets[ranked.length] ?? [60, 25, 15];

  return ranked.map((entry, index) => ({
    ...entry,
    allocation: allocations[index] ?? 0,
    lane: index === 0 ? "Primary" : index === 1 ? "Secondary" : index === 2 ? "Experiment" : "Hold",
  }));
}

function atOffset(startAt, minutes) {
  return new Date(new Date(startAt).getTime() + minutes * 60_000);
}

function formatLocalTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function createOvernightPlan(repos, startAt = new Date()) {
  const focus = allocateFocus(repos);
  const champion = focus[0]?.repo.slug ?? "the primary repo";
  const secondary = focus[1]?.repo.slug;
  const repoCount = repos.length;
  const steps = [
    {
      offset: 0,
      title: "Capture the baseline",
      detail: `Record stars and forks for ${repoCount} repo${repoCount === 1 ? "" : "s"}; confirm every claim and link you may share.`,
      owner: "You",
    },
    {
      offset: 15,
      title: "Fix the sharpest conversion gap",
      detail: `Start with ${champion}. Complete its highest-impact readiness action before expanding the campaign.`,
      owner: champion,
    },
    {
      offset: 60,
      title: "Human approval gate",
      detail: "Review the exact README edits, launch copy, destinations, community rules, and factual claims.",
      owner: "Required",
    },
    {
      offset: 75,
      title: "Ship the repository polish",
      detail: "Publish only reviewed repo changes. Keep each mutation reviewable and reversible.",
      owner: champion,
    },
    {
      offset: 120,
      title: "Run the five-minute test",
      detail: "Use a clean environment to verify the quickstart, demo, links, and expected result.",
      owner: "Proof",
    },
    {
      offset: 150,
      title: "Publish one useful launch story",
      detail: `Share the problem, build lesson, proof, and link${secondary ? `; keep ${secondary} to a distinct audience or supporting role` : ""}.`,
      owner: "Manual post",
    },
    {
      offset: 240,
      title: "Answer real responses",
      detail: "Respond personally to questions and friction. Turn repeated confusion into README improvements.",
      owner: "You",
    },
    {
      offset: 420,
      title: "Quiet monitoring window",
      detail: "Do not repost for vanity. Capture observations and draft follow-ups without auto-sending them.",
      owner: "Observe",
    },
    {
      offset: 720,
      title: "Write the morning report",
      detail: "Record deltas, useful conversations, setup failures, and the single best next experiment.",
      owner: "Learn",
    },
  ];

  return steps.map((step, index) => {
    const time = atOffset(startAt, step.offset);
    return {
      ...step,
      id: `step-${index + 1}`,
      index: index + 1,
      time: time.toISOString(),
      localTime: formatLocalTime(time),
    };
  });
}

function fallback(value, placeholder) {
  const clean = String(value ?? "").trim();
  return clean || `[${placeholder}]`;
}

export function generateLaunchCopy(repo) {
  const name = repo.name;
  const slug = repo.slug;
  const url = repo.url;
  const tagline = fallback(repo.tagline, "one-sentence useful outcome");
  const audience = fallback(repo.audience, "who this is for");
  const proof = fallback(repo.proof, "verified proof or demo result");
  const forkUseCase = fallback(repo.forkUseCase, "a concrete customization or experiment");

  return [
    {
      id: `${repo.id}:short`,
      channel: "Short post",
      title: "Outcome first",
      body: `I built ${name} for ${audience}: ${tagline}\n\n${proof}\n\nTry it and tell me where the setup gets confusing: ${url}`,
    },
    {
      id: `${repo.id}:builder`,
      channel: "Builder note",
      title: "Problem → lesson → proof",
      body: `I kept running into this problem: ${tagline}\n\nSo I built ${name} for ${audience}. The most useful thing I learned was [specific, reusable lesson].\n\nProof: ${proof}\n\nSource, quickstart, and limitations: ${url}`,
    },
    {
      id: `${repo.id}:community`,
      channel: "Community draft",
      title: "Ask for informed feedback",
      body: `Sharing ${slug} because it may help ${audience}. It ${tagline}\n\nWhat it does well: ${proof}\nWhat it does not do yet: [honest limitation]\n\nI would value feedback from people who have tried [relevant workflow]. ${url}`,
    },
    {
      id: `${repo.id}:fork`,
      channel: "Fork invitation",
      title: "Give the fork a job",
      body: `Want to use ${name} as a starting point for ${forkUseCase}? The README maps the customization path and contribution steps: ${url}\n\nA fork is useful here when you want to [specific variation]—not as a vanity metric.`,
    },
  ];
}

export function calculateMetricDelta(repo) {
  const baseline = normalizeMetrics(repo?.baseline);
  const current = normalizeMetrics(repo?.current);
  return {
    stars: current.stars - baseline.stars,
    forks: current.forks - baseline.forks,
  };
}

export function averageReadiness(repos) {
  if (!repos.length) return 0;
  return Math.round(repos.reduce((sum, repo) => sum + scoreRepo(repo).score, 0) / repos.length);
}
