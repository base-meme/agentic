# basememe-ai – Agent Guidelines (Claude / Claude Code)

## Overview

This repo provides the **basememe-ai** skill for AI agents: create and trade meme tokens on **Basememe (Base chain only)** using the Basememe API and on-chain contracts. Two factory generations are supported through a unified CLI:

- **V4 standard tokens** (`coin_version` `2.x.x`) — BasememeFactory + BondingCurve + Uniswap V4 graduation.
- **Tax tokens** (`coin_version` `>= 11.2.0`) — separate BasememeTaxFactory with on-token transfer/trade tax, four-channel processor split (funds / burn / dividend / liquidity), optional Vault strategies (split / snowball / burn-dividend / gift), and Uniswap V2 graduation. See `skills/basememe-integration/SKILL.md` for the full tax surface.

The authoritative specification for this skill is `skills/basememe-integration/SKILL.md`. Claude/Claude Code should treat that file as the main contract for behavior, safety, and command usage.

## When to Use This Skill

Use this repo when the user explicitly or implicitly asks to:

- **Create** a meme token on Basememe on Base (standard, dynamic with vesting, or tax token with 4-channel split + optional Vault).
- **Buy** or **sell** a Basememe token on Base — V4 or tax (quote first, then execute; routing is automatic by `coin_version`).
- **Query token info** (on-chain state, phase, bonding curve progress).
- **Query lists / rankings** of Basememe tokens (REST list, detail, trending, market cap).
- **Query quotes** for token trades (ETH-to-token or token-to-ETH estimates).
- **Send ETH / ERC20** from the trading wallet to another address on Base.
- **Inspect tax-token state** — `tax-info`, `dividend-info`, `vault-info`.
- **Claim or interact with tax-token rewards** — `dividend-claim`, `vault-claim`, `vault-burn`, `vault-claim-reward`, `gift-proof-submit`.
- **Register / query** an ERC-8004 Identity NFT (on-chain agent identity).

If the user's request does not involve Basememe, Base chain, or these flows, you should not use this skill.

## Repo Layout

```
basememe-ai/
├── skills/
│   └── basememe-integration/
│       ├── SKILL.md        # Main skill instructions
│       └── references/     # Create flow, trade flow, phases, errors, addresses
├── src/
│   ├── commands/           # CLI command implementations
│   ├── lib/                # Shared libraries (chain, contracts, quote, etc.)
│   └── index.js            # Commander entry point
├── bin/
│   └── basememe.js         # CLI entry (ESM)
├── package.json
├── README.md
└── CLAUDE.md               # This file (Claude-facing guidelines)
```

## Safety and Private Key Handling

The SKILL defines a **User Agreement & Security Notice**. Claude MUST:

1. On first use of this skill in a conversation, present the User Agreement and Security Notice.
2. Make clear that continuing to use this skill implies acceptance of the User Agreement.
3. **MUST NOT** run any write operation (`create`, `buy`, `sell`, `send`, `8004-register`, `dividend-claim`, `vault-claim`, `vault-burn`, `vault-claim-reward`, `gift-proof-submit`) until the user has explicitly agreed or confirmed to continue.
4. May run read-only commands (`config`, `verify`, `token-info`, `quote-buy`, `quote-sell`, `tax-info`, `dividend-info`, `vault-info`, `8004-balance`, etc.) before confirmation.

Never ask the user to paste a private key into chat. All private keys must come from environment / config (e.g. `PRIVATE_KEY`) as described in `SKILL.md`.

## Installation

**Global install:**

```bash
npm install -g @basememe/ai@latest
basememe <command> [args]
```

**Local install (no global):**

```bash
git clone https://github.com/base-meme/agentic.git
cd agentic
npm install
npx basememe <command> [args]
```

## Environment

Set **PRIVATE_KEY** and optionally **BASE_RPC_URL** via `.env` file in the working directory or shell export. The CLI loads `.env` from `process.cwd()` automatically.

- **PRIVATE_KEY** — required for write operations.
- **BASE_RPC_URL** — optional, uses `https://mainnet.base.org` if not set.
- **BASEMEME_RECEIPT_TIMEOUT_MS** — optional integer (ms). Override viem's default `waitForTransactionReceipt` timeout (~180s). Useful for slow networks or sequencer batching. On timeout, CLI throws `{code: 'RECEIPT_TIMEOUT', txHash, txLabel}` so callers can poll the hash instead of resubmitting (avoids double-execution).

## CLI Usage

```bash
basememe <command> [args...]
npx basememe <command> [args...]
```

Always prefer these CLI commands rather than calling `src/` files directly. The CLI entry (`bin/basememe.js`) dispatches to the correct command.

Key commands (full list in `SKILL.md`):

- `basememe config` / `basememe verify` — Environment and connectivity check.
- `basememe token-info` / `token-get` / `token-list` / `rankings` — Token queries.
- `basememe quote-buy` / `quote-sell` — Estimate trades without sending tx (tax-aware routing automatic).
- `basememe buy` / `sell` — Execute trades via BondingCurve or DEX helper (V4 / tax-factory / V3 legacy chosen by `coin_version`).
- `basememe create` — Create a V4 token (with optional vesting / dynamic settings) or a tax token (`--tax-rate` + 4-channel `*-bps` flags + optional `--market-mode vault --vault-type ...`).
- `basememe send` — Send ETH or ERC20 from the trading wallet.
- `basememe tax-info` / `dividend-info` / `vault-info` — Tax-token reads (4-channel split, processor, dividend balances, attached vault state).
- `basememe dividend-claim` / `vault-claim` / `vault-burn` / `vault-claim-reward` / `gift-proof-submit` — Tax-token writes (claim dividends, claim/burn vault shares, submit X-proof for gift vault).
- `basememe 8004-register` / `8004-balance` — ERC-8004 Identity NFT.
- `basememe events` — V4 factory event inspection (V4-only by design).

## External Docs

For deeper details, see:

- In-repo: `skills/basememe-integration/references/` (create-flow, trade-flow, token-phases, errors, contract-addresses)
- Basememe website: [https://base.meme](https://base.meme)
