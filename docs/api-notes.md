# API notes

What we learned about each external API, from the docs and from the sandbox. **Sandbox behaviour wins over docs.**
Legend: **[S]** observed in our sandbox · **[D]** from docs only, not yet verified · **[?]** unknown / open question.
Redacted real responses live in `fixtures/smoke/` and `fixtures/webhooks/`.

Base URL (sandbox): `https://api-m.sandbox.paypal.com`

---

## PayPal: OAuth

- `POST /v1/oauth2/token`, Basic auth `client_id:secret`, body `grant_type=client_credentials`. Returns `access_token`, `expires_in`, `scope`. [S]
- Our merchant app's token already includes the scopes we need [S]: `disputes/read-seller`, `disputes/update-seller`, `disputes/read-buyer`, **`disputes/create`**, `documents/disputes/download`, `shipping/trackers/readwrite`, `applications/webhooks`, `payments/refund`.
- No separate buyer app is needed (see "Create dispute"): buyer-side actions use `PayPal-Auth-Assertion`. [D]

## PayPal: Orders v2

**Create:** `POST /v2/checkout/orders`. Add `Prefer: return=representation` for the full body.
- **Guest card, no buyer interaction** [S]: `intent: CAPTURE` + `payment_source.card` (`number`, `expiry` `YYYY-MM`, `security_code`, `name`, `billing_address`) with test Visa `4111111111111111` returns **201 `status: COMPLETED`**, already captured. Capture id at `purchase_units[0].payments.captures[0].id`. `seller_protection.status` is `NOT_ELIGIBLE`. Fixture: `orders-create-card.json`.
- **PayPal wallet with vaulting** [S]: `payment_source.paypal.attributes.vault = { store_in_vault: ON_SUCCESS, usage_type: MERCHANT, customer_type: CONSUMER }` + `experience_context` (`return_url`, `cancel_url`, `user_action: PAY_NOW`, `shipping_preference: NO_SHIPPING`) returns **200 `PAYER_ACTION_REQUIRED`** with a `payer-action` link (`https://www.sandbox.paypal.com/checkoutnow?token=...`). The buyer must approve once in a browser. Fixture: `orders-create-vault-approval.json`.
- After approval: `POST /v2/checkout/orders/{id}/capture` returns **201 `COMPLETED`** with `payment_source.paypal.attributes.vault = { id, status: VAULTED }` and `account_status: VERIFIED` [S]. The capture's `seller_protection` is `ELIGIBLE` for `ITEM_NOT_RECEIVED`, `UNAUTHORIZED_TRANSACTION` (card captures were `NOT_ELIGIBLE`). Fixture: `orders-capture-vault-approval.json`.
- **Vaulted orders need no interaction** [S]: `payment_source.paypal.vault_id` + `intent: CAPTURE` returns **201 `COMPLETED`**, already captured. `npm run sandbox:orders` uses this to create labelled orders (`fixtures/sandbox-orders.json`).
- Quirk: an approval link stays usable after a newer order is created. The capture must target the order the buyer actually approved (`GET /v2/checkout/orders/{id}` → `APPROVED`).

**Track:** `POST /v2/checkout/orders/{id}/track` [S]
- Body: `capture_id` (required), `tracking_number` (required, 1–64), `carrier` (required enum; `USPS` accepted; `OTHER` + `carrier_name_other` for unlisted), `notify_payer` (default false), `items[]` optional.
- Returns **201** with the order; tracker at `purchase_units[0].shipping.trackers[]` with id `{captureId}-{trackingNumber}` and `status: SHIPPED`. There is **no status field** in the request; delivery status can't be set here. Fixture: `orders-track.json`.
- `POST /v1/shipping/trackers-batch` is deprecated in favour of the above. [D]

## PayPal: Disputes v1

**List:** `GET /v1/customer/disputes`. Params `page_size` (1–50), `page`, `dispute_state`, `create_time_after` (`start_time` deprecated). Items: `dispute_id, create_time, update_time, reason, status, dispute_amount, dispute_life_cycle_stage, dispute_channel, seller_response_due_date, links`. [D] Empty list → `{ items: [], links }` [S]. Fixture: `disputes-list.json`.

**Get:** `GET /v1/customer/disputes/{id}` [S, fixtures `fixtures/disputes/<id>.json`, refreshed by `npm run sandbox:capture`]. Real Resolution Center dispute, merchant view:
- `disputed_transactions[0]`: `buyer_transaction_id` **and** `seller_transaction_id` (= our capture id, which is how we join to orders), `transaction_status: HELD`, `gross_amount`, `invoice_number` (our `invoice_id`), `items[]` (`item_name`, `reason`, `item_type`), `seller_protection_eligible`, `seller_protection_type: EXPANDED_SELLER_PROTECTION`, `buyer {email, payer_id, name}`.
- `dispute_state: REQUIRED_ACTION`, `dispute_channel: INTERNAL`, `fund_movements[]` (a `HOLD_PLACED` debit on us), `offer.buyer_requested_amount`, `refund_details.allowed_refund_amount`, `extensions.buyer_contacted_time`.
- **`evidences[]` says what PayPal wants**: `{ evidence_type: PROOF_OF_FULFILLMENT, source: REQUESTED_FROM_SELLER }` alongside the buyer's `{ evidence_type: CREATE, source: SUBMITTED_BY_BUYER }`. Use this to drive the evidence checklist.
- `allowed_response_options`: INR inquiry → `accept_claim_types [PARTIAL_REFUND, REFUND]`, `offer_types [REFUND]`; SNAD inquiry → `offer_types [REFUND, REFUND_WITH_RETURN]`.
- **HATEOAS rels use underscores** [S]: `accept_claim, provide_evidence, send_message, escalate, make_offer, provide_supporting_info`. Not hyphens.
- `seller_response_due_date` = create + 20 days for INQUIRY; absent once `UNDER_REVIEW`.

**Resolution Center behaviour** [S] (8 vaulted orders disputed by the human, 2026-11-10):
- All 8 show up for the merchant: 4 INR, 3 SNAD, 1 `UNAUTHORISED` (British spelling in the enum). Inquiries arrive as INQUIRY `UNDER_REVIEW`, then move to `WAITING_FOR_SELLER_RESPONSE` within ~3 minutes (with a `CUSTOMER.DISPUTE.UPDATED` webhook). Two INR came in straight as **CHARGEBACK / UNDER_REVIEW** (buyer chose to file a claim). The Unauthorized one arrived as **CHARGEBACK / WAITING_FOR_SELLER_RESPONSE**.
- After the disputes were filed, **the buyer's vault token was revoked**: vaulted orders and `GET /v3/vault/payment-tokens/{id}` both return 403. Most likely cause: the Unauthorized report (PayPal treats it as a compromised account). If the vault dies, rerun `npm run sandbox:smoke -- --approve`.
- Which links appear depends on the dispute: the SNAD inquiry offered no `provide_evidence` link; the INR inquiries did.

**Create (sandbox only):** `POST /v1/customer/disputes`, `multipart/form-data`, part `input` (`application/json`):
`{ disputed_transactions: [{ buyer_transaction_id }], reason, dispute_amount: { currency_code, value }, extensions: {...} }`. Returns 201 + link holding the dispute id. [D]
- Docs say: call it **as the buyer**, with header `PayPal-Auth-Assertion` = unsigned JWT `{"alg":"none","typ":"JWT"}` . `{"iss": CLIENT_ID, "email": BUYER_EMAIL}` . (empty signature), on a transaction the **sandbox personal account** made; `buyer_transaction_id` = the Transaction ID on the buyer's Summary page. Buyer consent via Log in with PayPal, scope `disputes/create`. [D]
- **Guest card captures are rejected** [S]: 400 `INVALID_REQUEST`, `details[].issue = TRANSACTION_NOT_ELIGIBLE`, with or without an assertion, using the capture id or the order id. Fixture: `disputes-create-card.json`. The docs never mention this error.
- **Wallet captures are rejected too** [S]: merchant token, no assertion, on a vaulted buyer-account capture → 400 `TRANSACTION_NOT_ELIGIBLE`.
- **With `PayPal-Auth-Assertion` (`iss` = our client id, `email` = the sandbox buyer)** [S] → 400 `{ error: "invalid_request", error_description: "No permissions to set target_client_id" }`. Our app has no third-party permission to act as the buyer. Per the docs, that needs the buyer's consent via Log in with PayPal plus scopes a PayPal account manager enables. Fixture: `disputes-create-wallet-assertion.json`.
- **Conclusion for Verdict:** API dispute creation isn't available to us. Real disputes are opened by hand in the sandbox Resolution Center on vaulted wallet orders; the Arena replays the "file" step.
- A buyer can't open a second dispute on the same transaction, even after the first closes. [D]

**Chargeback simulation:** `POST /v2/customer-support/process-chargeback` (seller transaction id as `transaction.id_enc`, `merchant_id`, `adjacency: PAYPAL`, `file_layout: ATCK_CB`, `financial_institution.processor: FDMS`, `instrument.instrument_type: CARD`, `dispute{...}`). [D] **Returns 500 `INTERNAL_SERVER_ERROR` on every variant we tried** (date-only and ISO dates, with and without `credit_card_transaction_id`/`reference_number`, reason codes `C2` and `1330`) [S]. Parked; not on the critical path.

**Actions** (all `POST /v1/customer/disputes/{id}/...`; only call when the matching HATEOAS link is present):

| Action | Body | Allowed when [D] |
|---|---|---|
| `provide-evidence` | multipart: `input` = `{ evidences: [{ evidence_type, evidence_info: { tracking_info: [{ carrier_name, tracking_number }] \| refund_ids }, notes }] }` + file parts | `status = WAITING_FOR_SELLER_RESPONSE` + link |
| `make-offer` | JSON `{ note, offer_amount, offer_type: REFUND \| REFUND_WITH_RETURN \| REFUND_WITH_REPLACEMENT \| REPLACEMENT_WITHOUT_REFUND }` | stage `INQUIRY` (guide also lists later stages; trust the link) |
| `accept-claim` | reference says multipart (`accept-claim-document`); guide shows JSON `{ note, accept_claim_type }` | `WAITING_FOR_SELLER_RESPONSE`, any stage |
| `send-message` | JSON `{ message }` | stage `INQUIRY` only |
| `escalate` | JSON `{ note }` | stage `INQUIRY` |
| `provide-supporting-info` | multipart / JSON `{ notes }` | stage `CHARGEBACK`+, `status = UNDER_REVIEW` |
| `acknowledge-return-item` | JSON `{ note, acknowledgement_type }` | `WAITING_FOR_SELLER_RESPONSE` |
| `appeal` | multipart like provide-evidence | `appeal` link present |
| `require-evidence` (sandbox) | JSON `{ action: SELLER_EVIDENCE \| BUYER_EVIDENCE }` | `status = UNDER_REVIEW` + link; moves to `WAITING_FOR_SELLER_RESPONSE` / `WAITING_FOR_BUYER_RESPONSE` |
| `adjudicate` (sandbox) | JSON `{ adjudication_outcome: SELLER_FAVOR \| BUYER_FAVOR }` | `status = UNDER_REVIEW` + link |

Sandbox results [S] (fixtures in `fixtures/smoke/lifecycle/`):
- `require-evidence` and `adjudicate` are **never offered** on Resolution Center disputes, even at `UNDER_REVIEW` (inquiry or chargeback), including after waiting. Calling them anyway → 400 `ACTION_NOT_ALLOWED_IN_CURRENT_DISPUTE_STATE`. So we **can't force a sandbox settlement in the seller's favour**. Buyer-favour settlement through `accept_claim`/`make_offer` is real and still to be tested in Phase 2.
- `provide-supporting-info` on a CHARGEBACK/UNDER_REVIEW dispute: multipart `input = { notes }` → **200**. The state stays CHARGEBACK/UNDER_REVIEW.
- `provide-evidence` with `evidence_type: OTHER` on an INR inquiry → 400 `EVIDENCE_TYPE_IS_NOT_ALLOWED`. Send the type the dispute requested (`evidences[].source = REQUESTED_FROM_SELLER`).

Enums [D]: `status` OPEN, WAITING_FOR_BUYER_RESPONSE, WAITING_FOR_SELLER_RESPONSE, UNDER_REVIEW, RESOLVED. `dispute_life_cycle_stage` INQUIRY, CHARGEBACK, PRE_ARBITRATION, ARBITRATION. `reason` MERCHANDISE_OR_SERVICE_NOT_RECEIVED, MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED, UNAUTHORISED, CREDIT_NOT_PROCESSED, DUPLICATE_TRANSACTION, INCORRECT_AMOUNT, PAYMENT_BY_OTHER_MEANS, CANCELED_RECURRING_BILLING, OTHER. `evidence_type` includes PROOF_OF_FULFILLMENT, PROOF_OF_REFUND, OTHER (list not exhaustive).

Doc discrepancies to resolve in the sandbox: make-offer stage; accept-claim body format; who may call create.
Sandbox Resolution Center: `https://www.sandbox.paypal.com/disputes/dashboard/` (log in as the personal account). Inquiry stage lasts up to 20 days unless escalated.

## PayPal: Webhooks

- **Create:** `POST /v1/notifications/webhooks` `{ url, event_types: [{ name }] }` → 201 with `id` [S]. We subscribe to `CUSTOMER.DISPUTE.CREATED`, `.UPDATED`, `.RESOLVED`. An `https` ngrok URL was accepted.
- **List:** `GET /v1/notifications/webhooks` → `{ webhooks: [] }` [S].
- **Simulate:** `POST /v1/notifications/simulate-event` `{ webhook_id, event_type, resource_version: "1.0" }` → 202 [S]. **Works for `CUSTOMER.DISPUTE.CREATED`**, delivered within seconds, with a sample resource (`dispute_id` `PP-000-042-663-135`, not a real dispute in our account).
- **Real dispute events** [S]: filing in the Resolution Center sends `CUSTOMER.DISPUTE.CREATED` (resource at INQUIRY/UNDER_REVIEW), then `CUSTOMER.DISPUTE.UPDATED` when it moves to WAITING_FOR_SELLER_RESPONSE. All delivered through ngrok within seconds, and all verified `SUCCESS`.
- **Verify:** `POST /v1/notifications/verify-webhook-signature` with `auth_algo, cert_url, transmission_id, transmission_sig, transmission_time` (from headers `paypal-auth-algo`, `paypal-cert-url`, `paypal-transmission-id`, `paypal-transmission-sig`, `paypal-transmission-time`), `webhook_id`, `webhook_event` (the parsed body). **Simulated events verify as `SUCCESS`** [S]. Fixture: `fixtures/webhooks/`.
- We reject `cert_url` values that aren't on a paypal.com API host before calling verify.

## AG Studio / AG Grid

- Versions (from the boilerplate): `ag-studio@3.0.0`, `ag-studio-react@3.0.0`, `ag-grid-community@36.2.0`, `ag-grid-react@36.2.0`, Next 16.3.6, React 19.2.8. [S]
- Minimal report [S] (`app/hello-studio/hello-studio.tsx`): `<AgStudioProvider licenseKey>` wrapping `<AgStudio data={AgDataSourcesDefinition} initialState={AgReportState} mode="view" />`. Data source fields use formats `textFormat`, `currencyFormat`, `dateFormat`, `percentageFormat`; widgets reference fields as `sourceId.fieldId`. Widget types seen: `grid`, `pivot-grid`, `value`, `column-chart-stacked`, `bar-chart-grouped`, `donut-chart`, `combo-chart-grouped-column-line`, `radial-gauge`, `treemap-chart`, `sunburst-chart`, `date-filter`, `button-filter`. Layout is a 24-column track grid (`xTrack, yTrack, xSpan, ySpan`).
- With our key, Studio renders the watermark elements but they carry `ag-hidden` and are empty, and the console has no licence messages [S]. **Licence: TRIAL, expires 2026-12-25** (decoded from the key's embedded timestamp), which covers judging to Dec 21.
- Quirk from the boilerplate: a relative date filter in saved state fails to apply on load in Studio 3.0.
- AI assistant: `AgStudioAiModule` + `createAiHarness(api, { adapter, promptStarters, models })`; the boilerplate's adapter targets the OpenAI Responses API through a server proxy. The Claude adapter is Phase 5 work. [S, from code]

## Anthropic (Claude)

- `@anthropic-ai/sdk@1.7.0`, `zod@4.6.7`. Model from `ANTHROPIC_MODEL` (`claude-sonnet-5-5`).
- Tool use: `client.beta.messages.toolRunner({ tools: [betaZodTool(...)], output_config: { effort, format: betaZodOutputFormat(schema) } })` runs the loop and returns the final message; we still `safeParse` the final text with Zod. [S]
- Sonnet 5.5 rejects forced `tool_choice` (`any`/`tool`) and `thinking: {type: "disabled"}` with a 400, so we use `auto` + structured output. [D, from the SDK skill docs]
- Phase 0 run: 2 tool calls, Zod-valid decision, all evidence cited real record ids, ~9 s, `effort: low`. [S]

## Verdict's dispute ledger (Phase 1)

- **Webhook path:** verify signature → skip if the event id is already in `dispute_events` → `GET` the full dispute (the webhook resource lacks the due date, requested evidence and allowed options) → in one transaction, record the event and upsert the dispute. If the GET fails, the partial resource is stored with `raw_is_full = 0` and no due date. The poller completes it later.
- **Not ours:** PayPal's `simulate-event` sample (`PP-000-042-663-135`) verifies `SUCCESS`, but `GET` returns 404 for our merchant. Such events get a 200 (no retries) and are kept out of the ledger (`audit_log` kind `webhook.not_ours`). [S]
- **Ordering:** PayPal `update_time` decides. An older representation never overwrites a newer one, and a partial one never overwrites a full one with the same `update_time`.
- **Polling:** `GET /v1/customer/disputes?page_size=50&page=N` every `SYNC_POLL_SECONDS` (default 20). Only disputes whose `update_time` moved, or that are stored partial, get re-fetched. A fresh DB discovered all 8 sandbox disputes ~10 s after server start. [S]
- **Join to orders:** `disputed_transactions[0].seller_transaction_id` = our `orders.paypal_capture_id`.
