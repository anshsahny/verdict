# Verdict

AI dispute clerk for small PayPal merchants, plus an Arena that stress-tests your defense strategy against simulated buyers. Built with the PayPal sandbox, Claude and AG Studio.

> Work in progress for the PayPal AI Hackathon. Full README (architecture, setup, the SIMULATED-arbiter disclosure) lands in Phase 6.

## Quick start (dev)

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run dev                  # http://localhost:3000
```

| Command | What it does |
|---|---|
| `npm run sandbox:smoke` | Phase 0 PayPal sandbox smoke test (PASS/FAIL per step; redacted responses go to `fixtures/smoke/`) |
| `npm run sandbox:smoke -- --approve` | Starts the one-time sandbox buyer approval (vaults the buyer for non-interactive orders) |
| `npm run sandbox:orders` | Creates 8 labelled orders paid by the vaulted sandbox buyer (for filing disputes in the sandbox Resolution Center) |
| `npm run seed` | Seeds the demo store into SQLite (`-- --reset` recreates it). The app also seeds on first start |
| `npm run sandbox:capture` | Saves the current redacted state of every sandbox dispute to `fixtures/disputes/` |
| `npm run sandbox:lifecycle -- --dry-run` | Shows the Gate 1 live lifecycle plan and what each dispute allows now. Without `--dry-run` it acts on real sandbox disputes (one-shot) |
| `npm run agent -- <disputeId>` | Defender agent recommendation for a dispute in the ledger (no PayPal action). `-- --approve <decisionId>` executes it after review |
| `npm run eval` | Defender evaluation on 20 labelled, SIMULATED scenarios: action accuracy, routing, citation validity, injection resistance, latency, cost |
| `npm run ai:smoke` | Claude tool-use call with a Zod-validated decision |
| `npm test` | Unit tests (Vitest) |

`/hello-studio` renders a one-grid, one-chart AG Studio report as a licence check.

## Attribution

Scaffolded from PayPal's [hackathon-paypal-ag-grid-boilerplate](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate) (commit `5de114e`): the Next.js setup, `lib/paypal.ts`, the endpoint pages and the `/dashboard` AG Studio example come from it. Its OpenAI adapter was itself copied from the AG Studio docs.

## Licence

MIT. See [LICENSE](LICENSE).
