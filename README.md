# @basememe/ai — Basememe AI CLI & Agent Skill

> Official publish repo: https://github.com/base-meme/agentic
>
> **Security warning:** `basememe` runs against Base mainnet and signs real transactions with real money. Keep `PRIVATE_KEY` local, use a dedicated wallet, verify token addresses before every trade, and treat every write command as irreversible unless the chain reverts it.

`@basememe/ai` is the Basememe CLI, OpenClaw plugin, and agent skill for creating and trading meme tokens on Basememe on the Base chain.

The package ships three layers:

- `basememe` CLI for terminal use
- `openclaw.plugin.json` and `plugin.ts` for OpenClaw installation
- `skills/basememe-integration` for agent-guided Basememe workflows

All `basememe` commands return JSON. The `basememe` CLI loads `.env` from the current working directory before executing a `basememe` command.

**Requirements:** Node.js 18+.

## Installation

### Global CLI

```bash
npm install -g @basememe/ai@latest
basememe --help
```

### Clone and run locally

```bash
git clone https://github.com/base-meme/agentic.git
cd agentic
npm install
npx basememe --help
```

### OpenClaw plugin

```bash
openclaw plugins install @basememe/ai
```

## Environment Configuration

Required:

- `PRIVATE_KEY`: signer key for write commands such as `basememe buy`, `basememe sell`, `basememe send`, `basememe create`, and `basememe 8004-register`

Optional:

- `BASE_RPC_URL`: Base RPC endpoint. Default: `https://mainnet.base.org`
- `BASEMEME_RECEIPT_TIMEOUT_MS`: integer (ms). Override viem's default `waitForTransactionReceipt` timeout (≈180s on Base). Useful when a network is slow or the sequencer is intermittently batching tx — viem's default may fire too early. On timeout, the CLI throws a structured error with `{code: 'RECEIPT_TIMEOUT', txHash, txLabel}` so a wrapper can poll the in-flight hash with its own deadline instead of resubmitting (which would double-execute the same on-chain action). Unset → viem default applies.

Example `.env`:

```bash
PRIVATE_KEY=your_private_key_here
BASE_RPC_URL=https://mainnet.base.org
```

Shell export example:

```bash
export PRIVATE_KEY=your_private_key_here
export BASE_RPC_URL=https://mainnet.base.org
basememe verify
```

### OpenClaw config example

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

## Quick Start

1. Verify your Basememe setup and Base connectivity:

```bash
basememe verify
```

2. Discover recent Basememe launches:

```bash
basememe token-list --sort newest --limit 5
```

3. Quote a Basememe buy before trading:

```bash
basememe quote-buy 0xTokenAddress 0.01
```

Useful follow-ups:

```bash
basememe token-info 0xTokenAddress
basememe buy 0xTokenAddress 0.01 --slippage 500
basememe sell 0xTokenAddress 1000000 --slippage 500
basememe create --name "My Token" --symbol "MTK" --image ./logo.png --pair ETH
```

## Command Reference

### Read-only commands

| Command | Purpose |
|---------|---------|
| `basememe config` | Show active chain, RPC, API URL, and contract addresses |
| `basememe verify` | Check Basememe RPC, API, contracts, and optional wallet connectivity |
| `basememe token-info <tokenAddress>` | Read on-chain Basememe token state and phase (tax-aware) |
| `basememe token-get <tokenAddress>` | Fetch Basememe API token detail and trade data |
| `basememe token-list [--sort <sort>] [--kw <keyword>] [--offset <n>] [--limit <n>]` | List Basememe tokens from the API |
| `basememe rankings <orderBy> [--limit <n>]` | Fetch Basememe leaderboard slices |
| `basememe quote-buy <tokenAddress> <ethAmount> [--slippage <bps>]` | Quote ETH-to-token output (tax-aware) |
| `basememe quote-sell <tokenAddress> <tokenAmount> [--slippage <bps>]` | Quote token-to-ETH output (tax-aware) |
| `basememe events [fromBlock] [--toBlock <block>] [--chunk <n>]` | Read Basememe factory events |
| `basememe tax-info <tokenAddress>` | Tax token metadata: tax rate, processor splits, mainPool, dividendContract, pool state |
| `basememe dividend-info <tokenAddress> [--user <address>]` | Per-user dividend balance (withdrawable + withdrawn) for a tax token |
| `basememe vault-info <tokenAddress>` | Detect vault type (split / snowball / burn-dividend / gift) attached to a tax token + per-user share |

### Write commands

| Command | Purpose |
|---------|---------|
| `basememe buy <tokenAddress> <ethAmount> [--slippage <bps>]` | Buy a Basememe token with ETH (tax-aware routing) |
| `basememe sell <tokenAddress> <tokenAmount> [--slippage <bps>]` | Sell a Basememe token for ETH (tax-aware routing) |
| `basememe send <toAddress> <amount> [--token <tokenAddress>]` | Send ETH or ERC20 tokens on Base |
| `basememe create --name <name> --symbol <symbol> --image <path> [options]` | Create a Basememe token (V4 standard or tax token via `--tax-rate`) |
| `basememe dividend-claim <tokenAddress>` | Claim accrued dividends from a tax token's dividend contract |
| `basememe vault-claim <tokenAddress>` | Claim split-vault share for the caller |
| `basememe vault-burn <tokenAddress> <amount>` | Burn tokens to register a stake in a burn-dividend vault |
| `basememe vault-claim-reward <tokenAddress> [--to <address>]` | Claim snowball / burn-dividend / gift vault reward |
| `basememe gift-proof-submit <tokenAddress> <tweetId>` | Submit an X (Twitter) tweet ID as a gift-vault Merkle proof |

### Utility commands

| Command | Purpose |
|---------|---------|
| `basememe 8004-register <name> [--image <url>] [--description <text>]` | Mint an ERC-8004 identity NFT |
| `basememe 8004-balance [address]` | Check ERC-8004 identity NFT balance |

## Create Command Notes

The `basememe create` command always requires:

- `--name <name>`
- `--symbol <symbol>`
- `--image <path>`

Supported collateral pairs:

| Pair | Type | Notes |
|------|------|-------|
| `ETH` | Native | Default Basememe pair on Base |
| `USDC` | ERC20 | Uses the Base native USDC collateral template |
| `SOL` | ERC20 | Uses the Basememe SOL collateral template |

Common optional flags:

- `--description <text>`
- `--website <url>`
- `--twitter <handle>`
- `--telegram <handle>`
- `--pair <ETH|USDC|SOL>`
- `--target-raise <amount>`
- `--bonding-curve-pct <pct>`
- `--vesting-pct <pct>`
- `--vesting-duration <value>`
- `--cliff-duration <value>`
- `--vesting-recipient <address>`
- `--buy-amount <amount>`

Tax token flags (route to the tax factory; standard create otherwise):

- `--tax-rate <1|2|3|5>` — transfer tax percent. Presence of this flag opts the create into the tax factory (`coin_version >= 11.2.0`).
- `--funds-bps <bps>` — bps share of collected tax routed to the funds recipient (or vault if attached). Sum of all four `*-bps` flags must equal `10000`.
- `--burn-bps <bps>` — bps share routed to deflation (buyback & burn).
- `--dividend-bps <bps>` — bps share routed to the per-token dividend contract for holder distribution.
- `--liquidity-bps <bps>` — bps share routed to LP top-up on the graduated Uniswap V2 pool.
- `--market-mode <evm|vault>` — `evm` sends the funds-recipient share to a wallet; `vault` deploys a vault contract.
- `--market-recipient <address>` — required when `--market-mode evm`.
- `--vault-type <split|snowball|burn-dividend|gift>` — required when `--market-mode vault`. See [Tax Tokens](#tax-tokens) below.
- `--split-recipients <addr1,bps1;addr2,bps2;...>` — required for `--vault-type split`. Up to 10 recipients, sum of bps = `10000`.
- `--gift-x-handle <handle>` — required for `--vault-type gift`. The X (Twitter) handle that controls the vault.

## Tax Tokens

Tax tokens (`coin_version >= 11.2.0`) are a separate factory deployment that supports a creator-defined transfer/trade tax on top of the standard 1% platform fee. They graduate to **Uniswap V2** instead of V4.

When a tax is collected, the on-chain `TaxProcessor` distributes it across up to four channels based on the bps split fixed at creation:

| Channel | What it does |
|---------|--------------|
| Funds Recipient | Sent directly to a wallet, or to an attached **Vault** strategy contract. |
| Holder Dividend | Proportional distribution to all holders via the per-token `Dividend` contract. Claim with `basememe dividend-claim`. |
| Token Burn | Buyback on Uniswap V2 and burn to the dead address. |
| Add to Liquidity | Routed back into the Uniswap V2 pool. |

### Vault strategies

Attaching a vault to the **Funds Recipient** channel automates how that share is used:

| Vault | Strategy | Inspect with | Claim with |
|-------|----------|--------------|------------|
| **Split** | Distributes among up to 10 recipients by configured bps | `vault-info` | `vault-claim` |
| **SnowBall** | All revenue used for continuous buyback & burn | `vault-info` | `vault-claim-reward` |
| **BurnDividend** | First phase = buyback & burn. After the first user burn, switches to a dividend model where burners earn proportional share of future tax | `vault-info` | `vault-burn` then `vault-claim-reward` |
| **Gift** | A designated X (Twitter) handle directs the revenue to any wallet via tweet. Falls back to SnowBall if the handle goes 7 days without a valid tweet. | `vault-info` | `gift-proof-submit` then `vault-claim-reward` |

### Tax read commands

```bash
basememe tax-info 0xTaxToken             # tax rate / 4-channel split / processor / dividend contract
basememe dividend-info 0xTaxToken --user 0xWallet   # withdrawable + withdrawn for a holder
basememe vault-info 0xTaxToken           # vault type + per-user share / shares
```

### Tax write commands

```bash
basememe dividend-claim 0xTaxToken                  # claim my dividends
basememe vault-claim 0xTaxToken                     # split-vault claim
basememe vault-burn 0xTaxToken 1000                 # burn 1000 tokens to stake in burn-dividend vault
basememe vault-claim-reward 0xTaxToken              # claim snowball/burn-dividend/gift reward
basememe gift-proof-submit 0xTaxToken 1234567890123 # submit a tweet ID as gift-vault X-proof
```

### Tax create example

```bash
basememe create \
  --name "Coin" --symbol "CON" --image ./logo.png \
  --pair ETH \
  --tax-rate 5 \
  --funds-bps 4000 --burn-bps 2000 --dividend-bps 2000 --liquidity-bps 2000 \
  --market-mode evm --market-recipient 0xCreator
```

Or with a vault attached to the funds recipient channel:

```bash
basememe create \
  --name "SnowBall Coin" --symbol "SNOW" --image ./logo.png \
  --pair ETH --tax-rate 3 \
  --funds-bps 4000 --burn-bps 2000 --dividend-bps 2000 --liquidity-bps 2000 \
  --market-mode vault --vault-type snowball
```

> Vault selection requires **ETH** as the payment token. Tax token parameters are immutable after creation.

For a deeper end-to-end walkthrough see the [SKILL.md](skills/basememe-integration/SKILL.md) and the references under [skills/basememe-integration/references/](skills/basememe-integration/references/).

## Basememe Workflow

Recommended Basememe flow:

1. `basememe verify`
2. `basememe token-list --sort newest`
3. `basememe token-info 0xTokenAddress`
4. `basememe quote-buy 0xTokenAddress 0.01`
5. `basememe buy 0xTokenAddress 0.01 --slippage 500`

For agent usage, see [skills/basememe-integration/SKILL.md](skills/basememe-integration/SKILL.md).

## Troubleshooting

Common Basememe issues:

- `PRIVATE_KEY environment variable is required for this command.`: set `PRIVATE_KEY` in `.env` or your shell
- `Unsupported pair`: use `ETH`, `USDC`, or `SOL`
- `Token is in graduated state`: re-check later with `basememe token-info`
- `Token is in bonding curve phase — transfers are restricted until graduation`: use `basememe sell` instead of `basememe send`
- RPC failures: set `BASE_RPC_URL` explicitly and rerun `basememe verify`
- API failures: check Basememe service availability and rerun `basememe verify`

Detailed error guidance lives in [skills/basememe-integration/references/errors.md](skills/basememe-integration/references/errors.md).
