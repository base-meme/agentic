# Contract Addresses (Base Mainnet)

This file mirrors the current addresses embedded in the Basememe CLI. Treat it as a human reference. Runtime calls use the addresses shipped in `src/lib/contracts.js` and `src/lib/chain-configs.js`.

## Network

| Field | Value |
|-------|-------|
| Chain | Base mainnet |
| Chain ID | `8453` |
| Default RPC | `https://mainnet.base.org` |
| Default API | `https://tapi.base.meme/` |
| Native asset | `ETH` |

## Core contracts

| Contract | Address |
|----------|---------|
| `basememeFactory` | `0xC0599137dbF994d238f68e96CA0AfaddeE57Af1B` |
| `basememeFactoryImpl` | `0x560bAAF627b58bA34e68b88Ae562b192119b6C03` |
| `basememeFactoryTradeHelper` | `0xBd6bc115a8c944305b341f294c57F4eB44C1E2F4` |
| `bondingCurveImpl` | `0xB10059567fA4538b80525442dF8881602a6c86a8` |
| `basememeTokenSwap` | `0x2c8E47a09196505Dbc96229510A4B9ff91a8534b` |
| `basememeTokenImplementation` | `0xBbD5C86CcFAD9914B269647f80aD829D2cfA406e` |
| `ERC8004_NFT_ADDRESS` | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |

## DEX and router addresses

| Contract | Address |
|----------|---------|
| `WETH` | `0x4200000000000000000000000000000000000006` |
| `UNISWAP_V2_ROUTER` | `0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24` |
| `QUOTER_V2` | `0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a` |
| `SWAP_ROUTER_V2` | `0x2626664c2603336E57B271c5C0b26F421741e481` |
| `V4_POOL_MANAGER` | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| `V4_POSITION_MANAGER` | `0x7C5f5A4bBd8fD63184577525326123B519429bDc` |
| `QUOTER_V4` | `0x0d5e0F971ED27FBfF6c2837bf31316121532048D` |
| `PERMIT2` | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| `UNIVERSAL_ROUTER` | `0x6fF5693b99212Da76ad316178A184AB56D299b43` |

## Current collateral templates

| Pair | Address | Decimals | Default target raise |
|------|---------|----------|----------------------|
| `ETH` | `0x0000000000000000000000000000000000000000` | `18` | `2.5 ETH` |
| `USDC` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `6` | `8000 USDC` |
| `SOL` | `0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82` | `9` | `64 SOL` |

## Tax token contracts

Tax tokens (`coin_version >= 11.2.0`) ship through a separate factory deployment that lives alongside the V4 stack. The CLI routes by `coin_version` via `getAddressesForTrade()`; tax tokens read `taxAddresses[chainId]` from `src/lib/tax-abis.js`.

| Contract | Address |
|----------|---------|
| `basememeTaxFactory` (proxy) | `0xc5fdff6b45A3A5cEF7E72Edf98EC1b0Bc6f388Dd` |
| `basememeTaxFactoryImpl` | `0xf65D825B847fC7945836748Ac44778ec0Df65457` |
| `basememeTaxFactoryTradeHelper` (proxy) | `0x9A76e6e63DDfCf81f3B0eA5465fEE2c4267cbD2b` |
| `bondingCurveImpl` (tax) | `0x5165f54f015E9BD0be61508411c26eAC61f53E96` |
| `basememeTaxToken` (impl) | `0x5F5Fa2c25448a8a047FEDB872a10502A85d87D21` |
| `basememeTaxFactoryToken` (V4-style impl reused by tax factory) | `0xe9E7a1e6ac04ac53511642297818CcaDea9eE143` |
| `taxProcessor` (impl) | `0xdFbf27Fe18b213938eBf4DC613d51152C6490754` |
| `dividend` (impl) | `0xADd3C7394EF15B929856C8A629d6675269ECE850` |
| `basememeMultiDexRouter` | `0x0a17BA18E8Dee6D9a3063B7b79DF295BE3985dec` |

Reused from the V4 deployment (per migration plan §1.6 — same selector surface):

| Contract | Address |
|----------|---------|
| `basememeTaxTokenSwap` (= V4 `basememeTokenSwap`) | `0x2c8E47a09196505Dbc96229510A4B9ff91a8534b` |
| `basememeLockVault` (= V4) | `0x856ED1d2A2401927A4653cd2399cF16eBB1C6fBC` |

### Vault factories

Each vault flavor is a separate factory; `basememe vault-info` detects which one (if any) is attached to a tax token.

| Vault | Factory | Implementation |
|-------|---------|----------------|
| Split | `0x7a74745b49a8401fAe853aa06c2371273161F719` | `0xeF5dbEfD7b9d943b058F2115E511A6Dcae28bf3a` |
| SnowBall | `0x67DD5585bb8d5DC81bccEd0dC3f5E39E43c6ad1B` | `0x65724Ef035D6AB02E33D0c53f5E87e53b2fEbBA2` |
| BurnDividend | `0x4CDf43ba52A76fD3Cf2b241955D25B2Ca00979C1` | `0xefE1a7289ac38d3865e2F0615A47f7c4e73254E3` |
| Gift | `0xC2D72baD33aE74Ff7A53cB8DA06B64cBA4cc00B6` | `0xb829B3975F927B213b092fFbc499b9FB65F0b701` |

### Tax-side keepers and oracles

| Role | Address | Notes |
|------|---------|-------|
| `vaultKeeper` | `0x80eee0ff145bd4e65b6fe501b7239253d70fe753` | Multisig EOA shared by 4 keeper crons (tax-dispatch, vault-keeper, gift-vault-keeper, gift-vault-snowball) |
| `xOracleKey` | `0xc8400f41f9FF400Cb1c439E0ae129A554a579F99` | Address that signs Gift vault X-proof verifications |

## Version notes

- Basememe `coin_version` values in the `1.x` line route through the Uniswap V3 path.
- Basememe `coin_version` values in the `2.x` line route through the Uniswap V4 path.
- Basememe `coin_version` values **>= `11.2.0`** route through the **tax factory + Uniswap V2 graduation** path. The single classifier is `shouldUseTaxFactory(coinVersion)` in `src/lib/version.js`.
- Dynamic collateral templates are active for current `2.1.x`, `2.2.x`, and `11.2.x` Basememe creation flows.
