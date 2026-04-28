// Pure helpers for the `basememe tax-info` command.
//
// Two responsibilities:
//  1) Adapt the backend `/coin/tax_info` response into the CLI's output
//     shape. Target shape is aligned 1:1 with frontend `TaxInfoData`
//     (Source: frontend-basememe/src/components/home/types.ts:196-206 +
//     TaxInfoBase lines 108-126).
//  2) Decide when to fall back to on-chain RPC for Snowball vaults. The
//     backend does not index `BasememeSnowBallExecuted` events (CLI
//     PORT_AUDIT_CHECKLIST HOTFIX #5 · bfun-gap). Whenever the token's
//     vault_type is `snowball` AND the backend's `token_burned` is
//     missing or zero, we read `vaultStats()` directly from the vault.
//
// Everything here is pure / test-friendly; no viem wallet calls leak.

import { snowBallVaultABI, basememeTaxTokenABI } from './tax-abis.js';

// DEAD address used by burn-style vault accounting on basememe / bfun.
// The frontend `tax-dialog/index.tsx` displays token_burned from the
// backend field `stats.token_burned` directly (see line 392) and does
// NOT call balanceOf(DEAD) itself. This CLI uses balanceOf(DEAD) only
// as an RPC fallback inside `readSnowballVaultStats()` below, for
// snowball vaults where the backend has no `BasememeSnowBallExecuted`
// puller (PORT_AUDIT_CHECKLIST HOTFIX #5 · bfun-gap).
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';

/**
 * Extract the `base` subtree of `/coin/tax_info`. Returns `{}` when the
 * response doesn't carry a `base` key (some older backends omit it for
 * non-tax coins; callers still invoke this path through the tax-only
 * guard, so the empty-shape fallback keeps us from throwing downstream).
 *
 * Source: server-basememe/web_api/route/coin.py /coin/tax_info response
 *   (mirrored by TaxInfoBase in types.ts:108-126).
 */
export function parseTaxInfoBase(resp) {
  const base = resp?.base;
  if (!base || typeof base !== 'object') return {};
  return {
    processorDeflationBps: base.processorDeflationBps,
    processorDividendBps: base.processorDividendBps,
    processorLpBps: base.processorLpBps,
    processorMarketBps: base.processorMarketBps,
    taxRateBps: base.taxRateBps,
    tax_token_poll_state: base.tax_token_poll_state,
    fundsRecipientAddress: base.fundsRecipientAddress,
  };
}

/**
 * Extract the `statistics` subtree. Backend emits strings for numeric
 * fields (18-decimal WEI vs 6-decimal USDC is disambiguated by the caller
 * + the `quoteDecimals` label — see HOTFIX #17). `vault_burner_count`
 * is a number for BurnDividend vaults.
 *
 * Source: types.ts:136-151 (TaxInfoStatistics).
 */
export function parseTaxInfoStatistics(resp) {
  const s = resp?.statistics;
  if (!s || typeof s !== 'object') return {};
  return {
    quote_added_to_liquidity: s.quote_added_to_liquidity,
    quote_sent_to_funds_recipient: s.quote_sent_to_funds_recipient,
    token_burned: s.token_burned,
    tokens_added_to_liquidity: s.tokens_added_to_liquidity,
    total_dividends_distributed: s.total_dividends_distributed,
    your_dividend_claimed: s.your_dividend_claimed,
    vault_burner_count: s.vault_burner_count,
  };
}

/**
 * Glue the three parsers together. Caller typically feeds the axios
 * response body (unwrapped of `{code, data, msg}`) here.
 *
 * Returned `vaultData` carries the raw `tax_market_vault_data` subtree
 * (Source: types.ts:171-194) when the backend reports a vault, or
 * `undefined` for evm-recipient tokens.
 */
export function parseTaxInfoResponse(resp) {
  const base = parseTaxInfoBase(resp);
  const statistics = parseTaxInfoStatistics(resp);
  const vaultData = resp?.tax_market_vault_data;
  const out = { base, statistics };
  if (vaultData && typeof vaultData === 'object') {
    out.vaultData = vaultData;
  }
  return out;
}

/**
 * HOTFIX #5 predicate: should we ignore the backend's burn stats and read
 * `vaultStats()` directly from the Snowball vault contract?
 *
 * Truth table (locked in unit test):
 *   vault_type=snowball + backend burn=0      -> true
 *   vault_type=snowball + missing token_burned -> true
 *   vault_type=snowball + backend burn>0      -> false (trust backend)
 *   vault_type=split|burn_dividend|gift       -> false
 *   missing / null vaultData                  -> false (no vault -> no gap)
 */
export function shouldFallbackToSnowballRpc(_base, vaultData, stats) {
  if (!vaultData || vaultData.vault_type !== 'snowball') return false;
  const burned = stats?.token_burned;
  if (burned === undefined || burned === null) return true;
  try {
    return BigInt(burned) === 0n;
  } catch {
    // Non-numeric backend payload -> treat as missing to stay safe.
    return true;
  }
}

/**
 * Read `vaultStats()` off the Snowball vault contract and (optionally)
 * the DEAD-address balance of the tax token. Returns string values so
 * JSON serialization never loses precision and HOTFIX #17 can apply.
 *
 * The caller is expected to pass a viem `publicClient` (or a stub shaped
 * like one — see `readContract({ address, abi, functionName, args })`).
 *
 * Source: snowBallVaultABI.vaultStats() in src/lib/tax-abis.js:709-718 +
 *   bfun/basememe test evidence that backend lacks a `BasememeSnowBallExecuted`
 *   puller.
 */
export async function readSnowballStats({
  tokenAddress,
  vaultAddress,
  publicClient,
  deadAddress,
}) {
  if (!vaultAddress) {
    throw new Error('readSnowballStats: vaultAddress is required');
  }
  if (!publicClient) {
    throw new Error('readSnowballStats: publicClient is required');
  }

  const vaultStats = await publicClient.readContract({
    address: vaultAddress,
    abi: snowBallVaultABI,
    functionName: 'vaultStats',
    args: [],
  });
  // viem decodes the multi-return tuple as an array: [totalBuybackQuote, totalTokensBurned].
  const totalBuybackQuote = String(vaultStats?.[0] ?? 0n);
  const totalTokensBurned = String(vaultStats?.[1] ?? 0n);

  const out = { totalBuybackQuote, totalTokensBurned };

  if (deadAddress && tokenAddress) {
    const deadBalance = await publicClient.readContract({
      address: tokenAddress,
      abi: basememeTaxTokenABI,
      functionName: 'balanceOf',
      args: [deadAddress],
    });
    out.deadBalance = String(deadBalance ?? 0n);
  }

  return out;
}
