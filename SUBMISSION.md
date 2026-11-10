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

## Video script (target 2:45; record screen + voiceover; no music, or royalty-free music you own the rights to)
| Time | Show | Say |
|---|---|---|
| 0:00–0:15 | War Room, a red deadline clock | "Small merchants lose PayPal disputes they should win. They miss deadlines and send weak evidence. Verdict is an AI dispute clerk, built on PayPal and Claude." |
| 0:15–0:50 | Open a new sandbox dispute → Case File | "A buyer files an item-not-received dispute in the PayPal sandbox. Verdict's agent pulls the order, tracking and customer history, and builds a case." Show reasoning + evidence meter |
| 0:50–1:20 | Approve → evidence submitted → status change in PayPal | "I approve. Verdict submits the evidence through PayPal's dispute API." Show the live sandbox state |
| 1:20–1:50 | Guardrails | "Large refunds and low confidence go to a human. Every evidence item cites a real record. Buyer messages can't hijack the agent." Flash the injection test |
| 1:50–2:30 | Arena | "But how good is the clerk? The Arena unleashes simulated buyers, honest, mistaken and opportunistic. Results: win rate by type, the weak spots. A simulated arbiter stands in for PayPal's reviewers." Move the policy slider; $ saved changes |
| 2:30–2:50 | Dashboard chat | "Built with AG Grid Studio. Ask in plain English and it builds a widget." |
| 2:50–3:00 | Repo + URL card | "Open source, MIT. Verdict: win the disputes you should win." |

Recording rules: do 2–3 takes of each segment from `npm run demo:reset`; 1080p; hide notifications; zoom the browser to 125% for legibility; captions on key numbers; export under 3:00 (aim 2:50).
Upload **Wed evening** as Public, because YouTube processing takes time. Then paste the link into Devpost.

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
