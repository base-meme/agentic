# Create Flow

This reference documents the current `basememe create` command. Always execute through the published CLI, not ad hoc scripts.

## Required inputs

The command requires:

- `--name <name>`
- `--symbol <symbol>`
- `--image <path>`

The image path is resolved from the current working directory. If the file does not exist, the CLI fails with `Image not found: ...`.

## Standard creation

Minimal example:

```bash
basememe create \
  --name "My Token" \
  --symbol "MTK" \
  --image ./logo.png
```

Useful optional metadata:

- `--description <text>`
- `--website <url>`
- `--twitter <handle>`
- `--telegram <handle>`
- `--pair <type>` where `type` is `ETH`, `USDC`, or `SOL`

Default pair is `ETH`.

## Dynamic creation

The Basememe CLI supports both standard and dynamic create routes.

The command selects one of these factory functions:

- `createBasememeTokenWithCollateral`
- `createBasememeTokenAndBuyWithCollateral`
- `createBasememeTokenDynamicWithCollateral`
- `createBasememeTokenDynamicAndBuyWithCollateral`

The dynamic route is used when either of these is true:

- `--target-raise` is provided
- `--vesting-pct` is greater than `0`

The buy-and-create route is used when `--buy-amount` is greater than `0`.

## Bonding curve and vesting rules

The CLI enforces:

- `--bonding-curve-pct` must be between `50` and `80`
- `--vesting-pct` must be between `0` and `30`
- `bonding-curve-pct + vesting-pct + 20 = 100`

That fixed `20` is the migration allocation used by current Basememe factory logic.

Optional vesting fields:

- `--vesting-duration <value>`
- `--cliff-duration <value>`
- `--vesting-recipient <address>`

Duration parsing:

- `6m` means 6 months
- `90d` means 90 days
- `1y` means 1 year
- plain numbers are interpreted as days

## Collateral pairs

Current pair templates come from `src/lib/chain-configs.js`.

| Pair | Collateral token | Decimals | Default target raise |
|------|------------------|----------|----------------------|
| `ETH` | native `0x0000000000000000000000000000000000000000` | `18` | `2.5` |
| `USDC` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `6` | `8000` |
| `SOL` | `0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82` | `9` | `64` |

If `--target-raise` is omitted, the template default is used. If the user provides `--target-raise`, the CLI validates it against the selected template:

- minimum: default target raise divided by `2`
- maximum: default target raise multiplied by `100`

## Optional first buy

`--buy-amount <amount>` performs a first buy during token creation.

Behavior:

- if the pair is native `ETH`, the create transaction sends the buy amount as transaction `value`
- if the pair is `USDC` or `SOL`, the CLI checks allowance and may reset approval to `0` before approving the new amount
- if approval fails, the create command aborts before the factory transaction

## Execution sequence

Current implementation flow:

1. validate CLI input locally
2. upload token metadata and image to the Basememe backend
3. build create params from the selected pair and options
4. optionally approve collateral for `USDC` or `SOL` first-buy flows
5. send the Basememe factory transaction
6. wait for the receipt
7. parse `NewBasememeToken` from logs
8. notify the backend with the transaction ID

## Operator checklist

Before running `basememe create`, confirm:

- correct network: Base mainnet, chain ID `8453`
- correct pair: `ETH`, `USDC`, or `SOL`
- image exists on disk
- `bonding-curve-pct + vesting-pct + 20 = 100`
- recipient addresses are valid
- create summary has been shown and explicitly approved by the user

## Tax token creation

When `--tax-rate <pct>` is set, the CLI routes to the **tax factory** (`coin_version 11.2.0+`) instead of the V4 factory. Tax tokens graduate to Uniswap V2 and support an on-token transfer/trade tax with a 4-channel distribution split.

### Required when `--tax-rate` is set

- `--tax-rate <1|2|3|5>` — transfer tax percent (only these four discrete values are accepted to keep dispatch math clean)
- `--funds-bps <bps>` — share routed to the funds-recipient (or a vault if `--market-mode vault`)
- `--burn-bps <bps>` — share routed to deflation (buyback & burn on V2)
- `--dividend-bps <bps>` — share routed to the per-token dividend contract for holder distribution
- `--liquidity-bps <bps>` — share routed back into the V2 LP

The four `*-bps` values **must sum to `10000`** (= 100% of the dispatched tax). The CLI rejects any other total before submitting the transaction.

### Funds recipient: wallet vs vault

- `--market-mode evm` + `--market-recipient <address>` → tax funds-recipient share is sent directly to the wallet at every dispatch.
- `--market-mode vault` + `--vault-type <split|snowball|burn-dividend|gift>` → a vault contract is deployed and receives the funds-recipient share. The vault then implements the strategy automatically. **Vault mode requires `--pair ETH`** (the tax factory enforces native-collateral on vault attachment).

### Vault-specific flags

| Vault | Extra flag | Notes |
|-------|------------|-------|
| `split` | `--split-recipients <addr1,bps1;addr2,bps2;...>` | Up to 10 recipients, sum of bps = `10000`. Recipients and shares are immutable. |
| `snowball` | (none) | All funds-recipient share is used for buyback & burn, no extra config. |
| `burn-dividend` | (none) | Auto-buyback at `0.025 ETH` accumulation; switches to dividend mode on the first user `vault-burn`. |
| `gift` | `--gift-x-handle <handle>` | The X (Twitter) handle that controls the vault. Must post a valid management tweet at least once every 7 days; otherwise the vault falls back to snowball. |

### Tax create example

Wallet recipient (no vault):

```bash
basememe create \
  --name "Coin" --symbol "CON" --image ./logo.png \
  --pair ETH \
  --tax-rate 5 \
  --funds-bps 4000 --burn-bps 2000 --dividend-bps 2000 --liquidity-bps 2000 \
  --market-mode evm --market-recipient 0xCreator
```

Snowball vault attached:

```bash
basememe create \
  --name "Snow" --symbol "SNOW" --image ./logo.png \
  --pair ETH --tax-rate 3 \
  --funds-bps 4000 --burn-bps 2000 --dividend-bps 2000 --liquidity-bps 2000 \
  --market-mode vault --vault-type snowball
```

Split vault with two recipients (60% / 40%):

```bash
basememe create \
  --name "Split" --symbol "SPLIT" --image ./logo.png \
  --pair ETH --tax-rate 2 \
  --funds-bps 4000 --burn-bps 2000 --dividend-bps 2000 --liquidity-bps 2000 \
  --market-mode vault --vault-type split \
  --split-recipients 0xAlice,6000;0xBob,4000
```

Gift vault tied to an X handle:

```bash
basememe create \
  --name "Gift" --symbol "GIFT" --image ./logo.png \
  --pair ETH --tax-rate 1 \
  --funds-bps 4000 --burn-bps 2000 --dividend-bps 2000 --liquidity-bps 2000 \
  --market-mode vault --vault-type gift \
  --gift-x-handle alice
```

### Tax create execution sequence

1. validate CLI input locally (the four `*-bps` sum, `--tax-rate` discrete value, vault-mode requires ETH pair, etc.)
2. validate `bonding-curve-pct + vesting-pct + 20 = 100` (same as standard create)
3. upload token metadata and image to the Basememe backend
4. build tax-create params (24-field struct including the bps split and optional vault config)
5. call `basememeTaxFactory.createBasememeTaxFactoryToken*` (the tax factory mirrors V4's selector shape)
6. parse the `NewBasememeToken` log via `basememeTaxFactoryEvents`
7. notify the backend with the transaction ID

### Tax create operator checklist

In addition to the standard checklist above:

- four `*-bps` flags sum to exactly `10000`
- `--tax-rate` is one of `1|2|3|5`
- `--market-mode vault` only with `--pair ETH`
- `--split-recipients` sum to `10000` and ≤ 10 entries
- `--gift-x-handle` is the X username **without** the leading `@`
- tax token parameters are immutable after creation — emphasize this in the user confirmation prompt
