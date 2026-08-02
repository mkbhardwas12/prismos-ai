import {
  DIMENSIONS,
  ETHICAL_GUARDRAILS,
  allocateFocus,
  averageReadiness,
  calculateMetricDelta,
  createOvernightPlan,
  createRepo,
  generateLaunchCopy,
  getPriorityActions,
  parseRepoReferences,
  scoreRepo,
} from "/lib/core.mjs";

const STORAGE_KEY = "repo-launch-night:v1";
const state = loadState();
let toastTimer;

const repoForm = document.getElementById("repo-form");
const repoInput = document.getElementById("repo-input");
const repoError = document.getElementById("repo-error");
const exampleButton = document.getElementById("example-button");
const resetButton = document.getElementById("reset-button");
const exportButton = document.getElementById("export-button");
const workspace = document.getElementById("workspace");
const workspaceContent = document.getElementById("workspace-content");
const emptyState = document.getElementById("empty-state");
const toast = document.getElementById("toast");
const tabs = document.querySelector(".tabs");
const brand = document.querySelector(".brand");

repoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addRepositories(repoInput.value);
});

exampleButton.addEventListener("click", () => {
  const example = createRepo("mkbhardwas12/prismos-ai", {
    tagline: "runs a local-first assistant with approved project knowledge and a bounded sequential answer workflow",
    audience: "people who want local model inference and explicit control over which project files are indexed",
    proof: "The README includes a one-line installer, a focused demo, tests, and an explicit security model.",
    forkUseCase: "adapting its approved project-knowledge and sequential workflow for a specialized use case",
    strategicImportance: 5,
    ratings: {
      valueClarity: 5,
      activation: 5,
      demonstrability: 5,
      trust: 5,
      discoverability: 4,
      forkability: 4,
      freshness: 4,
      shareability: 5,
    },
  });
  upsertRepo(example);
  state.activeRepoId = example.id;
  state.activeTab = "portfolio";
  persist();
  render();
  showToast("Example loaded. Replace its profile or add more repos.");
});

resetButton.addEventListener("click", () => {
  if (!state.repos.length) return;
  if (!window.confirm("Clear every repo, score, metric, and completed task from this launch room?")) return;
  state.repos = [];
  state.activeRepoId = null;
  state.activeTab = "portfolio";
  state.completedActions = {};
  state.completedSteps = {};
  state.notes = "";
  persist();
  render();
  repoInput.focus();
  showToast("Launch room reset.");
});

exportButton.addEventListener("click", exportPlan);

brand.addEventListener("click", (event) => {
  event.preventDefault();
  if (!state.repos.length) {
    repoInput.focus();
    return;
  }
  state.activeTab = "portfolio";
  persist();
  renderTabs();
  renderPortfolio();
});

tabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (!button) return;
  state.activeTab = button.dataset.tab;
  persist();
  renderTabs();
  renderActivePanel();
});

tabs.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const buttons = [...tabs.querySelectorAll("[data-tab]")];
  const index = buttons.indexOf(document.activeElement);
  if (index < 0) return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const next = buttons[(index + direction + buttons.length) % buttons.length];
  next.focus();
  next.click();
});

workspaceContent.addEventListener("click", async (event) => {
  const selection = event.target.closest("[data-select-repo]");
  if (selection) {
    state.activeRepoId = selection.dataset.selectRepo;
    if (selection.dataset.openTab) state.activeTab = selection.dataset.openTab;
    persist();
    render();
    return;
  }

  const actionToggle = event.target.closest("[data-action-toggle]");
  if (actionToggle) {
    state.completedActions[actionToggle.dataset.actionToggle] = actionToggle.checked;
    persist();
    actionToggle.closest(".action-item")?.classList.toggle("done", actionToggle.checked);
    return;
  }

  const stepToggle = event.target.closest("[data-step-toggle]");
  if (stepToggle) {
    state.completedSteps[stepToggle.dataset.stepToggle] = stepToggle.checked;
    persist();
    return;
  }

  const copyButton = event.target.closest("[data-copy-text]");
  if (copyButton) {
    await copyText(copyButton.dataset.copyText);
    showToast("Draft copied. Verify every claim before posting.");
    return;
  }

  const removeButton = event.target.closest("[data-remove-repo]");
  if (removeButton) {
    const repo = findRepo(removeButton.dataset.removeRepo);
    if (!repo || !window.confirm(`Remove ${repo.slug} from this launch room?`)) return;
    state.repos = state.repos.filter((item) => item.id !== repo.id);
    state.activeRepoId = state.repos[0]?.id ?? null;
    persist();
    render();
    showToast(`${repo.slug} removed.`);
    return;
  }

  if (event.target.closest("[data-export-plan]")) exportPlan();
});

workspaceContent.addEventListener("input", (event) => {
  const target = event.target;
  const repoId = target.dataset.repoId;
  const repo = findRepo(repoId);

  if (repo && target.dataset.repoField) {
    const field = target.dataset.repoField;
    repo[field] = field === "strategicImportance" ? Number(target.value) : target.value;
    if (field === "strategicImportance") {
      const label = target.closest(".field")?.querySelector("label");
      if (label) label.textContent = `Strategic importance · ${target.value}/5`;
    }
    persist();
    return;
  }

  if (repo && target.dataset.rating) {
    repo.ratings[target.dataset.rating] = Number(target.value);
    const value = target.closest(".dimension-card")?.querySelector(".dimension-value");
    if (value) value.textContent = `${target.value}/5`;
    updateAuditScore(repo);
    persist();
    return;
  }

  if (repo && target.dataset.metricGroup && target.dataset.metricKey) {
    repo[target.dataset.metricGroup][target.dataset.metricKey] = Math.max(0, Number(target.value) || 0);
    updateMetricDelta(repo);
    persist();
    return;
  }

  if (target.id === "campaign-start") {
    const parsed = new Date(target.value);
    if (!Number.isNaN(parsed.getTime())) {
      state.startAt = parsed.toISOString();
      persist();
    }
    return;
  }

  if (target.id === "campaign-notes") {
    state.notes = target.value;
    persist();
  }
});

workspaceContent.addEventListener("change", (event) => {
  const target = event.target;
  if (target.matches("[data-rating]")) {
    renderActivePanel();
    return;
  }

  if (target.matches('[data-repo-field="strategicImportance"]')) {
    renderActivePanel();
    return;
  }

  if (target.id === "copy-repo-select") {
    state.activeRepoId = target.value;
    persist();
    renderCopy();
    return;
  }

  if (target.id === "campaign-start") renderPlan();
});

function defaultState() {
  const now = new Date();
  const start = new Date(now);
  if (now.getHours() >= 6 && now.getHours() < 18) {
    start.setHours(18, 0, 0, 0);
  } else {
    start.setSeconds(0, 0);
    start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15);
  }
  return {
    repos: [],
    activeRepoId: null,
    activeTab: "portfolio",
    startAt: start.toISOString(),
    completedActions: {},
    completedSteps: {},
    notes: "",
  };
}

function loadState() {
  const fallback = defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw);
    const repos = Array.isArray(saved.repos)
      ? saved.repos.map((repo) => createRepo(repo.slug, repo))
      : [];
    return {
      ...fallback,
      ...saved,
      repos,
      activeRepoId: repos.some((repo) => repo.id === saved.activeRepoId)
        ? saved.activeRepoId
        : repos[0]?.id ?? null,
      completedActions: saved.completedActions && typeof saved.completedActions === "object"
        ? saved.completedActions
        : {},
      completedSteps: saved.completedSteps && typeof saved.completedSteps === "object"
        ? saved.completedSteps
        : {},
    };
  } catch {
    return fallback;
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function addRepositories(input) {
  const parsed = parseRepoReferences(input);
  if (!parsed.repositories.length) {
    repoError.textContent = parsed.invalid[0]?.message ?? "Add at least one owner/repository reference.";
    repoInput.focus();
    return;
  }

  const added = [];
  for (const reference of parsed.repositories) {
    if (state.repos.some((repo) => repo.id === reference.id)) continue;
    const repo = createRepo(reference.slug);
    state.repos.push(repo);
    added.push(repo);
  }

  if (added.length) state.activeRepoId = added[0].id;
  repoError.textContent = parsed.invalid.length
    ? `${parsed.invalid.length} invalid reference${parsed.invalid.length === 1 ? " was" : "s were"} skipped.`
    : added.length
      ? ""
      : "Those repositories are already in the launch room.";
  repoInput.value = "";
  persist();
  render();
  if (added.length) showToast(`${added.length} repo${added.length === 1 ? "" : "s"} added. Start with the readiness audit.`);
}

function upsertRepo(repo) {
  const index = state.repos.findIndex((item) => item.id === repo.id);
  if (index >= 0) state.repos[index] = repo;
  else state.repos.push(repo);
}

function findRepo(id) {
  return state.repos.find((repo) => repo.id === id);
}

function activeRepo() {
  return findRepo(state.activeRepoId) ?? state.repos[0] ?? null;
}

function render() {
  const hasRepos = state.repos.length > 0;
  workspace.classList.toggle("empty", !hasRepos);
  emptyState.hidden = hasRepos;
  workspaceContent.hidden = !hasRepos;
  exportButton.disabled = !hasRepos;
  resetButton.disabled = !hasRepos;
  if (!hasRepos) return;
  if (!activeRepo()) state.activeRepoId = state.repos[0].id;
  renderTabs();
  renderActivePanel();
}

function renderTabs() {
  document.querySelectorAll("[data-tab]").forEach((tab) => {
    const active = tab.dataset.tab === state.activeTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("[data-panel]").forEach((panel) => {
    const active = panel.dataset.panel === state.activeTab;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function renderActivePanel() {
  const renderers = {
    portfolio: renderPortfolio,
    audit: renderAudit,
    plan: renderPlan,
    copy: renderCopy,
    morning: renderMorning,
  };
  (renderers[state.activeTab] ?? renderPortfolio)();
}

function renderPortfolio() {
  const panel = document.getElementById("tab-portfolio");
  const focus = allocateFocus(state.repos);
  const champion = focus[0];
  const score = champion.readiness;
  const actions = getPriorityActions(champion.repo);
  const openActions = focus
    .slice(0, 3)
    .flatMap(({ repo }) => getPriorityActions(repo))
    .filter((action) => !state.completedActions[action.id]).length;
  const readyCount = focus.filter((entry) => entry.readiness.score >= 75).length;

  panel.innerHTML = `
    <div class="overview-grid">
      ${statCard("Portfolio readiness", `${averageReadiness(state.repos)}/100`, "Weighted average across every repo")}
      ${statCard("Campaign-ready", `${readyCount}/${state.repos.length}`, "75+ earns broad-promotion readiness")}
      ${statCard("Open leverage", String(openActions), "Priority fixes across the active lanes")}
    </div>
    <div class="portfolio-layout">
      <section class="panel" aria-labelledby="portfolio-heading">
        <div class="section-head">
          <div>
            <h2 id="portfolio-heading">Portfolio order</h2>
            <p>Readiness, forkability, shareability, and importance.</p>
          </div>
        </div>
        <div class="repo-list">
          ${focus.map((entry) => repoCard(entry, entry.repo.id === state.activeRepoId)).join("")}
        </div>
      </section>

      <section class="panel focus-card" aria-labelledby="focus-heading">
        <div class="focus-top">
          <div>
            <p class="focus-label">Primary focus · ${champion.allocation}% of the night</p>
            <h2 id="focus-heading">${escapeHtml(champion.repo.slug)}</h2>
            <p class="focus-summary">${escapeHtml(repoSummary(champion.repo, score))}</p>
          </div>
          ${scoreOrb(score.score, score.status)}
        </div>

        <div class="allocation">
          <div class="allocation-header">
            <strong>Attention allocation</strong>
            <span>Cap heavy promotion at two overlapping audiences.</span>
          </div>
          <div class="allocation-bar" aria-label="Campaign effort allocation">
            ${focus.map((entry) => `<span class="allocation-segment" style="width:${entry.allocation}%" title="${escapeHtml(entry.repo.slug)}: ${entry.allocation}%"></span>`).join("")}
          </div>
          <div class="allocation-key">
            ${focus.map((entry) => `<span><i></i>${escapeHtml(entry.repo.name)} · ${entry.allocation}% ${entry.lane === "Hold" ? "hold" : entry.lane.toLowerCase()}</span>`).join("")}
          </div>
        </div>

        <div class="top-actions">
          <div class="section-head">
            <div>
              <h3>Highest-leverage fixes</h3>
              <p>Complete these before asking anyone to look.</p>
            </div>
            <button class="button button-quiet button-small" data-select-repo="${escapeAttr(champion.repo.id)}" data-open-tab="audit" type="button">Edit audit</button>
          </div>
          ${actions.length ? actions.map(actionRow).join("") : `<div class="guardrail">Every dimension is at 5/5. Verify the claims, links, and clean-environment quickstart before launch.</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderAudit() {
  const panel = document.getElementById("tab-audit");
  const repo = activeRepo();
  const score = scoreRepo(repo);
  panel.innerHTML = `
    <div class="audit-layout">
      <aside class="panel">
        <div class="section-head">
          <div>
            <h2>Repository profile</h2>
            <p>Facts used to create honest drafts.</p>
          </div>
        </div>
        <div class="repo-picker" aria-label="Choose repository">
          ${state.repos.map((item) => `
            <button class="${item.id === repo.id ? "active" : ""}" data-select-repo="${escapeAttr(item.id)}" type="button">
              ${escapeHtml(item.slug)}
            </button>
          `).join("")}
        </div>
        <div class="field-grid">
          ${textField(repo, "tagline", "Useful outcome", "What does it help someone accomplish?", "runs a local security scan before an AI agent connects")}
          ${textField(repo, "audience", "Specific audience", "Name the people with this problem.", "maintainers shipping MCP integrations")}
          ${textField(repo, "proof", "Verified proof", "Use a demo, reproducible result, or honest signal.", "A 30-second demo shows the full setup-to-result flow")}
          ${textField(repo, "forkUseCase", "Reason to fork", "Offer a useful customization—not a vanity request.", "adapting the starter policy for an internal tool")}
          <div class="field">
            <label for="importance-${escapeAttr(repo.id)}">Strategic importance · ${repo.strategicImportance}/5</label>
            <input id="importance-${escapeAttr(repo.id)}" type="range" min="0" max="5" step="1" value="${repo.strategicImportance}" data-repo-id="${escapeAttr(repo.id)}" data-repo-field="strategicImportance" />
            <small>Break readiness ties; it never compensates for a weak repository surface.</small>
          </div>
        </div>
        <button class="button button-quiet danger-text remove-repo" data-remove-repo="${escapeAttr(repo.id)}" type="button">Remove repository</button>
      </aside>

      <section class="panel" aria-labelledby="audit-heading">
        <div class="section-head">
          <div>
            <h2 id="audit-heading">Readiness audit</h2>
            <p>0 means absent; 5 means verified and effortless for a new visitor.</p>
          </div>
          <div id="audit-score" aria-live="polite">${scoreOrb(score.score, score.status)}</div>
        </div>
        <div class="dimension-list">
          ${score.breakdown.map((dimension) => dimensionRow(repo, dimension)).join("")}
        </div>
      </section>
    </div>
  `;
}

function renderPlan() {
  const panel = document.getElementById("tab-plan");
  const plan = createOvernightPlan(state.repos, state.startAt);
  panel.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Overnight runbook</h2>
        <p>A 12-hour launch window with a mandatory human approval checkpoint.</p>
      </div>
      <div class="field" style="min-width:230px">
        <label for="campaign-start">Start time</label>
        <input id="campaign-start" type="datetime-local" value="${toLocalInputValue(state.startAt)}" />
      </div>
    </div>
    <div class="guardrail">
      This plan drafts and tracks work only. Nothing is posted, messaged, starred, forked, or changed automatically.
      Stop if a claim is unverified or a community’s rules do not clearly allow the post.
    </div>
    <div class="timeline">
      ${plan.map((step) => `
        <article class="timeline-card">
          <span class="timeline-index">${step.index}</span>
          <time class="timeline-time" datetime="${escapeAttr(step.time)}">${escapeHtml(step.localTime)}</time>
          <div class="timeline-copy">
            <strong>${escapeHtml(step.title)}</strong>
            <p>${escapeHtml(step.detail)}</p>
            <label class="check-row" style="margin-top:9px">
              <input type="checkbox" data-step-toggle="${escapeAttr(step.id)}" ${state.completedSteps[step.id] ? "checked" : ""} />
              Mark complete
            </label>
          </div>
          <span class="timeline-owner">${escapeHtml(step.owner)}</span>
        </article>
      `).join("")}
    </div>
  `;
}

function renderCopy() {
  const panel = document.getElementById("tab-copy");
  const repo = activeRepo();
  const copy = generateLaunchCopy(repo);
  panel.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Copy deck</h2>
        <p>Useful, audience-specific drafts with visible placeholders for anything unverified.</p>
      </div>
      <div class="field" style="min-width:250px">
        <label for="copy-repo-select">Repository</label>
        <select id="copy-repo-select">
          ${state.repos.map((item) => `<option value="${escapeAttr(item.id)}" ${item.id === repo.id ? "selected" : ""}>${escapeHtml(item.slug)}</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="guardrail">
      Brackets mark unfinished claims. Never post a draft with placeholders, invented proof, or an audience you have not verified.
    </div>
    <div class="copy-grid">
      ${copy.map((draft) => `
        <article class="copy-card">
          <div class="copy-head">
            <div>
              <span class="channel-chip">${escapeHtml(draft.channel)}</span>
              <h3 style="margin-top:8px">${escapeHtml(draft.title)}</h3>
            </div>
          </div>
          <div class="copy-body">${escapeHtml(draft.body)}</div>
          <footer>
            <button class="button button-quiet button-small" data-copy-text="${escapeAttr(draft.body)}" type="button">Copy draft</button>
          </footer>
        </article>
      `).join("")}
    </div>
  `;
}

function renderMorning() {
  const panel = document.getElementById("tab-morning");
  const totalDelta = state.repos.reduce((total, repo) => {
    const delta = calculateMetricDelta(repo);
    total.stars += delta.stars;
    total.forks += delta.forks;
    return total;
  }, { stars: 0, forks: 0 });
  panel.innerHTML = `
    <div class="section-head">
      <div>
        <h2>Morning report</h2>
        <p>Record what changed, what broke, and what you learned. Deltas do not prove attribution.</p>
      </div>
      <div class="inline-actions">
        <span class="status-pill">Σ stars ${formatDelta(totalDelta.stars)}</span>
        <span class="status-pill">Σ forks ${formatDelta(totalDelta.forks)}</span>
        <button class="button button-primary button-small" data-export-plan type="button">Export report</button>
      </div>
    </div>
    <div class="morning-grid">
      ${state.repos.map(metricCard).join("")}
    </div>
    <section class="panel notes-panel">
      <div class="section-head">
        <div>
          <h3>What actually happened?</h3>
          <p>Capture qualified conversations, setup friction, useful criticism, and the next experiment.</p>
        </div>
      </div>
      <textarea id="campaign-notes" placeholder="Example: Three people reached the demo; two stumbled on step 2, so the next move is to simplify that command.">${escapeHtml(state.notes)}</textarea>
    </section>
  `;
}

function statCard(label, value, note) {
  return `<article class="stat-card"><span class="stat-label">${escapeHtml(label)}</span><strong class="stat-value">${escapeHtml(value)}</strong><span class="stat-note">${escapeHtml(note)}</span></article>`;
}

function repoCard(entry, selected) {
  const { repo, rank, allocation, lane, readiness } = entry;
  return `
    <button class="repo-card ${selected ? "selected" : ""}" data-select-repo="${escapeAttr(repo.id)}" type="button">
      <span class="repo-ident">
        <span class="repo-name">${escapeHtml(repo.slug)}</span>
        <span class="repo-rank">${rank}</span>
      </span>
      <span class="repo-score-line">
        <span class="progress-track"><span class="progress-fill" style="display:block;width:${readiness.score}%"></span></span>
        <span>${readiness.score}</span>
      </span>
      <span class="repo-score-line"><span>${escapeHtml(readiness.status)}</span><span>${allocation}% · ${lane}</span></span>
    </button>
  `;
}

function actionRow(action) {
  const done = Boolean(state.completedActions[action.id]);
  return `
    <label class="action-item ${done ? "done" : ""}">
      <input type="checkbox" data-action-toggle="${escapeAttr(action.id)}" ${done ? "checked" : ""} />
      <span>
        <strong>${escapeHtml(action.title)}</strong>
        <p>${escapeHtml(action.detail)}</p>
      </span>
      <span class="impact">${escapeHtml(action.impact)}</span>
    </label>
  `;
}

function textField(repo, key, label, hint, placeholder) {
  return `
    <div class="field">
      <label for="${key}-${escapeAttr(repo.id)}">${escapeHtml(label)}</label>
      <textarea id="${key}-${escapeAttr(repo.id)}" data-repo-id="${escapeAttr(repo.id)}" data-repo-field="${escapeAttr(key)}" placeholder="${escapeAttr(placeholder)}">${escapeHtml(repo[key])}</textarea>
      <small>${escapeHtml(hint)}</small>
    </div>
  `;
}

function dimensionRow(repo, dimension) {
  return `
    <div class="dimension-card">
      <div>
        <strong>${escapeHtml(dimension.label)} · ${dimension.weight} points</strong>
        <p>${escapeHtml(dimension.guidance)}</p>
      </div>
      <input
        aria-label="${escapeAttr(dimension.label)} rating"
        type="range"
        min="0"
        max="5"
        step="1"
        value="${dimension.rating}"
        data-repo-id="${escapeAttr(repo.id)}"
        data-rating="${escapeAttr(dimension.key)}"
      />
      <span class="dimension-value">${dimension.rating}/5</span>
    </div>
  `;
}

function metricCard(repo) {
  const delta = calculateMetricDelta(repo);
  return `
    <article class="metric-card" data-metric-card="${escapeAttr(repo.id)}">
      <h3>${escapeHtml(repo.slug)}</h3>
      <div class="metric-inputs">
        ${metricInput(repo, "baseline", "stars", "Baseline stars")}
        ${metricInput(repo, "current", "stars", "Morning stars")}
        ${metricInput(repo, "baseline", "forks", "Baseline forks")}
        ${metricInput(repo, "current", "forks", "Morning forks")}
      </div>
      <div class="morning-delta">
        <span class="stat-label">Observed delta</span>
        <div class="delta-pair">
          <span>Stars<strong data-delta-stars>${formatDelta(delta.stars)}</strong></span>
          <span>Forks<strong data-delta-forks>${formatDelta(delta.forks)}</strong></span>
        </div>
      </div>
    </article>
  `;
}

function metricInput(repo, group, key, label) {
  return `
    <div class="metric-input">
      <label for="${group}-${key}-${escapeAttr(repo.id)}">${escapeHtml(label)}</label>
      <input id="${group}-${key}-${escapeAttr(repo.id)}" type="number" min="0" step="1" inputmode="numeric" value="${repo[group][key]}" data-repo-id="${escapeAttr(repo.id)}" data-metric-group="${group}" data-metric-key="${key}" />
    </div>
  `;
}

function scoreOrb(score, status) {
  return `<div class="score-orb" style="--score:${score}" title="${escapeAttr(status)}"><span>${score}</span><small>of 100</small></div>`;
}

function repoSummary(repo, scored) {
  if (repo.tagline && repo.audience) return `${repo.tagline} for ${repo.audience}. ${scored.status}.`;
  return `${scored.status}. Complete the profile and audit before using any launch draft.`;
}

function updateAuditScore(repo) {
  const host = document.getElementById("audit-score");
  if (!host) return;
  const scored = scoreRepo(repo);
  host.innerHTML = scoreOrb(scored.score, scored.status);
}

function updateMetricDelta(repo) {
  const card = document.querySelector(`[data-metric-card="${CSS.escape(repo.id)}"]`);
  if (!card) return;
  const delta = calculateMetricDelta(repo);
  card.querySelector("[data-delta-stars]").textContent = formatDelta(delta.stars);
  card.querySelector("[data-delta-forks]").textContent = formatDelta(delta.forks);
}

function formatDelta(value) {
  return value > 0 ? `+${value}` : String(value);
}

function toLocalInputValue(value) {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function buildMarkdown() {
  const focus = allocateFocus(state.repos);
  const plan = createOvernightPlan(state.repos, state.startAt);
  const lines = [
    "# Repo Launch Night",
    "",
    `Generated: ${new Date().toLocaleString()}`,
    "",
    "> This is an organic launch plan. It does not automate engagement, guarantee growth, or prove that a campaign caused any observed change.",
    "",
    "## Portfolio focus",
    "",
    ...focus.map((entry) => `- ${entry.rank}. [${entry.repo.slug}](${entry.repo.url}) — readiness ${entry.readiness.score}/100; ${entry.allocation}% ${entry.lane.toLowerCase()} lane`),
    "",
    "## Readiness actions",
    "",
  ];

  for (const entry of focus) {
    lines.push(`### ${entry.repo.slug}`, "");
    const actions = getPriorityActions(entry.repo);
    if (!actions.length) lines.push("- [ ] Re-verify claims, links, quickstart, and limitations.");
    for (const action of actions) {
      lines.push(`- [${state.completedActions[action.id] ? "x" : " "}] ${action.title} (${action.impact}) — ${action.detail}`);
    }
    lines.push("");
  }

  lines.push("## Overnight runbook", "");
  for (const step of plan) {
    lines.push(`- [${state.completedSteps[step.id] ? "x" : " "}] **${step.localTime} — ${step.title}.** ${step.detail}`);
  }

  lines.push("", "## Copy deck", "");
  for (const entry of focus.filter((item) => item.allocation > 0)) {
    lines.push(`### ${entry.repo.slug}`, "");
    for (const draft of generateLaunchCopy(entry.repo)) {
      lines.push(`#### ${draft.channel}: ${draft.title}`, "", draft.body, "");
    }
  }

  lines.push("## Morning observations", "");
  for (const entry of focus) {
    const delta = calculateMetricDelta(entry.repo);
    lines.push(`- ${entry.repo.slug}: stars ${formatDelta(delta.stars)}, forks ${formatDelta(delta.forks)} (observed, not attributed)`);
  }
  lines.push("", state.notes || "No qualitative observations recorded yet.", "", "## Guardrails", "");
  lines.push(...ETHICAL_GUARDRAILS.map((guardrail) => `- ${guardrail}`), "");
  return lines.join("\n");
}

function exportPlan() {
  if (!state.repos.length) return;
  const blob = new Blob([buildMarkdown()], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `repo-launch-night-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  showToast("Launch plan exported as Markdown.");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const helper = document.createElement("textarea");
  helper.value = text;
  helper.style.position = "absolute";
  helper.style.left = "-9999px";
  document.body.append(helper);
  helper.select();
  document.execCommand("copy");
  helper.remove();
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("\n", "&#10;").replaceAll("\r", "&#13;");
}

render();
