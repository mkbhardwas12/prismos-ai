# Repo Launch Night

Repo Launch Night is a private, zero-dependency dashboard for planning an honest
GitHub launch across one or more repositories. It turns a vague goal such as
“get more stars and forks tonight” into work that can actually earn attention:

- score the repository surface with a transparent 100-point rubric;
- rank several repos and concentrate effort instead of diluting the launch;
- fix the highest-leverage README, quickstart, demo, trust, and contribution gaps;
- draft audience-specific launch copy without inventing claims;
- follow a 12-hour runbook with a required human approval checkpoint;
- record before/after stars and forks and export a Markdown morning report.

It does **not** create accounts, buy or exchange stars, auto-fork repos, send
messages, post comments, mutate GitHub, or promise growth.

## Run it

Requirements: Node.js 22.12 or newer (Node 24 LTS recommended). There are no
packages to install.

```bash
cd tools/repo-launch-night
npm start
```

Open [http://127.0.0.1:4179](http://127.0.0.1:4179), then add GitHub references
as `owner/repo`, full GitHub URLs, or SSH remotes. Multiple references can be
separated by commas or spaces.

The dashboard is deliberately manual:

1. Add the repos in scope.
2. Complete each readiness audit and factual profile.
3. Finish the primary repo's highest-impact actions first.
4. Review every draft and the target community's rules.
5. Follow the night plan. Nothing is sent automatically.
6. Enter the morning counts and qualitative observations.
7. Export the complete plan/report as Markdown.

Use **Load an example** to see a filled-in profile for the current PrismOS-AI
repository. Replace every sample claim before using it for another project.

## The score

Each dimension is rated from 0 (absent) to 5 (verified and effortless for a new
visitor). The weights total 100.

| Dimension | Weight | A strong repo makes this obvious |
|---|---:|---|
| Value clarity | 15 | Who it helps and the concrete outcome |
| Five-minute activation | 15 | The shortest tested path to a useful result |
| Demonstrability | 10 | A focused visual, demo, or reproducible example |
| Trust | 15 | License, CI, releases, security path, and limitations |
| Discoverability | 10 | Specific description, topics, homepage, and audience language |
| Forkability | 15 | Architecture, customization, contribution steps, and starter work |
| Freshness | 10 | Current instructions, releases, and responsive maintenance |
| Shareability | 10 | A useful story or artifact worth passing along |

- Below 55: build the repository surface before broad promotion.
- 55–74: polish the sharpest conversion gaps before launching.
- 75–100: campaign-ready, subject to factual and clean-install verification.

For a portfolio, the dashboard also considers forkability, shareability, and
the strategic-importance input. One repo receives all effort; two receive a
70/30 split; three or more receive 60/25/15, with the rest held back. This keeps
several similar projects from competing for the same audience on the same night.

## Privacy and guardrails

The server binds only to `127.0.0.1`. The page makes no network requests, has no
token field, and persists campaign state only in browser `localStorage`. Its
content-security policy blocks outbound connections. Resetting the dashboard
deletes that stored state for this local origin.

The exported report always includes these boundaries:

- no paid/fake engagement, sockpuppets, star exchanges, or engagement rings;
- no unsolicited bulk DMs, scraped outreach, issue spam, or automated comments;
- no fabricated proof, benchmarks, testimonials, adoption, or security claims;
- no vanity fork request—a fork must have a real customization or experiment;
- no external post without a human verifying its claims, fit, and community rules.

Stars and forks are lagging signals. Treat successful setup, useful feedback,
repeat visitors, and contributors as stronger evidence that the launch found the
right people. A before/after change is an observation, not proof of causation.

## Test it

```bash
cd tools/repo-launch-night
npm test
```

The tests cover repository parsing and deduplication, weighted scores, action
ranking, portfolio allocation, timeline generation, copy guardrails, metric
deltas, and the local server's route and method boundaries.

To use a different local port:

```bash
REPO_NIGHT_PORT=4180 npm start
```

## Structure

```text
tools/repo-launch-night/
├── lib/core.mjs       # pure scoring, planning, copy, and metric logic
├── public/            # dependency-free browser dashboard
├── test/              # Node test runner coverage
├── server.mjs         # loopback-only static server
└── package.json
```
