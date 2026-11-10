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
| `npm run ai:smoke` | Claude tool-use call with a Zod-validated decision |
| `npm test` | Unit tests (Vitest) |

`/hello-studio` renders a one-grid, one-chart AG Studio report as a licence check.

## Attribution

Scaffolded from PayPal's [hackathon-paypal-ag-grid-boilerplate](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate) (commit `5de114e`): the Next.js setup, `lib/paypal.ts`, the endpoint pages and the `/dashboard` AG Studio example come from it. Its OpenAI adapter was itself copied from the AG Studio docs.

## Licence

MIT. See [LICENSE](LICENSE).
