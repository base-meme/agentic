// Pure helpers for the `basememe dividend-info` and `basememe dividend-claim`
// commands. Scope: the **dividendBps allocation bucket** and the per-token
// **dividend contract** (address at `coin.extra_data.tax_token_params.dividendContract`).
//
// NOT related to the `BurnDividend` vault type (that lives in Phase 5 via
// `burnDividendVaultABI` + `vault-*` commands).
//
// Frontend references:
//   tax-dialog/index.tsx:244-545            — the claim UI + dividendContract
//                                              resolution + unwrapWETH rule.
//   types.ts:44-73 (TaxTokenParams)          — shape of `tax_token_params`.

import { getAddress, isAddress } from 'viem';
import { ZERO_ADDRESS } from './chain-configs.js';
import { shouldUseTaxFactory } from './version.js';
import { resolveTradePath } from './tax-trade.js';

function safeJsonParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readExtraData(coin) {
  if (!coin) return null;
  const raw = coin.extra_data ?? coin.extraData;
  return safeJsonParse(raw);
}

/**
 * Pull the per-token dividend contract address from a coin info record.
 *
 * Source: `extra_data.tax_token_params.dividendContract` — the backend
 * populates this at create time (see server-basememe
 * cron/coin/pull_coin_token_created.py). Frontend reads the same field
 * at tax-dialog/index.tsx:238-246 before constructing a claim.
 *
 * Throws "Missing dividend contract address" when the field is absent,
 * and "Invalid dividend contract address" when it's not a hex address.
 * This matches the spec in BASEMEME_AI_TAX_PLAN.md Phase 4.
 */
export function resolveDividendContract(coin) {
  const extra = readExtraData(coin);
  const addr = extra?.tax_token_params?.dividendContract;
  if (!addr) {
    throw new Error(
      'Missing dividend contract address in coin.extra_data.tax_token_params.dividendContract',
    );
  }
  if (typeof addr !== 'string' || !isAddress(addr)) {
    throw new Error(`Invalid dividend contract address: ${addr}`);
  }
  return getAddress(addr);
}

/**
 * Build the `withdrawDividendsFor(user, unwrapWETH)` args, mirroring
 * frontend `tax-dialog/index.tsx:519-523`:
 *   const unwrapWETH = claimForAnotherUser ? true : unwrapToNative;
 *
 * The `--for` (delegate) mode ALWAYS forces `unwrapWETH=true` on-chain
 * to prevent shipping WETH to a third-party wallet that may not know how
 * to unwrap it.
 *
 * Returns `{ args, warnings }` — warnings is the array of strings the CLI
 * should print on stderr. At most one warning is emitted today.
 */
export function buildClaimArgs({ callerAddress, forAddress, keepWeth }) {
  const warnings = [];
  const caller = callerAddress;

  if (forAddress) {
    // --for: delegate mode · forced unwrap (Source: tax-dialog:519-523).
    if (keepWeth) {
      warnings.push('--keep-weth ignored when --for is set');
    }
    return {
      args: [forAddress, true],
      warnings,
    };
  }

  // Self-claim · `--keep-weth` inverts the default unwrap-to-native.
  const unwrapWETH = !keepWeth;
  return {
    args: [caller, unwrapWETH],
    warnings,
  };
}

/**
 * Reject a zero / malformed user address. Used by --user / --for parsers.
 *
 * `label` (default `'address'`) lets callers customize the "Invalid {label}"
 * error prefix — e.g. `validateUserAddress(addr, '--user address')` so the
 * error matches the flag the user typed.
 */
export function validateUserAddress(addr, label = 'address') {
  if (!addr || typeof addr !== 'string' || !isAddress(addr)) {
    throw new Error(`Invalid ${label}: ${addr}`);
  }
  if (String(addr).toLowerCase() === String(ZERO_ADDRESS).toLowerCase()) {
    throw new Error('User address must not be the zero address');
  }
}

// Base-chain quote token addresses for pair disambiguation. Keep these in
// lockstep with `src/lib/chain-configs.js` COLLATERAL_TEMPLATES
// (ETH-pair is always ZERO_ADDRESS; USDC-pair per-chain is fixed; WETH
// appears when the dividend processor stored a pre-unwrap address on
// the coin record — some flows don't normalise to ZERO_ADDRESS).
const USDC_BY_CHAIN = {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

// Base canonical WETH — same address on mainnet + sepolia.
// Source: `frontend-basememe/src/lib/chain-configs.js` BASE_SHARED_CONFIG.WETH
const BASE_WETH = '0x4200000000000000000000000000000000000006';

/**
 * Resolve the dividend payout token metadata (symbol + decimals) for the
 * given coin record. The dividend contract pays out in the coin's quote
 * token — for basememe on Base that's ETH (18-dec, via WETH unwrap) or
 * USDC (6-dec). HOTFIX #17 consumers use `decimals` as a label and never
 * auto-divide.
 */
export function resolveQuoteTokenMeta(coin) {
  const currency = coin?.currency_address || coin?.currencyAddress;
  const chainId = Number(coin?.chain_id || coin?.chainId || 0);

  if (!currency || String(currency).toLowerCase() === ZERO_ADDRESS.toLowerCase()) {
    return { symbol: 'ETH', decimals: 18 };
  }

  // WETH explicitly maps to ETH/18 (L1 R1 + L2 R1 🟡 — some coin records
  // store the pre-unwrap WETH address rather than ZERO_ADDRESS, which
  // previously fell through to UNKNOWN/18 and confused the operator).
  if (String(currency).toLowerCase() === BASE_WETH.toLowerCase()) {
    return { symbol: 'ETH', decimals: 18 };
  }

  const usdc = USDC_BY_CHAIN[chainId];
  if (usdc && String(currency).toLowerCase() === usdc.toLowerCase()) {
    return { symbol: 'USDC', decimals: 6 };
  }

  // Fallback: most Basememe tax tokens pair with ETH or USDC; if the
  // backend ever ships a novel pair the CLI caller should add it here
  // explicitly rather than silently defaulting to 18.
  return { symbol: 'UNKNOWN', decimals: 18 };
}

/**
 * Throw when a coin_version is not tax (>= 11.2.0). Shared by all three
 * Phase 4 commands so V4/V3 tokens can't accidentally route into a tax
 * code path. Error message cites the version boundary for operator clarity.
 */
export function assertTaxToken(coinVersion) {
  if (!shouldUseTaxFactory(coinVersion) || resolveTradePath(coinVersion) !== 'tax') {
    throw new Error(
      `Not a tax token (coin_version ${coinVersion}); dividend commands require >= 11.2.0`,
    );
  }
}
