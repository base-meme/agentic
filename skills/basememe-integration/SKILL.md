---
name: basememe-ai
description: |
  CLI tool for creating and trading meme tokens on Basememe on the Base chain, with structured JSON outputs for config, token details, market quotes, transactions, events, and token creation flows.
allowed-tools:
  - Bash(basememe *)
  - Bash(npx basememe *)
license: MIT
metadata:
  {"author":"Basememe","version":"0.3.0","openclaw":{"requires":{"env":["PRIVATE_KEY"]},"primaryEnv":"PRIVATE_KEY","optionalEnv":["BASE_RPC_URL","BASEMEME_RECEIPT_TIMEOUT_MS"]}}
---

## [Agent must follow] User agreement and security notice on first use

When responding to any request about Basememe or this skill, present the User Agreement and Security Notice below before any write operation. By choosing to continue, the user agrees to the User Agreement.

Until the user has explicitly agreed or confirmed to continue, do not run `basememe buy`, `basememe sell`, `basememe send`, `basememe create`, `basememe 8004-register`, `basememe dividend-claim`, `basememe vault-claim`, `basememe vault-burn`, `basememe vault-claim-reward`, or `basememe gift-proof-submit`. Read-only commands such as `basememe config`, `basememe verify`, `basememe token-info`, `basememe token-get`, `basememe token-list`, `basememe rankings`, `basememe quote-buy`, `basememe quote-sell`, `basememe events`, `basememe 8004-balance`, `basememe tax-info`, `basememe dividend-info`, and `basememe vault-info` may be used before confirmation.

### User Agreement

Before using the write capabilities in this skill, read the following. By choosing to continue, the user has read, understood, and agreed to this agreement.

This package provides local CLI execution only. The private key is used only from local environment variables. The skill does not intentionally collect, upload, or custody the private key. The providers are not liable for private key disclosure, asset loss, failed transactions, or incorrect token creation caused by a compromised environment, tampered plugin, user error, third-party tools, or any other cause.

### Security Notice

- Never type, paste, or reveal private keys, seed phrases, or keystores in chat.
- Keep limited funds in the Basememe trading wallet and move assets out after write operations.
- Verify token address, amount, recipient, slippage, and network before every write command.
- Base mainnet transactions use real money and are not reversible once confirmed on-chain.

## Write operation confirmation rules

Never execute any write command from a generic acknowledgment alone. Before every write operation, the agent must:

1. Display a transaction summary showing `command`, `token or recipient address`, `amount`, `slippage` when applicable, and `network: Base mainnet (chain ID 8453)`.
2. Require transaction-specific confirmation that clearly matches the displayed summary.
3. Stop and ask for clarification if the address, amount, token, or slippage is ambiguous.
4. Do not treat generic responses such as `yes`, `ok`, `go ahead`, or `do it` as sufficient unless they clearly refer to the exact summary currently shown.

### Transfer safety rules for `send`

The `basememe send` command transfers ETH or ERC20 tokens and is irreversible. Additional rules:

- Never infer the recipient from context. The user must provide the full address for each transfer.
- Reject invalid `0x` addresses.
- Before execution, display `asset`, `recipient`, `amount`, and `network`.
- For a new recipient, recommend a small test transfer first.

## Installation and execution

Install globally:

```bash
npm install -g @basememe/ai@latest
basememe --help
```

Or run locally:

```bash
git clone https://github.com/base-meme/agentic.git
cd agentic
npm install
npx basememe --help
```

After installation, verify connectivity first:

```bash
basememe verify
```

Run commands only through the published CLI:

```bash
basememe <command> [args]
npx basememe <command> [args]
```

Do not call `src/index.js` or individual command files directly.

## Environment configuration

Required:

- `PRIVATE_KEY`

Optional:

- `BASE_RPC_URL` with default `https://mainnet.base.org`
- `BASEMEME_RECEIPT_TIMEOUT_MS` integer (ms). Override viem's default `waitForTransactionReceipt` timeout (≈180s on Base). Useful when a network is slow or the sequencer is intermittently batching tx. On timeout, the CLI throws a structured error with `{code: 'RECEIPT_TIMEOUT', txHash, txLabel}` so callers can poll the in-flight hash with their own deadline instead of resubmitting (avoids double-execution). Unset → viem default applies.

Standalone `.env` example:

```bash
PRIVATE_KEY=your_private_key_here
BASE_RPC_URL=https://mainnet.base.org
# BASEMEME_RECEIPT_TIMEOUT_MS=600000  # opt-in: 10 min wait for slow networks
```

### When using OpenClaw

This skill declares `requires.env: ["PRIVATE_KEY"]` and `primaryEnv: "PRIVATE_KEY"` in metadata; OpenClaw injects them only when an agent runs with this skill enabled (other skills cannot access them).

Required steps:

1. **Configure private key**: In the Skill management page, set the **basememe-ai** skill's **apiKey** (corresponds to `primaryEnv: "PRIVATE_KEY"`), or set `PRIVATE_KEY` under `skills.entries["basememe-ai"].env` in `~/.openclaw/openclaw.json`. Optionally set `BASE_RPC_URL` in global env if needed.
2. **Enable this skill**: In the agent or session, ensure the **basememe-ai** skill is enabled. Only when the skill is enabled will OpenClaw inject `PRIVATE_KEY` into the process; otherwise `create`, `buy`, `sell`, `send`, `8004-register` will fail with missing key. `BASE_RPC_URL` is optional (metadata: `optionalEnv`); if not set, the CLI uses `https://mainnet.base.org`.

> **Note:** The `apiKey` field in the OpenClaw Skill management page maps to `PRIVATE_KEY` for this skill. It is your local wallet signing key, not a remote service API key.

### When not using OpenClaw (standalone)

Set **PRIVATE_KEY** and optionally **BASE_RPC_URL** via the process environment:

- **.env file**: Put a `.env` file in **the directory where you run the `basememe` command**. The CLI automatically loads `.env` from the current working directory. Do not commit `.env`; add it to `.gitignore`.
- **Shell export**: `export PRIVATE_KEY=your_hex_key` and `export BASE_RPC_URL=https://mainnet.base.org`, then run `basememe <command> ...`.

OpenClaw `openclaw.json` example:

```json
{
  "skills": {
    "entries": {
      "basememe-ai": {
        "enabled": true,
        "env": {
          "PRIVATE_KEY": "0x...",
          "BASE_RPC_URL": "https://mainnet.base.org"
        }
      }
    }
  }
}
```

## Example outputs

Representative `basememe` output:

```json
{
  "success": true,
  "data": {
    "chainId": 8453,
    "rpcUrl": "https://mainnet.base.org",
    "apiUrl": "https://tapi.base.meme/"
  }
}
```

Representative `basememe verify` output:

```json
{
  "success": true,
  "data": {
    "config": {
      "chainId": 8453,
      "apiUrl": "https://tapi.base.meme/"
    },
    "checks": {
      "rpc": {
        "status": "pass",
        "blockNumber": 28700000
      },
      "api": {
        "status": "pass",
        "response": 0
      },
      "contract": {
        "status": "pass",
        "factory": "0xC0599137dbF994d238f68e96CA0AfaddeE57Af1B"
      },
      "wallet": {
        "status": "skip",
        "reason": "PRIVATE_KEY not set"
      }
    }
  }
}
```

Representative `basememe quote-buy` output:

```json
{
  "success": true,
  "data": {
    "tokenAddress": "0x1234...",
    "phase": "curve",
    "pairType": "eth",
    "expectedOut": "2350672.37",
    "minOut": "2233138.75",
    "fee": "0.0006",
    "feeAsset": "ETH"
  }
}
```

Representative error output:

```json
{
  "success": false,
  "error": "PRIVATE_KEY environment variable is required for this command."
}
```

## Capability overview

| Category | Commands | Notes |
|----------|----------|-------|
| Query | `config`, `verify` | Show active Basememe chain settings and connectivity |
| Query | `token-info`, `token-get`, `token-list`, `rankings` | On-chain and API token discovery |
| Query | `quote-buy`, `quote-sell` | Estimate outputs before any trade |
| Query | `events` | Inspect Basememe factory events |
| Trading | `buy`, `sell` | Execute Base mainnet trades. Tax-aware routing (V4 / tax-factory / V3 legacy) is automatic based on `coin_version`. |
| Transfer | `send` | Send ETH or ERC20 tokens on Base |
| Create | `create` | Launch a Basememe token. V4 + tax-factory variants supported via `--coin-version` and pair templates. |
| Tax tokens | `tax-info`, `dividend-info`, `dividend-claim` | Inspect tax-token state and dividend balances · claim accrued dividends. Tax tokens are coin_version `>= 11.2.0`. |
| Tax vaults | `vault-info`, `vault-claim`, `vault-burn`, `vault-claim-reward`, `gift-proof-submit` | 4 vault flavors (split / snowball / burn-dividend / gift) for tax-token reward distribution. |
| Identity | `8004-balance`, `8004-register` | Query or mint ERC-8004 identity NFTs |

## CLI reference

### Read-only commands

| Command | Purpose |
|---------|---------|
| `basememe config` | Show chain ID, RPC URL, API URL, and contract addresses |
| `basememe verify` | Check RPC, API, contract, and wallet connectivity |
| `basememe token-info <tokenAddress>` | Read on-chain token state and phase |
| `basememe token-get <tokenAddress>` | Fetch API token detail and trade data |
| `basememe token-list [--sort <sort>] [--kw <keyword>] [--offset <n>] [--limit <n>]` | List tokens from the API |
| `basememe rankings <orderBy> [--limit <n>]` | Fetch rankings using the Basememe API |
| `basememe quote-buy <tokenAddress> <ethAmount> [--slippage <bps>]` | Quote ETH-to-token output |
| `basememe quote-sell <tokenAddress> <tokenAmount> [--slippage <bps>]` | Quote token-to-ETH output |
| `basememe events [fromBlock] [--toBlock <block>] [--chunk <n>]` | Read factory events across a block range |
| `basememe 8004-balance [address]` | Query ERC-8004 identity balance |
| `basememe tax-info <tokenAddress>` | Tax token metadata (tax rate, in/out bps, processor, mainPool, liquidationThreshold) |
| `basememe dividend-info <tokenAddress> [--user <address>]` | Tax-token dividend pool state + claimable amount per user |
| `basememe vault-info <tokenAddress>` | Detect vault type (split/snowball/burn-dividend/gift) attached to a tax token + per-user shares/proofs |

Supported `token-list` and `rankings` sort values:

- `now_trending`
- `block_create_time`
- `market_cap`
- `trade_volume_24h`
- `bonding_curve_progress`
- `latest_trade_time`

Aliases accepted by the CLI:

- `newest`, `new`
- `trending`
- `volume`, `24h_volume`
- `progress`
- `last_traded`

### Write commands

| Command | Purpose |
|---------|---------|
| `basememe buy <tokenAddress> <ethAmount> [--slippage <bps>] [--pair <ETH\|USDC>] [--no-use-eth]` | Buy tokens with ETH (default) or pool collateral. Tax-aware routing applies automatically for tax tokens (cv `>= 11.2.0`). |
| `basememe sell <tokenAddress> <tokenAmount> [--slippage <bps>] [--pair <ETH\|USDC>] [--no-use-eth]` | Sell tokens for ETH (default) or pool collateral. Tax-aware routing automatic. |
| `basememe send <toAddress> <amount> [--token <tokenAddress>]` | Send ETH or ERC20 tokens |
| `basememe create --name <name> --symbol <symbol> --image <path> [options]` | Create a Basememe token |
| `basememe 8004-register <name> [--image <url>] [--description <text>]` | Mint an ERC-8004 identity NFT |
| `basememe dividend-claim <tokenAddress>` | Claim accrued tax-token dividend rewards for the caller |
| `basememe vault-claim <tokenAddress>` | Claim split-vault share (tax tokens with split-vault attached) |
| `basememe vault-burn <tokenAddress> <amount>` | Burn tokens to claim a burn-dividend-vault share |
| `basememe vault-claim-reward <tokenAddress> [--to <address>]` | Claim snowball/gift vault reward (optionally to a different recipient) |
| `basememe gift-proof-submit <tokenAddress> <proofFile>` | Submit a gift-vault Merkle proof to enable downstream claim |

### `create` parameters

Required:

- `--name <name>`
- `--symbol <symbol>`
- `--image <path>`

Optional metadata:

- `--description <text>`
- `--website <url>`
- `--twitter <handle>`
- `--telegram <handle>`

Pair and market settings:

- `--pair <ETH|USDC|SOL>`
- `--target-raise <amount>`
- `--bonding-curve-pct <pct>`
- `--vesting-pct <pct>`
- `--vesting-duration <value>`
- `--cliff-duration <value>`
- `--vesting-recipient <address>`
- `--buy-amount <amount>`

## Agent workflow example

Example flow for a trade request:

1. Run `basememe verify`.
2. Run `basememe token-info <tokenAddress>`.
3. Stop if the returned `phase` is `graduated`.
4. Run `basememe quote-buy` or `basememe quote-sell`.
5. Present the transaction summary and request explicit confirmation.
6. Run `basememe buy` or `basememe sell`.
7. Return the CLI JSON fields directly, especially `txHash`, `phase`, and receipt status.

Example flow for token creation:

1. Collect `name`, `symbol`, and `image`.
2. Ask which collateral pair the user wants: `ETH`, `USDC`, or `SOL`.
3. Ask whether the user wants standard creation or dynamic settings such as `target-raise`, vesting, or `buy-amount`.
4. Validate that `bonding-curve-pct + vesting-pct + 20 = 100`.
5. Present the create summary and request explicit confirmation.
6. Run `basememe create ...`.
7. Return the JSON result including `tokenAddress`, `transactionHash`, `mode`, `pair`, and `buyAmount`.

## Phase awareness

Use `basememe token-info` as the phase gate before trading.

| Phase | Meaning | Agent action |
|-------|---------|--------------|
| `curve` | Bonding-curve market is active | Quote and trade normally |
| `graduated` | Curve trading has stopped and migration is pending or in progress | Do not trade; explain the token is between curve and DEX routing |
| `dex` | Liquidity has migrated and DEX routing is active | Quote/trade through the DEX-aware helper path |

Important details:

- `token-info` derives the phase from on-chain curve state and returns `isGraduated` and `isMigrated`.
- `buy` and `sell` already switch between curve and DEX helper methods based on the quote result. The agent should still inspect phase first and explain what path is expected.
- Do not attempt to reason around a `graduated` state by guessing that migration has completed. Re-check with `token-info` if the user wants to try again later.

Detailed phase notes live in [references/token-phases.md](references/token-phases.md).

## Structured error contract

Every CLI command emits a JSON envelope on stdout (success path) or stderr (failure path). On failure, the JSON shape is:

```json
{
  "success": false,
  "error": "human-readable message",
  "code": "RECEIPT_TIMEOUT",
  "txHash": "0x…64 hex chars…",
  "txLabel": "buy|sell|approve|allowance-reset|permit2-approve"
}
```

Stable, programmatic codes (whitelist · viem's internal RPC error codes are NOT forwarded):

| `code` | Meaning | Recovery |
|---|---|---|
| `RECEIPT_TIMEOUT` | viem's `waitForTransactionReceipt` exceeded its window. The tx **may still mine** — never resubmit blindly. | Poll `getTransactionReceipt(txHash)` with your own deadline. If the receipt comes back with `status: 'success'`, treat the original action as complete. |

`txLabel` identifies which step in the trade pipeline timed out (`approve`/`allowance-reset` = idempotent intermediate; `buy`/`sell` = the user-facing action that must not be re-submitted without first checking the on-chain state).

## Common setup issues

Use [references/errors.md](references/errors.md) for setup failures such as:

- missing `PRIVATE_KEY`
- invalid addresses or amounts
- unsupported pair values
- graduated or non-transferable token states
- API upload failures
- transaction reverts

## References

Read the reference files only when they are needed:

- [references/create-flow.md](references/create-flow.md): full launch parameter model, validation rules, pair templates, and dynamic creation behavior
- [references/trade-flow.md](references/trade-flow.md): quote and execution flow, helper routing, and ETH-vs-collateral behavior
- [references/token-phases.md](references/token-phases.md): lifecycle guidance for `curve`, `graduated`, and `dex`
- [references/contract-addresses.md](references/contract-addresses.md): current chain addresses and collateral templates from this repo
- [references/errors.md](references/errors.md): common CLI failures and how to respond
