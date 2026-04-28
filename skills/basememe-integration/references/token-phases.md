# Token Phases

The Basememe CLI exposes phase awareness through `basememe token-info`.

Current on-chain derivation:

- `curve` if `tradingStopped` is false
- `graduated` if `tradingStopped` is true and `sendingToPairForbidden` is true
- `dex` if `tradingStopped` is true and `sendingToPairForbidden` is false

The command also returns:

- `isGraduated`
- `isMigrated`

## `curve`

Meaning:

- bonding-curve trading is active
- reserves are still managed by the curve market

Agent behavior:

- safe to inspect with `token-info`, `token-get`, and quote commands
- buy and sell may proceed after the user accepts risk and confirms the exact transaction

## `graduated`

Meaning:

- bonding-curve trading has stopped
- liquidity migration is pending or still settling
- the market is not ready for normal agent-executed trading

Agent behavior:

- do not run `buy` or `sell`
- explain that the token is between curve trading and DEX trading
- re-run `basememe token-info` later if the user wants to try again

## `dex`

Meaning:

- liquidity migration is complete
- trades route through the DEX-aware execution path

Agent behavior:

- quote first with `quote-buy` or `quote-sell`
- explain that execution will use the DEX route
- then run `buy` or `sell` after explicit confirmation

## Practical checklist

Before trading:

1. run `basememe token-info <token>`
2. inspect `phase`
3. if `curve`, proceed to quote
4. if `graduated`, stop
5. if `dex`, quote and explain DEX routing

## Tax token pool state

Tax tokens (`coin_version >= 11.2.0`) carry an additional on-chain state machine on the token contract itself, exposed by `basememe tax-info` as `tax_token_poll_state`. This is independent from the bonding-curve `phase` above and tracks the tax-collection lifecycle. Read it whenever the agent might want to claim, dispatch, or trade in/out of the token.

| State value | Name | Meaning |
|-------------|------|---------|
| `0` | `BondingCurve` | Trading happens through the bonding curve. Tax accrues in the token contract. `TaxProcessor.dispatch()` distributes to the four channels when the threshold is reached. |
| `1` | `Liquidating` | Pre-graduation liquidation phase. Tax processing may pause or change shape; do not assume normal dispatch behavior. |
| `2` | `Migrated` | Liquidity has migrated to Uniswap V2. Tax collection continues on token transfers / V2 swaps; the LP fee accrues to the bonding curve as the LP holder. |

Agent behavior:

- Use `basememe tax-info` to read `base.tax_token_poll_state` together with the curve `phase`.
- Tax dispatch is permissionless (anyone can call); the keeper bot at `0x80eee0...` runs it on a schedule. Holders generally do not need to call manually.
- Dividend balance (`basememe dividend-info`) is independent of pool state — claim is callable as long as the per-token dividend contract exists and the holder has a positive `withdrawable`.

## Vault state notes

When a vault is attached to a tax token's funds-recipient channel, `basememe vault-info` returns the vault type plus its own internal state (e.g. BurnDividend's two-phase `Buyback` / `Dividend` lifecycle, Gift vault's `Accumulating` / `Streaming` / `Fallback` machine). Always read `vault-info` before invoking `vault-claim*` / `vault-burn` / `gift-proof-submit` so the agent shows the current state in the confirmation prompt.
