# Decisions and deviations

One line each, newest last. Times are America/Toronto.

- 2026-11-10 00:00 — Scaffolded from `paypaldev/hackathon-paypal-ag-grid-boilerplate` @ `5de114e`. That repo has **no LICENSE file** (GitHub reports none). Kept its code with attribution in README; our own code is MIT. Open question for the human: confirm with PayPal (Discord) that participants may reuse it.
- 2026-11-10 00:00 — Env names follow our `.env.local`: `PAYPAL_CLIENT_SECRET` (boilerplate used `PAYPAL_SECRET`), `AG_STUDIO_LICENSE_KEY` (boilerplate used `AG_STUDIO`).
- 2026-11-10 00:05 — Orders: guest card payments (`payment_source.card`, test Visa) complete and capture on create, no buyer interaction. Used for seeded/live orders and tracking.
- 2026-11-10 00:05 — Dispute API create rejects guest card captures (`TRANSACTION_NOT_ELIGIBLE`). Next attempt: buyer-account (PayPal wallet) transaction, vaulted after one human approval, + `PayPal-Auth-Assertion` with the buyer's email. Fallback if that fails: disputes created by hand in the sandbox Resolution Center (PLAN Phase 0 "likely case").
- 2026-11-10 00:08 — Sandbox `process-chargeback` returns 500 on every variant tried. Parked (time box), not on the critical path.
- 2026-11-10 00:08 — No separate buyer sandbox app: the merchant token already has `disputes/create` + `read-buyer`, and buyer identity goes in `PayPal-Auth-Assertion`. Smoke step a2 is SKIP by design.
- 2026-11-10 00:12 — Webhooks: ngrok tunnel for local dev (`*.ngrok-free.dev`), sandbox webhook subscribed to `CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED`. The production URL gets its own sandbox webhook in Phase 6. Polling stays as the Phase 1 fallback.
- 2026-11-10 00:12 — Claude structured output via `betaZodOutputFormat` + `toolRunner` (Sonnet 5.5 rejects forced `tool_choice`), with a Zod `safeParse` on the final text as a second check.
- 2026-11-10 00:40 — Buyer vaulting works: after one human approval, wallet orders (`vault_id`) complete with no interaction and are seller-protection eligible. Live Arena orders can be real PayPal orders.
- 2026-11-10 00:42 — **Dispute create API ruled out** (time box): `TRANSACTION_NOT_ELIGIBLE` on card and wallet captures, and `No permissions to set target_client_id` with an auth assertion. Applying the PLAN Phase 0 "likely case": real disputes filed by hand in the sandbox Resolution Center on vaulted orders (`npm run sandbox:orders`); the live path (webhook → agent → evidence → settle) runs on those; the Arena's volume runs replay the filing step while the buyer agent still writes claims live. Labelled honestly in UI/README/video.
- 2026-11-10 00:14 — AG Studio key is a TRIAL that expires 2026-12-25, 4 days after winners are announced (Dec 21). Keep an eye on it; ask AG Grid for an extension if anything changes.
