# Contributing

Zolana Cleartext is an unaudited alpha. Issues and patches are welcome. Please keep the tool a self-check of public boundary data.

## Setup

```bash
npm install
cp .env.example .env
# put your own Helius key in .env if you want live indexer calls
npm test
npm run dev
```

Do not commit `.env`, keypair files, or a real API key. `.env.example` must keep placeholder values only.

## Tests

`npm test` runs the scoring and parser tests. They use recorded fixtures and do not need a key or a network connection. If you change a weight in `src/lib/engine/score.ts`, update `tests/score.test.ts` and the heuristics table in the README in the same change.

## Scope

- Score only the address the user asked about.
- Do not add a mode that matches one person's deposits to other people's withdrawals.
- Do not decrypt shielded payloads, and do not ask for a viewing key or a wallet signature.
- Parser changes should keep a fixture test on `fixtures/rpc/`.

## Pull requests

Describe what changed and how you tested it. A failing test is more useful than an untested heuristic tweak.
