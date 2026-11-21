# Zolana Cleartext

A self-check for the public edge of a [Helius Solana Privacy Ring](https://www.helius.dev/docs/privacy/concepts/architecture) (Zolana). Give it one Solana address. It reads that address's **deposits** and **withdrawals** — the movements that are public by design — and scores how easily those two sides can be paired.

It does not ask for a signature, does not hold a spending key, and does not decrypt shielded transfers. It also does not match your deposits against other people's withdrawals. If another address shows up in your own transaction, the report says so and stops there.

The same scoring engine drives the web app, the CLI, and the tests. Licensed under MIT. Copyright 2026 William Hooten.

## Disclaimers

**Unaudited alpha.** This project has not been security-audited. The score is a transparent heuristic over public chain data, not a proof that a deposit and a withdrawal are the same funds, and not a proof that they are not. A high score is not a promise that activity is private. Do not treat it as an audit of Zolana, of a wallet, or of a transaction you are about to send.

**Not financial advice.** Nothing in this repository is a recommendation to deposit, withdraw, trade, hold, or avoid any asset. You are responsible for your own transactions.

## Default ring

The permissionless Default Ring is **confidential, not anonymous**.

- A shielded transfer encrypts the asset and the amount. On the Default Ring the sender and recipient addresses stay public.
- A deposit from a public balance publishes the asset, the amount, and the public accounts involved. A withdrawal does the same on the way out.
- Anonymous custom rings can hide the sender behind a relayer. This checker does not assume that. It scores the public boundary it can actually read.

Cleartext only scores that boundary for the address you enter.

## Run it with your own Helius key

Create a key in the [Helius dashboard](https://dashboard.helius.dev). It authenticates RPC and indexer reads. It does not authorize spending.

```bash
npm install
cp .env.example .env
# edit .env and replace your_helius_api_key with your own key
npm test
npm run dev            # http://127.0.0.1:43123
```

`.env` is gitignored. `.env.example` keeps placeholders only. Do not commit a real key, a keypair file, or an `api-key=` URL that contains one.

- **With `HELIUS_API_KEY`**, signature reads and `getTransaction` go to `devnet.helius-rpc.com` or `mainnet.helius-rpc.com`. Cleartext also calls `getShieldedTransactionsByTags` (`params.tags`) and `getUserRecords` (`params.owners`). Those return encrypted payloads and public registry records. Amounts still come from the Solana transaction. Ciphertexts are discarded. The web app reads the key on the server and does not send it to the browser.
- **Without a key**, amounts come from public Solana RPC: `getSignaturesForAddress` and `getTransaction`. Devnet uses `https://api.devnet.solana.com`. Mainnet uses `https://api.mainnet-beta.solana.com`. The indexer methods are skipped. Set `ZOLANA_CLUSTER` to `devnet` or `mainnet`, or pass `--cluster` / the cluster menu. Leave `SOLANA_RPC_URL` empty unless you need a different endpoint.

## Demo script

Offline, no key:

```bash
npm run cli -- fixtures
npm run cli -- score --fixture quick-roundtrip
npm run cli -- score --fixture recorded-devnet
npm run cli -- preflight --fixture unique-open --sol 0.42424242 --in 10m
npm run cli -- preflight --fixture unique-open --sol 1 --in 7d
```

`preflight` exits 2 when the plan should be stopped.

In the browser, open a scenario chip (they are scored locally), then use **Pre-flight** to try a size and a wait. To score an address you control, paste it and choose devnet or mainnet.

Live, still with no key (public boundary only):

```bash
npm run cli -- score YOUR_ADDRESS --cluster devnet
```

## What is public

From the [deposit](https://www.helius.dev/docs/privacy/guides/deposit) and [withdraw](https://www.helius.dev/docs/privacy/guides/withdraw) guides:

| Movement | Asset | Amount | Who |
| --- | --- | --- | --- |
| Deposit | Public | Public | Depositor is a signer. On the default ring the view tag is the recipient's Solana address, in the instruction. |
| Withdrawal | Public | Public | Recipient account and, on a confidential ring, the owner signer. |
| Shielded transfer | Encrypted | Encrypted | Not scored. |

Program `ring1GaLCuJnkUMVkX2JeZLTTX17wKsV4fZmPVzXANW`. Native SOL enters and leaves through the interface PDA `CiNmas621VuyofiDSrEPfTXHKrdZuB6jMKECyNiMpLXE`.

Instruction tags follow [privacy-rings](https://github.com/helius-labs/privacy-rings) `program-libs/event/src/tag.rs` on main as of 20 Nov 2026, and they match live devnet transactions: deposit `15`, transact `16`, ring deposit `18`, ring transact `19`. An older spec used `11` and `12`. This parser follows the deployed tags.

Public SOL amounts are the `u64` fields in `DepositIxData` and in `TransactIxData.interface_transfers` (`SolDeposit` / `SolWithdrawal`). The proof and the ciphertexts are not read. After a parse, the sum of those SOL legs is checked against the interface PDA's lamport change.

## Heuristics

The score starts at **100** (harder to link) and findings subtract points. It is clamped to 0–100.

| Grade | Score |
| --- | --- |
| Strong | 90–100 |
| Fair | 70–89 |
| Leaky | 45–69 |
| Exposed | 0–44 |

A deposit is paired with a later withdrawal of the **same asset** when the amounts are equal, or the gap is at most half a percent of the larger amount (or 0.0001 of a token, whichever is larger). One deposit is used at most once. If a single withdrawal does not match, two or three earlier deposits (or two or three later withdrawals) are tried, limited to the eight closest in time. The weights live in `src/lib/engine/score.ts` as `WEIGHT`.

| Signal | Points |
| --- | --- |
| Exact match, unusual amount | 32 |
| Exact match, standard amount | 14 |
| Near match, unusual amount | 22 |
| Near match, standard amount | 10 |
| Split that still adds up | 12 |
| Gap of 10 minutes or less | +24 |
| Gap of 30 minutes or less | +16 |
| Gap of 2 hours or less | +10 |
| Gap of 24 hours or less | +5 |
| Gap of 72 hours or less | +2 |
| Unusual amount that also comes back within 30 minutes | +8 |
| Open deposit with an unusual size | 3, capped at 9 |
| Unmatched withdrawal with an unusual size | 4, capped at 12 |

Timing is added onto the match. It is not a second finding, so a fast round trip is not punished twice. A match inside 30 minutes is reported as a quick in-then-out.

**Standard sizes** (whole tokens, or these fractions): 0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100, and any whole number of tokens from 1 to 1000. Anything else is unusual.

The fixes in the report are the practical ones: wait (a day is a start, several days is better), withdraw a different standard size, or split so the pieces do not add back up to the deposit. Leave the rest in the ring.

**Pre-flight** appends a hypothetical withdrawal and scores again.

| Verdict | When |
| --- | --- |
| Stop | A new quick round trip, or any new finding worth 30 or more |
| Caution | Any new finding worth 8 or more |
| Clear | Otherwise |

The clock is `max(now, your latest boundary event) + the wait you picked`, so replaying an old fixture still puts the plan after that history.

## Live data versus fixtures

Checked in this environment on 21 Nov 2026. The first pass used public Solana RPC and no Helius key. A later pass set `HELIUS_API_KEY` locally (gitignored) and called Helius devnet and mainnet.

**Works live, no key**

- Public devnet RPC returns ring transactions. The parser read real deposits and withdrawals. Examples recorded in `fixtures/rpc/`:
  - A deposit of 0.005 SOL (`devnet-deposit.json`). Instruction amount and interface PDA increase agree.
  - A withdrawal of 0.0074 SOL to a different public account (`devnet-withdraw.json`). The signer is scored as the sender. The recipient is scored only if you ask about that address, and their other transactions are not loaded.
  - A self withdrawal of 0.001 SOL, 63 seconds after a deposit of the same size. Score 62, grade leaky, finding “quick round trip”. The fee payer’s balance rose by 0.00099 SOL because the fee came out of the same account. The parser allows that shortfall.
  - A shielded transfer with an empty public-leg list (`devnet-shielded-transfer.json`, the devnet example from the `getShieldedTransactionsByTags` docs) produces no boundary event.
  - A same-transaction deposit plus a transact with no public legs is one deposit, not a fake withdrawal.
- The same parser read a live mainnet deposit with no warning (tag 15, 6,690,861 lamports, signer `9kWc…LTuW`, signature starting `4rek…qpRF`, slot 472297785). Public mainnet RPC served it. No key.

**Works live with a key**

- `getHealth` on `devnet.helius-rpc.com` and `mainnet.helius-rpc.com` returns `ok`. Scoring then uses that RPC for `getSignaturesForAddress` and `getTransaction`. The same addresses that 429'd on public devnet RPC scored with zero fetch warnings.
- `getShieldedTransactionsByTags` needs `params.tags` (1–1000 base58 view tags). `getUserRecords` needs `params.owners` (1–100 pubkeys). A call with `params: {}` returns JSON-RPC `-32602` Invalid params. A body whose method does not match the URL path returns HTTP 400 and `-32601`. Both documented calls succeed on devnet and mainnet. Ciphertexts are discarded. The registry count ignores `null` entries (an owner with no record).
- Devnet doc wallet `GjGG…WhLX`: registry record present, 2 shielded transactions (1 proofless), one public deposit, score 100. Mainnet doc wallet `5Vt1…H55M`: the same shape, score 100.
- A busy devnet address returned 1,287 shielded transactions from the indexer (paginated) and a registry record. The score still uses at most 60 address signatures plus 20 extra indexer signatures.
- Mainnet signer `9kWc…LTuW` has no registry record and zero shielded transactions under that pubkey as a view tag. Helius RPC still found 15 public deposits and scored them (91, strong). The indexer does not replace the public-boundary parse.

Without a key those two indexer methods return HTTP 401. They still do not return decrypted amounts. There is no indexer method that does, and this tool does not ask for a viewing key.

**Fixtures**

- `fixtures/rpc/*.json` are trimmed `getTransaction` responses from devnet (logs removed). The parser tests run on them.
- `src/lib/fixtures/scenarios.ts` holds the demo histories, including `recorded-devnet`, whose amounts and timestamps are the public round trip above. Tests and the UI score these with no network.

## Library and CLI

Scoring:

```ts
import { scoreBoundary, preflight } from "./src/lib/engine/index.ts";
```

Parsing a `getTransaction` result:

```ts
import { extractBoundary } from "./src/lib/ring/parse.ts";
```

The CLI is `npm run cli -- …` (`src/cli.ts`). Add `--json` for a machine-readable report.

## Limitations

- Only the most recent 60 signatures that mention the address are scanned, plus up to 20 extra indexer signatures when a key is set.
- Confidential rings publish the owner on a withdrawal. Anonymous custom rings can hide the sender behind a relayer. A lone signer is treated as the sender. If several signers are present, a fee-only signer is treated as a relayer and is not scored as the sender.
- The score cannot see the rest of the ring. A standard amount is less of a fingerprint, but this tool will not tell you whether anyone else deposited that size.
- SPL public legs are decoded when the instruction parses. Decimals come from token balances in that transaction when they are present.
- Ring-deposit instructions follow the current `RingDepositEntry` layout (amount in the clear, then an encrypted blob). The recorded sample did not include one.
- A failed transaction is ignored.
- This is a heuristic, not a proof that two events are the same funds, and not a proof that they are not.
