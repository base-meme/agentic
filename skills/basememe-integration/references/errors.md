# Common Errors

This file maps current Basememe CLI errors to likely causes and agent responses.

## Environment and setup

### `PRIVATE_KEY environment variable is required for this command.`

Cause:

- the user tried to run a write command without `PRIVATE_KEY`

Response:

- stop
- explain that write operations require a signer wallet
- ask the user to configure `PRIVATE_KEY` in the active skill env or local `.env`

### `PRIVATE_KEY must be a 64-character hex string (with or without 0x prefix).`

Cause:

- the configured signer key is malformed

Response:

- correct the key format before retrying

### `Unsupported chain ID: ...`

Cause:

- `BASEMEME_CHAIN_ID` is set to an unsupported value

Response:

- use Base mainnet chain ID `8453`

### `Unsupported pair: ...`

Cause:

- `create --pair` used an unsupported value

Response:

- choose one of `ETH`, `USDC`, or `SOL`

## Quote and trade errors

### `Amount must be greater than 0`

Cause:

- the buy or sell amount was zero or negative

Response:

- ask for a positive amount

### `Invalid slippage bps: ...`

### `Slippage bps must be between 0 and 10000. Received: ...`

Cause:

- the `--slippage` value was invalid

Response:

- ask for an integer basis-point value such as `500`

### `Quoted minimum output is 0. Trade would result in no output.`

Cause:

- the quoted trade would produce no usable minimum output

Response:

- stop
- re-check amount, slippage, and token state

### `Unsupported coin_version ...`

Cause:

- the token metadata reports a version the CLI does not support

Response:

- explain that the current Basememe CLI does not support that token version
- do not guess a manual route

### `Token info not found for ...`

### `Token ... not found in API response`

### `Token mismatch: requested ..., got ...`

Cause:

- the Basememe API could not resolve the token cleanly

Response:

- verify the token address
- retry `basememe token-get` or `basememe token-info`
- if the token is newly created, explain that indexing may still be catching up

## Phase and transfer errors

### `No BondingCurve found for token ...`

Cause:

- the token does not resolve to a Basememe bonding curve

Response:

- verify the token address
- confirm the token exists on Base mainnet

### `Token is in graduated state (migration pending). Trading is temporarily unavailable. Re-check with 'basememe token-info' later.`

Cause:

- the market is between curve trading and full DEX trading

Response:

- stop
- do not trade
- tell the user to re-check with `basememe token-info`

### `Token is in bonding curve phase — transfers are restricted until graduation. Use "sell" to exit your position instead.`

Cause:

- the user tried `basememe send --token ...` before token transfers were unlocked

Response:

- stop
- explain that curve-phase transfers are restricted
- suggest `basememe sell` if the user is trying to exit

### `Invalid recipient address: ...`

### `Invalid token address: ...`

### `Invalid address: ...`

Cause:

- the provided address is malformed

Response:

- require a valid `0x` address

### `Invalid amount: ... Must be a positive number.`

Cause:

- the transfer amount is invalid

Response:

- ask for a positive numeric amount

## Create validation errors

### `Image not found: ...`

Cause:

- the image path given to `create` does not exist from the current working directory

Response:

- correct the path before retrying

### `--name max 32 chars`

### `--symbol max 15 chars`

Cause:

- token metadata exceeds current limits

Response:

- shorten the name or symbol

### `--bonding-curve-pct must be 50-80`

### `--vesting-pct must be 0-30`

### `bonding(...) + vesting(...) + migration(20) must = 100`

Cause:

- the creation allocation math is invalid

Response:

- adjust curve and vesting percentages so the total plus migration share equals `100`

### `Invalid --vesting-recipient address: ...`

Cause:

- the vesting recipient is not a valid address

Response:

- provide a valid Base address

### `Target raise out of range. Min: ..., Max: ..., Got: ...`

Cause:

- `--target-raise` is outside the allowed range for the selected pair

Response:

- choose a value within range or omit it to use the template default

### `Invalid --buy-amount: "..."`

Cause:

- the first-buy amount is malformed or negative

Response:

- provide a valid non-negative amount

## Tax token errors

Tax tokens (`coin_version >= 11.2.0`) introduce a separate set of validation and on-chain reverts. These appear when calling `basememe create --tax-rate`, `basememe vault-*`, `basememe dividend-*`, `basememe gift-proof-submit`, or when buying/selling tax tokens.

### Tax create validation

| Error | Likely cause |
|-------|--------------|
| `--tax-rate must be one of 1|2|3|5` | CLI accepts only those four discrete tax percent values. |
| `*-bps flags must sum to exactly 10000` | The four channel splits (funds / burn / dividend / liquidity) must total 100%. |
| `--market-mode vault requires --pair ETH` | Vault mode is enforced native-collateral by the tax factory. |
| `--vault-type required when --market-mode vault` | Pick one of `split` / `snowball` / `burn-dividend` / `gift`. |
| `--split-recipients required for split vault` | Provide `addr1,bps1;addr2,bps2;...` with up to 10 entries summing to `10000`. |
| `--gift-x-handle required for gift vault` | Provide the X handle without the leading `@`. |

### Tax create on-chain reverts

| Revert | Meaning |
|--------|---------|
| `MarketVaultRequiresTaxToken` | The factory enforces vault attachment only on tax tokens. |
| `MarketVaultRequiresNativeCollateral` | Vault attachment requires `--pair ETH`. |
| `MarketVaultRequiresMarketBps` | `--funds-bps` cannot be `0` when a vault is attached. |
| `MarketVaultDataMissing` | Internal: vault constructor data was empty. |
| `MarketVaultFactoryDisabled(<addr>)` | The chosen vault factory was paused on-chain. Re-check `basememe config`. |
| `LockBpsOutOfRange` | `--vesting-pct` must be ≤ `30`. |
| `TooManyRecipients` | Split vault accepts a maximum of 10 recipients. |

### Tax token read errors

| Error | Likely cause |
|-------|--------------|
| `Not a tax token (<addr>): coin_version <X> < 11.2.0` | `basememe tax-info` / `dividend-info` / `vault-info` only accept tax tokens. Use `basememe token-info` to confirm `coinVersion`. |
| `Dividend contract not configured` | The token's `--dividend-bps` was `0` at creation, so no per-token dividend contract was deployed. |
| `No vault attached to this tax token` | `basememe vault-info` returned without a vault entry. The token was created with `--market-mode evm`. |

### Tax write errors

| Error | Likely cause |
|-------|--------------|
| `eligible: false` from `dividend-info` | The user has no withdrawable balance. `dividend-claim` will revert. |
| `Caller is not a recipient of this split vault` | `vault-claim` requires the caller's address to be in the split-recipients list. Use `--for <address>` to claim on behalf of a recipient. |
| `Vault already in dividend mode` | `vault-burn` against a `BurnDividend` vault is allowed in either mode, but the auto-buyback path only runs in `Buyback` mode. |
| `Gift vault timeout — falling back to snowball` | The X handle didn't post a valid management tweet within 7 days. Vault is now `Fallback (SnowBall)` and `gift-proof-submit` will no longer route revenue. |
| `XProof verification failed` | The signed Merkle proof from the X-oracle didn't validate. Re-run with the latest tweet ID; oracle key is `0xc8400f...`. |

### Tax-aware buy/sell

`buy` and `sell` against a tax token route through the tax factory automatically. Common errors mostly reuse the V4 messages, but note:

- `InsufficientFirstBuyFee` may surface on the **first ever buy** of a token (V4 or tax) when `<ethAmount>` is below the on-chain first-buy fee (`0.0015 ETH` on Base). Increase the amount.
- `InsufficientOutputAmount` on a tax token usually means the user-defined transfer/trade tax wasn't accounted for in the quote. The CLI's `quote-buy` and `quote-sell` already include the tax — only re-quote and try again if the trade was skipping the quote step.

## Network and backend errors

### `IPFS upload failed: ...`

Cause:

- metadata upload to the Basememe backend failed

Response:

- retry later
- confirm the Basememe API is reachable from your network

### `Transaction reverted`

### `Transaction reverted (tx: ...)`

Cause:

- the write transaction reverted on-chain

Response:

- surface the transaction hash
- inspect inputs, phase, approvals, and network before retrying
