// `basememe tax-info <tokenAddress> [--rpc-fallback]`
//
// Fetch a coin-wide tax snapshot combining:
//   - `/coin/info`          — coin metadata + coin_version + extra_data
//   - `/coin/tax_info`      — backend-indexed base + statistics + vaultData
//   - RPC `vaultStats()`    — Snowball vault fallback (HOTFIX #5)
//
// Output shape is aligned 1:1 with frontend `TaxInfoData`
// (frontend-basememe/src/components/home/types.ts:196-206). `source` is a
// meta field that lets operators see which data-path served the result:
//   'backend'     — default happy path
//   'backend+rpc' — backend worked but Snowball RPC also ran
//   'rpc-only'    — backend didn't carry stats; pure RPC fallback

import { Command } from 'commander';
import { getPublicClient, getChainId } from '../lib/chain.js';
import { getTokenInfo, getTaxInfo } from '../lib/api.js';
import {
  parseTaxInfoResponse,
  shouldFallbackToSnowballRpc,
  readSnowballStats,
  DEAD_ADDRESS,
} from '../lib/tax-info-helpers.js';
import { assertTaxToken } from '../lib/dividend-helpers.js';

function safeJsonParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unwrapApiResponse(response) {
  if (response && typeof response === 'object' && 'data' in response) {
    return response.data;
  }
  return response;
}

export async function taxInfoCommand(tokenAddress, options = {}) {
  const chainId = getChainId();
  const publicClient = getPublicClient();

  // 1) Fetch coin info first so we can validate the version before hitting
  // the tax_info endpoint with an incompatible token.
  const infoResp = await getTokenInfo(tokenAddress);
  const coin = unwrapApiResponse(infoResp);
  if (!coin || !coin.contract_address) {
    throw new Error(`Token info not found for ${tokenAddress}`);
  }

  const extraData = safeJsonParse(coin.extra_data) || {};
  const coinVersion = coin.coin_version || extraData?.coin_version;
  assertTaxToken(coinVersion);

  // 2) Fetch backend tax_info. Backend `server-basememe/web_api/route/coin.py:1745`
  // requires `{chain_id, contract_address, user_address?}` (same as frontend
  // `tax-dialog/index.tsx:334`). Earlier we sent `{coin_id}` which 400'd
  // silently — the backend branch has been dead for evm-mode coins.
  let backend = null;
  let backendError = null;
  try {
    const taxResp = await getTaxInfo(tokenAddress, chainId, undefined);
    backend = unwrapApiResponse(taxResp) || null;
  } catch (error) {
    // Capture the error for diagnostics. Don't throw — RPC fallback (Snowball
    // / `--rpc-fallback`) can still cover the data for vault-mode coins.
    backendError = error?.message || String(error);
    backend = null;
  }

  const parsed = parseTaxInfoResponse(backend || {});
  const vaultData = parsed.vaultData;
  const forceRpc = !!options.rpcFallback;

  // Accurate source label — only claim 'rpc-*' when RPC actually ran.
  // Previously `tax-info.js:78` claimed 'rpc-only' on backend failure even
  // when no RPC call executed (evm-mode coins → misleading success envelope,
  // L2 Codex R1 🔴 / L3 R1 🟡 consensus). Initialize from what we know now;
  // the Snowball branch below upgrades to 'backend+rpc' / 'rpc-only' only
  // when `readSnowballStats` actually runs.
  let source;
  if (backend) source = 'backend';
  else source = 'empty'; // backend failed AND no RPC has run yet

  // 3) Snowball RPC fallback (HOTFIX #5). Also triggered any time
  // `--rpc-fallback` is passed, so operators can verify the on-chain
  // numbers without waiting for a backend sync.
  const snowballGap = shouldFallbackToSnowballRpc(parsed.base, vaultData, parsed.statistics);
  const shouldReadRpc = forceRpc || snowballGap;
  const isSnowballVault = !!(vaultData && vaultData.vault_type === 'snowball' && vaultData.vault);

  if (shouldReadRpc && isSnowballVault) {
    const rpcStats = await readSnowballStats({
      tokenAddress,
      vaultAddress: vaultData.vault,
      publicClient,
      deadAddress: DEAD_ADDRESS,
    });
    parsed.vaultData = { ...vaultData, rpcStats };
    // HOTFIX #5: fill statistics.token_burned when backend had none so
    // downstream consumers see consistent 4-bucket view.
    if (!parsed.statistics.token_burned || parsed.statistics.token_burned === '0') {
      parsed.statistics = {
        ...parsed.statistics,
        token_burned: rpcStats.totalTokensBurned,
      };
    }
    source = backend ? 'backend+rpc' : 'rpc-only';
  }
  // Note: `--rpc-fallback` without a Snowball vault is a no-op (nothing to
  // read on-chain that backend doesn't already cover); keep `source`
  // truthful rather than flipping to 'backend+rpc' for a flag-only side effect.

  return {
    mode: 'tax',
    token: tokenAddress,
    chainId,
    coinVersion,
    base: parsed.base,
    statistics: parsed.statistics,
    ...(parsed.vaultData ? { vaultData: parsed.vaultData } : {}),
    source,
    // Surface backend diagnostic so callers can tell "backend error" from
    // "backend success with empty data" (L2 Codex R1 🔴).
    ...(backendError ? { backendError } : {}),
  };
}

export const taxInfo = new Command('tax-info')
  .description('Coin-wide tax snapshot (backend + Snowball RPC fallback)')
  .argument('<tokenAddress>', 'Tax token contract address (coin_version >= 11.2.0)')
  .option(
    '--rpc-fallback',
    'Always read Snowball vaultStats() directly from chain (HOTFIX #5)',
  )
  .action(async (tokenAddress, options) => {
    try {
      const result = await taxInfoCommand(tokenAddress, options);
      console.log(JSON.stringify({ success: true, data: result }, null, 2));
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error?.message || String(error) }),
      );
      process.exit(1);
    }
  });
