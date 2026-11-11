# UX review against the judging criteria (2026-11-11)

A pass over every screen as a first-time judge would see it, from the hosted URL or the demo video.
For each finding: what was wrong, what changed, and which criterion or prize it serves.

## What a judge needs in the first 30 seconds

1. What is this, and who is it for? A small PayPal merchant losing disputes they should win.
2. What is real and what is simulated?
3. Where do I click first?

Before this pass, `/` redirected straight into the War Room, so none of these were answered before
the dashboard appeared. A first-visit welcome card tried to explain everything from inside the product.

## Changes

| Finding | Change | Serves |
| --- | --- | --- |
| No front door: `/` dropped judges into a dense dashboard | Landing page at `/`: one-line pitch, how it works in 3 steps, what each of the 4 screens is for, live metrics from the eval and Arena, "What's real / What's simulated", one CTA to the demo | Presentation, Potential Impact, Best Demo Delivery |
| Welcome card in the War Room repeated the landing page and pushed the work below the fold | Removed; a "How Verdict works" link in the header goes back to the landing page | Design |
| Agent reasoning read like a debug log: "INQUIRY stage", "offer_refund and escalate_to_human", "buyerNotes and buyerClaim are empty" | Prompt v2 adds one rule: reasoning and risks are for the shop owner, so no tool names, field names, action codes, status codes or record ids. Eval re-run: 95% right action and 100% valid citations, unchanged from v1; 9.4 s and $0.031 per dispute. The replay recommendations were regenerated with v2 and reach the same decisions | Technological Implementation, Design, Best Use of PayPal + AI |
| Arena carried 7 SIMULATED badges, so the warning became noise | One badge in the page header plus a banner that explains how a run works and links the arbiter rules. Panels say "simulated" in plain text. The disclosure is unchanged; it is just stated once, clearly | Design, Presentation (honesty kept) |
| Money in AG Studio widgets had no currency symbol ("Saved 2,066.89") | Currency fields use the format string `$#,##0.00` | Design, AG Grid prize |
| "$ at risk" ($336.25) contradicted the header ("$299.50 at stake") | The tile now says "all open disputes, incl. waiting on buyer"; the header counts only disputes waiting on the merchant | Design |
| The dashboard scrolled inside the page (nested scrollbars) | The Studio canvas has a fixed height that fits every widget, so the page scrolls instead | Design, AG Grid prize |
| "Recently closed" rows looked like duplicates (two "Not received · $19.25") | Each row shows its order number | Design |
| Filler copy: "Not reviewed yet. Verdict can review it in about 10 seconds.", "flagged for your review" | Cut to "Not reviewed yet" and "Needs your judgment" | Design |
| "Dispute queue" grid sat under a "Needs your decision" list, so two lists competed | Renamed "All disputes", with a hint that ids open the Case File | Design |
| Next.js dev badge covered the sidebar footer in recordings | `devIndicators: false` | Presentation |

## Checked and left alone

- **Case File**: the guided layout (status, recommendation, evidence for and against, actions) already reads top to bottom; it now carries the plain-language reasoning.
- **Playbook**: plain-language rules already; no change.
- **SIMULATED disclosure**: still on the landing page, the Arena header and banner, every Arena widget subtitle, and the eval output. Nothing presents benchmark numbers as real-world results.
- **Accessibility**: axe WCAG 2 A/AA runs in e2e on the landing page and the 4 product pages.

## How the product maps to the criteria

- **Technological Implementation**: real PayPal sandbox Disputes, Orders and Tracking calls with signed webhooks; a Claude agent with read-only tools, Zod-validated decisions, guardrails, retries and an audit log; a Claude buyer agent; a measured eval (20 labelled scenarios).
- **Design**: one job per screen, plain language, light and dark themes, AG Studio themed to match.
- **Potential Impact**: small merchants lose disputes through missed deadlines and thin evidence; Verdict tracks both and drafts the response, and the human approves.
- **Innovation**: the Arena, a wind tunnel that tests the dispute strategy against adversarial simulated buyers before real ones arrive, plus a policy slider that projects the effect of an auto-refund threshold.
- **Presentation**: the landing page tells the story in under a minute; REPLAY mode makes the hosted demo safe to click through.
