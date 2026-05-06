// Tax-aware trade helpers (pure functions).
//
// 1:1 port from `frontend-basememe/src/utils/tax/tradeEstimation.ts`. We keep
// the exact function signatures so the CLI routing code stays grep-compatible
// with the frontend when chasing a future bug across repos.
//
// CRITICAL design notes (Phase 2 Coordinator spec):
//  - `resolveTradePath(cv)` is a single-value classifier that eliminates the
//    if-else order dependency that bit frontend 7x (PR5-HOTFIX2). Every route
//    decision MUST go through this function, via `switch`, never nested `if`.
//  - `shouldUseUniswapV2(cv)` is a _superset_ of `shouldUseTaxFactory(cv)`
//    (>= 11.0.0 vs >= 11.2.0), so any direct use of `shouldUseUniswapV2` on
//    basememe is a bug waiting to happen. The V2-non-tax slot is unreachable
//    on basememe today; `resolveTradePath` throws on it as a safety net.
//
// Source references (line numbers refer to frontend-basememe):
//   applyTaxBps / isDexTaxFree / computeBondingCurveFeeBps / computeTaxAware*
//     → src/utils/tax/tradeEstimation.ts:39..167
//   7 isDexV2Tax* predicates (1 base + 3 buy + 3 sell)
//     → src/utils/tax/tradeEstimation.ts:173..296
//   resolveTradeHelperForCoin
//     → src/utils/tax/tradeEstimation.ts:127..141

import {
  shouldUseTaxFactory,
  shouldUseUniswapV2,
  shouldUseUniswapV4,
} from './version.js';
import {
  basememeTaxFactoryTradeHelperABI,
  taxAddresses,
} from './tax-abis.js';
import { tradeHelperABI } from './contracts.js';

/**
 * Apply a tax BPS discount on an amount: amount * (1 - taxBps / 10_000).
 *
 * Defensive bounds — matches frontend tradeEstimation.ts:39-43:
 *  - taxBps <= 0    -> identity (clamp negative to noop)
 *  - taxBps >= 10000 -> 0 (100% tax sinks everything)
 *  - otherwise      -> integer floor of the linear discount
 */
export function applyTaxBps(amount, taxRateBps) {
  if (taxRateBps <= 0n) return amount;
  if (taxRateBps >= 10_000n) return 0n;
  return (amount * (10_000n - taxRateBps)) / 10_000n;
}

/**
 * Merge platform fee + tax rate for BC-stage single-parameter curve math.
 * Source: tradeEstimation.ts:91-96.
 */
export function computeBondingCurveFeeBps(platformFeeBps, taxRateBps) {
  return platformFeeBps + taxRateBps;
}

/**
 * DEX-stage tax-free judgment (liquidated state, tax off).
 * Source: tradeEstimation.ts:110-113.
 *
 * `tax_token_poll_state === 4` signals tax has been sunset on-chain
 * (liquidation threshold reached + dividend mode disabled). The BC stage
 * forces `false` regardless of the poll state, so a future DEX-only state
 * can't leak into the BC fee calc.
 *
 * Accepts both number and string poll state (the API serializes inconsistently).
 */
export function isDexTaxFree(coinExtraData, isDexStage) {
  if (!isDexStage) return false;
  return Number(coinExtraData?.tax_token_poll_state ?? 0) === 4;
}

/**
 * DEX-stage buy expected-received on tax token (pool returns full output; the
 * Router -> user hop deducts `taxRateBps`).
 * Source: tradeEstimation.ts:148-153.
 */
export function computeTaxAwareBuyExpected(output, taxRateBps) {
  return applyTaxBps(output, taxRateBps);
}

/**
 * DEX-stage sell pre-quote input (Router receives full amount from user; only
 * `amountIn * (1 - taxRateBps)` is actually swapped on the pool hop).
 * Source: tradeEstimation.ts:162-167.
 */
export function computeTaxAwarePreSellAmountInToPool(amountInRaw, taxRateBps) {
  return applyTaxBps(amountInRaw, taxRateBps);
}

/**
 * Base predicate: DEX stage + V2 + tax factory. All tax-aware V2 buy/sell
 * predicates AND-gate on this, so V4 coins always return false.
 * Source: tradeEstimation.ts:173-182.
 */
export function isDexV2Tax(coinVersion, isBondingCurveCompleted) {
  return (
    !!isBondingCurveCompleted &&
    shouldUseTaxFactory(coinVersion) &&
    shouldUseUniswapV2(coinVersion)
  );
}

/**
 * DEX V2 tax BUY — Native path (pool collateral = ETH, user pays ETH).
 * Route: `taxHelper.dexBuyWithEth(token, ethIn, minOut)` with value=ETH.
 * Source: tradeEstimation.ts:188-201.
 *
 * `isUseEth` parameter kept for signature symmetry but NOT consumed —
 * see `isDexV2TaxDirectCollateralBuy` JSDoc for the full rationale
 * (frontend hard-codes `isUseEth=true` everywhere it's passed; the
 * `&& !!isUseEth` guard is dead code in the frontend and breaks the
 * CLI's `--no-use-eth` flag for users who explicitly pick the
 * collateral-pay path).
 */
export function isDexV2TaxNativeBuy(
  coinVersion,
  isBondingCurveCompleted,
  pair,
  selectedPair,
  // eslint-disable-next-line no-unused-vars
  isUseEth,
) {
  return (
    isDexV2Tax(coinVersion, isBondingCurveCompleted)
    && pair === 'ETH'
    && selectedPair === 'ETH'
  );
}

/**
 * DEX V2 tax BUY — CrossPair (pool collateral is ERC20 but user pays ETH).
 * Route: `taxHelper.dexBuyWithEth(token, ethIn, minOut)` with value=ETH.
 * Helper relays ETH -> collateral -> token internally.
 * Source: tradeEstimation.ts:208-221.
 *
 * `isUseEth` parameter kept for signature symmetry but NOT consumed —
 * see `isDexV2TaxDirectCollateralBuy` JSDoc for the full rationale.
 */
export function isDexV2TaxCrossPairEthBuy(
  coinVersion,
  isBondingCurveCompleted,
  pair,
  selectedPair,
  // eslint-disable-next-line no-unused-vars
  isUseEth,
) {
  return (
    isDexV2Tax(coinVersion, isBondingCurveCompleted)
    && pair !== 'ETH'
    && selectedPair === 'ETH'
  );
}

/**
 * DEX V2 tax BUY — DirectCollateral (user pays pool's ERC20 collateral).
 * Route: V2 router `swapExactTokensForTokensSupportingFeeOnTransferTokens`
 * after `ERC20(collateral).approve(uniV2Router)`. HOTFIX #3.
 * Source: tradeEstimation.ts:229-242.
 *
 * `isUseEth` parameter kept for signature symmetry with Native / CrossPair
 * but intentionally NOT consumed: the frontend's predicate has `&& !!isUseEth`
 * but every frontend call site hard-codes `isUseEth=true` (see
 * basememe-frontend `miniumReceived.ts:472` and `buy/index.tsx:154-159`
 * `setUseEth(true)` useEffect that fires whenever `isDexV2Stage` and
 * `isUseEth=false`), making the check dead code. The CLI exposes
 * `--no-use-eth` as a real flag, so honouring it would reject the
 * legitimate `--pair USDC --no-use-eth` spelling. Routing is determined
 * by `pair !== 'ETH' && selectedPair === pair` alone.
 */
export function isDexV2TaxDirectCollateralBuy(
  coinVersion,
  isBondingCurveCompleted,
  pair,
  selectedPair,
  // eslint-disable-next-line no-unused-vars
  isUseEth,
) {
  return (
    isDexV2Tax(coinVersion, isBondingCurveCompleted)
    && pair !== 'ETH'
    && selectedPair === pair
  );
}

/**
 * DEX V2 tax SELL — Native path (pool collateral = ETH, user wants ETH).
 * Route: `taxHelper.dexSellForEth(token, tokenIn, minEthOut)`.
 * Source: tradeEstimation.ts:248-259.
 */
export function isDexV2TaxNativeSell(
  coinVersion,
  isBondingCurveCompleted,
  pair,
  selectedPair,
) {
  return (
    isDexV2Tax(coinVersion, isBondingCurveCompleted)
    && pair === 'ETH'
    && selectedPair === 'ETH'
  );
}

/**
 * DEX V2 tax SELL — CrossPair (pool collateral is ERC20 but user wants ETH).
 * Route: `taxHelper.dexSellForEth(token, tokenIn, minEthOut)`; helper relays
 * token -> collateral -> ETH.
 * Source: tradeEstimation.ts:266-277.
 */
export function isDexV2TaxCrossPairEthSell(
  coinVersion,
  isBondingCurveCompleted,
  pair,
  selectedPair,
) {
  return (
    isDexV2Tax(coinVersion, isBondingCurveCompleted)
    && pair !== 'ETH'
    && selectedPair === 'ETH'
  );
}

/**
 * DEX V2 tax SELL — DirectCollateral (user wants pool's ERC20 back).
 * Route: V2 router fee-on-transfer swap after `ERC20(token).approve(uniV2Router)`.
 * HOTFIX #3.
 * Source: tradeEstimation.ts:285-296.
 */
export function isDexV2TaxDirectCollateralSell(
  coinVersion,
  isBondingCurveCompleted,
  pair,
  selectedPair,
) {
  return (
    isDexV2Tax(coinVersion, isBondingCurveCompleted)
    && pair !== 'ETH'
    && selectedPair === pair
  );
}

/**
 * Resolve the correct Trade Helper (ABI + per-chain address map) for a given
 * coin version.
 *
 * - Tax token (>= 11.2.0) -> `basememeTaxFactoryTradeHelperABI` + `taxAddresses`
 *   (caller indexes the returned map by chainId).
 * - Everything else -> V4 `tradeHelperABI` + null (caller should read from
 *   `getAddresses().basememeFactoryTradeHelper` for V4).
 *
 * Source: tradeEstimation.ts:127-141.
 */
export function resolveTradeHelperForCoin(coinVersion) {
  if (shouldUseTaxFactory(coinVersion)) {
    // taxAddresses[chainId].basememeTaxFactoryTradeHelper — keyed map so the
    // caller stays explicit about which chainId they're resolving on.
    const addressSource = {};
    for (const [chainId, addrs] of Object.entries(taxAddresses)) {
      addressSource[Number(chainId)] = addrs.basememeTaxFactoryTradeHelper;
    }
    return {
      abi: basememeTaxFactoryTradeHelperABI,
      addressSource,
    };
  }
  return {
    abi: tradeHelperABI,
    addressSource: null,
  };
}

/**
 * Single-value trade path classifier — ELIMINATES if-else order dependency.
 *
 * Returns 'tax' | 'v4' | 'v3'. Throws on the V2-non-tax slot (unreachable on
 * basememe — no 11.0.0..11.1.9 deployment exists).
 *
 * HOTFIX #2 (strengthened in Phase 2):
 *   - `shouldUseUniswapV2(cv) >= 11.0.0` is a SUPERSET of
 *     `shouldUseTaxFactory(cv) >= 11.2.0`, so any direct use of the V2
 *     predicate on basememe will misroute tax tokens. Call sites must use
 *     `switch (resolveTradePath(cv))` and never compose the primitives
 *     themselves.
 *
 * Source: PORT_AUDIT_CHECKLIST.md HOTFIX #2 canonical code sample.
 */
export function resolveTradePath(coinVersion) {
  if (shouldUseTaxFactory(coinVersion)) return 'tax';
  if (shouldUseUniswapV4(coinVersion)) return 'v4';
  if (shouldUseUniswapV2(coinVersion)) {
    throw new Error(
      `V2 non-tax not supported on basememe (cv=${coinVersion}, tax lives on >= 11.2.0)`,
    );
  }
  return 'v3';
}
