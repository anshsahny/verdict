# CLAUDE.md — Verdict

## What we're building
**Verdict** is an AI dispute clerk for small PayPal merchants, plus an **Arena** ("wind tunnel") that stress-tests the clerk's defense strategy against a simulated buyer agent in the PayPal **sandbox**.

Entry for the **PayPal AI Hackathon** (Devpost). Solo builder: Ansh. Judges score 1–5 on: Technological Implementation, Design, Potential Impact, Innovation, Presentation. Judges may not run the project, so the demo video and a flawless hosted URL matter as much as the code.

**Hard deadline: Thu Nov 12, 12:00 pm PST = 3:00 pm Toronto.** Internal target: submitted Wed night. After the deadline there are no commits, README edits, or video swaps.

## Three surfaces
1. **War Room** (AG Studio dashboard): open disputes, deadline clocks, $ at risk, win rate, queue. Natural-language widget building via the Studio Agent Framework.
2. **Case File**: dispute timeline, evidence checklist + strength meter, agent recommendation with reasoning, Approve / Edit / Override.
3. **Arena**: buyer agent files simulated sandbox disputes, the defender responds, a rule-based arbiter scores the outcome, then a benchmark (win rate by dispute type, weak spots, $ saved) and a policy slider (e.g. auto-refund threshold → projected $ saved).

## Non-negotiables
- **Meaningful PayPal**: real sandbox REST calls (orders, tracking, disputes: list/get/make-offer/provide-evidence/accept, sandbox-only create/require-evidence/adjudicate) and webhooks. Use the PayPal Agent Toolkit/MCP where it genuinely fits (list_disputes, get_dispute, accept_dispute_claim); direct REST for the rest.
- **Meaningful AI**: Claude-powered defender agent with tools, structured (Zod-validated) decisions, guardrails, audit log; Claude-powered buyer agent; Claude adapter for the AG Studio Agent Framework.
- **Honesty**: the arbiter is a rule-based stand-in for PayPal's reviewers. Label it **SIMULATED** everywhere it appears (UI, README, video). Never present benchmark numbers as real-world results. Never fabricate evidence: every evidence item cites a DB record id.
- **Open source**: MIT LICENSE at repo root, visible in the GitHub About section. Public repo.
- **No secrets in git.** `.env.local` is git-ignored; ship `.env.example` only. Never log keys. Check `git diff --staged` for secrets before every commit.
- **No third-party trademarks or copyrighted music in the video**; no copied artwork. Refer to PayPal by name in text and narration (the rules require naming PayPal and AI in the description, Built With and video).
- **Always keep `main` demo-able.** Work on short-lived branches or commit small; never leave main broken overnight.

## Stack (decided; don't relitigate)
- Next.js (App Router) + TypeScript, started from the official boilerplate `github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate` (check its licence; keep ours MIT and keep any required attribution).
- AG Studio + AG Grid for the dashboard; Studio Agent Framework (`AgStudioAiModule`, registered via `AgStudioModuleRegistry.registerModules([AgStudioAiModule])`) for the chat assistant. It ships no LLM adapter: write a Claude adapter by adapting the repo's OpenAI adapter example.
- Anthropic SDK; model from `ANTHROPIC_MODEL` env (default `claude-sonnet-5-5`).
- Zod for all agent I/O and API payload validation.
- **SQLite (libsql or better-sqlite3) seeded on boot**, so the demo store is reproducible and there's no database expiry before Dec 21. Drizzle or plain SQL, whichever is faster.
- Vitest for unit tests, a small script-based integration suite for sandbox calls, Playwright for one end-to-end smoke test.
- Deploy: Render web service (use credits for a paid always-on instance so there's no cold start for judges).

## How to work
- Read `PLAN.md`. Work **one phase at a time**. At the end of each phase: run the acceptance tests, show the results, commit, then **stop at the gate** and wait for the human to say "continue". Don't start the next phase early.
- **Never guess an API shape.** Before coding against PayPal or AG Studio/AG Grid, read the current docs (fetch them) and record what you learned in `docs/api-notes.md` (endpoint, required fields, status/stage prerequisites, quirks). Docs have been wrong or incomplete in places; sandbox behaviour wins over docs. Record real responses (redacted) in `fixtures/`.
- **Every PayPal-calling feature gets a real sandbox test** plus a recorded-fixture test for CI.
- **Fallback ("replay mode")**: the hosted demo must never be hostage to sandbox flakiness. Build a replay mode that serves recorded sandbox responses, clearly flagged "REPLAY" in the UI footer, behind an env flag. Live mode is default locally; replay is the safety net for the public URL and the video retake.
- **Cost and abuse guard** on the public URL: Arena runs are rate-limited, token- and run-capped (env-configurable), with a precomputed sample benchmark available instantly.
- Log decisions and deviations in `DECISIONS.md` (one line each, with date/time).
- Keep scope tight. If a task slips past its time box by 50%, stop, report, and apply the cut order from PLAN.md rather than pushing on.
- Prefer boring, working code over clever code. Polish matters for the Design score, but a working demo path matters more.
- Commit messages have no Claude co-author or attribution line (Ansh's preference, 2026-11-10).

## Definition of done (global)
- `npm run build` passes; `npm test` passes; no console errors on the demo path.
- The demo path works from a clean checkout using only `.env.example` + the README steps.
- README has: what/why, architecture diagram, setup & run, env vars, how to run tests, sandbox notes, the SIMULATED-arbiter disclosure, PayPal + AI + AG Studio usage called out explicitly, licence.

## Commands (fill in as they're created)
- `npm run dev` — local dev
- `npm test` — unit tests
- `npm run sandbox:smoke` — Phase 0 smoke test
- `npm run seed` — seed the demo store (`-- --reset` to recreate the DB)
- `npm run sandbox:orders` — create labelled orders from the vaulted sandbox buyer
- `npm run demo:orders` — create the 2 video orders (VRD-1009, VRD-1010) and add their store records
- `npm run sandbox:capture` — save redacted full dispute fixtures to `fixtures/disputes/`
- `npm run ai:smoke` — Claude tool use + Zod smoke test
- `npm run e2e` — Playwright demo-path test (REPLAY production build, own DB; fails on console errors or serious a11y issues)
- `npm run replay:export` — rebuild fixtures/replay/seed.json from recorded sandbox data
- `npm run sandbox:lifecycle -- --dry-run` — Gate 1 live lifecycle plan (without `--dry-run` it acts on real sandbox disputes)
- `npm run eval` — defender evaluation harness (20 SIMULATED scenarios; `-- --only <id>`)
- `npm run agent -- <disputeId>` — agent recommendation; `-- --approve <decisionId>` / `-- --override <decisionId> <action> [usd]` executes
- `npm run arena -- --runs N [--seed S] [--export]` — run the arena headless (`--export` rewrites fixtures/arena/sample.json)
- `npm run arena:bound -- prepare|run|settle` — Arena runs bound to real sandbox disputes
- `npm run screens` — re-capture public/screens/war-room-{light,dark}.png from a running app (`-- <baseUrl>`)
