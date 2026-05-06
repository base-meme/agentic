# Trade Flow

This reference describes how the Basememe CLI quotes and executes trades. Always use the published commands:

- `basememe quote-buy`
- `basememe quote-sell`
- `basememe buy`
- `basememe sell`

## Recommended sequence

1. `basememe token-info <token>`
2. `basememe token-get <token>` if API detail is useful
3. `basememe quote-buy` or `basememe quote-sell`
4. present the quote and transaction summary
5. require explicit confirmation
6. `basememe buy` or `basememe sell`

Do not skip the quote step for agent-guided trading.

## Phase-aware routing

The Basememe CLI routes trades by token phase:

- `curve`: bonding-curve path
- `dex`: DEX path
- `graduated`: stop state, do not trade

For current version routing:

- `coin_version` in the `1.x` line uses the Uniswap V3 route
- `coin_version` in the `2.x` line uses the Uniswap V4 route
- `coin_version` `>= 11.2.0` (tax tokens) uses the **tax factory + Uniswap V2** route — see [Tax-aware routing](#tax-aware-routing) below
- non-native collateral pairs may still use the helper contract path for ETH entry and exit

## Tax-aware routing

Tax tokens (`coin_version >= 11.2.0`) route through a separate factory address and graduate to Uniswap V2 instead of V4. The CLI dispatches automatically; no extra flag is needed by the user.

Internal classifier:

- `getAddressesForTrade(chainId, coinVersion)` in `src/lib/contracts.js` checks `shouldUseTaxFactory(coinVersion)` first.
- When true, it returns `taxAddresses[chainId]` (which contains `basememeTaxFactory`, `basememeTaxFactoryTradeHelper`, etc., plus the shared `UNISWAP_V2_ROUTER`).
- When false, it falls back to V4 (`addresses[chainId]`) or V3 legacy (`legacyTradeAddresses[chainId]`).

Buy/sell behavior:

- `buy` and `sell` execute against `addresses.basememeTaxFactory` for tax tokens, otherwise `addresses.basememeFactory` (V4) or the V3 legacy stack. The same on-chain selector (`buyExactIn`, `sellExactIn`) works because the tax factory mirrors V4's signature shape (HOTFIX #9 alignment).
- The bonding-curve trading fee on tax tokens is **1%** (vs **2%** on V4), split 50% creator / 30% protocol / 10% creator's referrer / 10% trade referrer. Fee accrues independently from the creator-defined transfer/trade tax.
- After graduation to Uniswap V2, the standard 0.3% V2 LP fee accrues to the bonding-curve contract as the LP holder. Base.meme does not collect an extra protocol fee on graduated tax-token trades (V2 does not support protocol fee collection on pool swaps).
- The token-side transfer/trade tax (`--tax-rate <pct>` at create time) is charged independently inside the token contract's `_update` hook and accumulates until `TaxProcessor.dispatch()` runs.

Agent behavior:

- Always run `basememe token-info <token>` before quoting/trading. The returned `coinVersion` tells you which route the CLI will take. There is **no separate command** for tax token trades — `quote-buy` / `quote-sell` / `buy` / `sell` already handle tax routing.
- For tax tokens, also surface `basememe tax-info` so the user sees the current `tax_token_poll_state` and the configured 4-channel split before signing.
- For graduated tax tokens (state `2 / Migrated`), the V2 LP fee shows up as `tradingFee` in the quote; explain that the protocol no longer takes a per-trade fee but the user still pays Uniswap V2's 0.3%.

## Quote output

`quote-buy` and `quote-sell` return structured JSON including:

- `phase`
- `pairType`
- `collateralAddress`
- `expectedOut`
- `minOut`
- `fee`
- `feeAsset`
- base-unit fields such as `expectedOutWei`, `minOutWei`, and `feeWei`

## Slippage

The CLI accepts `--slippage <bps>`.

Rules:

- default is `500`
- minimum is `0`
- maximum is `10000`
- invalid or non-integer input causes an error

## Buy flow

Command:

```bash
basememe buy <tokenAddress> <ethAmount> [--slippage <bps>]
```

Behavior:

1. validate `ethAmount > 0`
2. call `quoteBuy`
3. reject if `phase` is `graduated`
4. reject if the quoted minimum output is `0`
5. choose the curve or DEX path
6. submit the transaction with ETH value
7. wait for the receipt and return JSON

Returned fields include:

- `txHash`
- `action`
- `phase`
- `from`
- `token`
- `ethAmount`
- `expectedTokenOut`
- `minTokenOut`
- `receipt`

## Sell flow

Command:

```bash
basememe sell <tokenAddress> <tokenAmount> [--slippage <bps>]
```

Behavior:

1. validate `tokenAmount > 0`
2. call `quoteSell`
3. reject if `phase` is `graduated`
4. reject if the quoted minimum output is `0`
5. approve the token when needed
6. choose the correct spender and route
7. wait for the receipt and return JSON

Returned fields include:

- `txHash`
- `action`
- `phase`
- `expectedEthOut`
- `minEthOut`
- `receipt`

## Graduated markets

Treat `graduated` as a hard stop:

1. run `basememe token-info`
2. if phase is `graduated`, do not execute a trade
3. explain that curve trading has stopped and migration is still in progress
4. re-check later with `basememe token-info`

## Transfer utility

`basememe send` is not part of the normal Basememe trading flow.

- without `--token`, it sends native `ETH`
- with `--token <tokenAddress>`, it sends ERC20 tokens

Use it only when the user explicitly asks for a transfer.
