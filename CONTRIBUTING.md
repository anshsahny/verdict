# Contributing

Issues and pull requests are welcome.

1. Fork, then `npm install` and `cp .env.example .env.local`. REPLAY mode (`REPLAY_MODE=1`) needs no PayPal account.
2. Keep changes small. Before opening a PR, run `npm run typecheck`, `npm test` and `npm run e2e`.
3. Code that calls PayPal gets a test against a recorded, redacted fixture in `fixtures/`, so CI never needs the network.
4. Agent changes: run `npm run eval` and include the before and after numbers in the PR.
5. Never commit secrets or real buyer data. `.env.local` is git-ignored; redact recorded responses (`npm run sandbox:capture` does this).
6. The Arena's arbiter is a SIMULATED stand-in for PayPal's reviewers. Keep it labelled that way in UI and docs, and don't present its numbers as real-world results.

By contributing you agree that your work is released under the MIT licence.
