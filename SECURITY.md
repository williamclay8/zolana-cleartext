# Security

Zolana Cleartext is unaudited alpha software. It is read-only: it does not custody funds, sign transactions, or hold spending keys. A high privacy score is not a guarantee that activity is unlinkable.

## Reporting a vulnerability

Please report security issues privately to the maintainer, William Hooten, rather than in a public issue. Include a description, the version or commit, and a way to reproduce the problem. Do not include a live Helius API key, a wallet secret, or a keypair file in the report.

If you find a secret that was committed to this repository, say which file and commit. Do not paste the secret itself.

## What this project handles

- A Helius API key in the local `.env` (`HELIUS_API_KEY`). The server reads it to call Helius RPC and the privacy indexer. It is not sent to the browser and must not be committed.
- Public Solana addresses and public deposit and withdrawal amounts. Those are already on chain. The tool does not decrypt shielded transfers.

## Out of scope

- Issues in the Solana Privacy Program, Helius infrastructure, or a wallet that this repository does not ship.
- A privacy score you disagree with. Heuristics are documented in the README and are not a security audit.
