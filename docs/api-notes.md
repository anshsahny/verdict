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

**Get:** `GET /v1/customer/disputes/{id}`. Fields depend on the caller. Includes `evidences[]`, `allowed_response_options` (`make_offer.offer_types`, `accept_claim.accept_claim_types`, `acknowledge_return_item.acknowledgement_types`), `links[]` (HATEOAS). [D] **[?] Record a real one at Gate 0.**

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

Enums [D]: `status` OPEN, WAITING_FOR_BUYER_RESPONSE, WAITING_FOR_SELLER_RESPONSE, UNDER_REVIEW, RESOLVED. `dispute_life_cycle_stage` INQUIRY, CHARGEBACK, PRE_ARBITRATION, ARBITRATION. `reason` MERCHANDISE_OR_SERVICE_NOT_RECEIVED, MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED, UNAUTHORISED, CREDIT_NOT_PROCESSED, DUPLICATE_TRANSACTION, INCORRECT_AMOUNT, PAYMENT_BY_OTHER_MEANS, CANCELED_RECURRING_BILLING, OTHER. `evidence_type` includes PROOF_OF_FULFILLMENT, PROOF_OF_REFUND, OTHER (list not exhaustive).

Doc discrepancies to resolve in the sandbox: make-offer stage; accept-claim body format; who may call create.
Sandbox Resolution Center: `https://www.sandbox.paypal.com/disputes/dashboard/` (log in as the personal account). Inquiry stage lasts up to 20 days unless escalated.

## PayPal: Webhooks

- **Create:** `POST /v1/notifications/webhooks` `{ url, event_types: [{ name }] }` → 201 with `id` [S]. We subscribe to `CUSTOMER.DISPUTE.CREATED`, `.UPDATED`, `.RESOLVED`. An `https` ngrok URL was accepted.
- **List:** `GET /v1/notifications/webhooks` → `{ webhooks: [] }` [S].
- **Simulate:** `POST /v1/notifications/simulate-event` `{ webhook_id, event_type, resource_version: "1.0" }` → 202 [S]. **Works for `CUSTOMER.DISPUTE.CREATED`**, delivered within seconds, with a sample resource (`dispute_id` `PP-000-042-663-135`, not a real dispute in our account).
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
