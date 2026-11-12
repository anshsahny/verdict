# SUBMISSION.md — everything the Devpost entry needs

Hackathon: https://paypalaihackathon.devpost.com/ · Deadline **Thu Nov 12, 12:00 pm PST (3:00 pm Toronto)**. Target: submitted Wed night.

## Stage 1 (pass/fail). Every box must be ticked
- [ ] Working build. **PayPal** (sandbox is fine) and **AI** are both meaningfully used.
- [ ] **Public GitHub repo** with an **open-source LICENSE (MIT)**, visible in the repo's About section.
- [ ] **Functional demo**: hosted URL (preferred) AND run instructions in the README.
- [ ] **Public YouTube video, under 3:00**, showing the project working on its device. No third-party trademarks or copyrighted music. Names PayPal and AI.
- [ ] Text description, tools list ("Built With") completed.
- [ ] Sponsor tools ticked on the form: **AG Grid / AG Studio**, **Render**, APIMatic if actually used.
- [ ] Credentials / demo access kept **live until winners are announced (Dec 21)**: Render instance running, Anthropic credit remaining, AG Studio key valid through Dec 21 (judging is Dec 1–15), PayPal sandbox apps untouched.
- [ ] No API keys anywhere in the repo, video or screenshots.

## Stage 2 scoring: what each criterion needs (equal weights; ties break on Technological Implementation)
| Criterion | Where Verdict earns it |
|---|---|
| Technological Implementation | Real sandbox lifecycle (create, respond, settle), webhooks, tool-using Claude agent with Zod schemas + guardrails + audit log, eval harness numbers, tests, replay mode |
| Design | Themed AG Studio War Room, custom widgets, deadline clocks, evidence meter, clean Case File and Arena |
| Potential Impact | Small merchants lose disputes by missing deadlines or weak evidence. Concrete $ figures from the benchmark (labelled simulated) |
| Innovation | The Arena: stress-test your dispute strategy before real buyers do |
| Presentation | Tight 3-min video, clear README, live URL that just works |

## Prize angles (a project can win one main prize + one sponsor prize)
Best Use of PayPal + AI · Most Impactful · Best Demo Delivery · Best Use of Agentic Commerce · AG Grid prize (polish, custom widgets/theming, Studio Agent Framework use) · Render (hosting) · APIMatic (only claim it if you really use it).

## Video script
**Published:** https://youtu.be/02pvRKyrTjg (public).

The full script, shot list, prep, editing and upload steps are in [docs/video/script.md](docs/video/script.md), with title cards in [docs/video/cards](docs/video/cards). Upload as **Public** as early as possible: YouTube processing takes time.

## Devpost text (fill from the repo's README; keep the headings)
- **Inspiration**: the dispute problem for small merchants, with one real-feeling stat or story (don't invent statistics: cite a source or omit).
- **What it does**: War Room, Case File, Arena. Explicitly say "PayPal sandbox" and "Claude".
- **How we built it**: PayPal (Orders, Shipment Tracking, Disputes API, webhooks, Agent Toolkit/MCP where used), Claude (defender agent, buyer agent, Studio adapter), AG Studio/AG Grid (dashboard, custom widgets, Agent Framework), Next.js, TypeScript, SQLite, Render.
- **Challenges**: the sandbox dispute lifecycle constraints (INQUIRY vs CLAIM stages, evidence prerequisites), building honest evaluation with a simulated arbiter, keeping an agent safe with untrusted buyer text.
- **Accomplishments**: measured numbers from `npm run eval` and the Arena benchmark. Label them as simulated.
- **What we learned / What's next**: real PayPal reviewer feedback loop, multi-merchant, Venmo, appeals.
- **Built With** (tags): paypal, claude, anthropic, ag-grid, ag-studio, nextjs, typescript, sqlite, render, zod, vitest, playwright.
- **Try it out links**: hosted URL, GitHub repo, YouTube video.

## Final checks (Wed night)
- [ ] Open the public URL in a private window and on a phone. Click the whole demo path.
- [ ] Repo cloned fresh to a new folder runs from the README.
- [ ] GitHub About shows MIT licence; repo is public; README has the SIMULATED-arbiter disclosure.
- [ ] YouTube link plays logged-out, under 3:00, public (not unlisted/private).
- [ ] Devpost form: all fields complete, sponsor boxes ticked, video link works, repo link works. **Submit** (not just "save draft") and confirm the submission email.
- [ ] Render instance on a paid/always-on plan, AG Studio key expiry date noted, Anthropic credit balance OK through Dec 21.
- [ ] Then stop. No commits after submission unless a true emergency, and none at all after the deadline.
