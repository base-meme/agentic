// `basememe vault-info <tokenAddress> [--user <address>]`
//
// Per-vault-type snapshot that mirrors frontend `vault-detail/index.tsx`:
//   - split          backend recipients config + RPC `getRecipientsInfo()`
//                    live accumulated/claimed, optional `userBalances(user)`
//   - snowball       RPC-only `vaultStats()` + `balanceOf(DEAD)` (HOTFIX #5)
//   - burn_dividend  single multicall: userInfo(user) + pendingReward(user)
//                    + 5 vault totals + isDividendMode
//   - gift           backend-only (tax_market_vault_data gift fields)
//
// HOTFIX #17: numeric values are raw bigint strings; `quote.decimals` is
// a separate label — no auto-format.

import { Command } from 'commander';
import { getAddress, isAddress } from 'viem';

import { getPublicClient, getChainId } from '../lib/chain.js';
import { getTokenInfo, getTaxInfo, getGiftVaultInfo } from '../lib/api.js';
import { getAccount } from '../lib/wallet.js';
import {
  splitVaultABI,
  snowBallVaultABI,
  burnDividendVaultABI,
  basememeTaxTokenABI,
} from '../lib/tax-abis.js';
import {
  assertTaxToken,
  resolveQuoteTokenMeta,
  validateUserAddress,
} from '../lib/dividend-helpers.js';
import { resolveVaultData } from '../lib/vault-helpers.js';
import { DEAD_ADDRESS } from '../lib/tax-info-helpers.js';

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

function requireSuccess(result, label) {
  if (result?.status !== 'success') {
    const reason =
      result?.error?.shortMessage
      || result?.error?.message
      || 'unknown RPC error';
    throw new Error(`Failed to read ${label}: ${reason}`);
  }
  return result.result;
}

function tryResolveOptionalUser(options) {
  if (options?.user) {
    validateUserAddress(options.user, '--user address');
    return getAddress(options.user);
  }
  // Probe wallet only when caller didn't pass --user; absence of a wallet
  // is valid for read-only runs (Split recipients still readable without
  // a user binding; user-specific fields are simply omitted).
  try {
    const addr = getAccount()?.address;
    return addr && isAddress(addr) ? getAddress(addr) : undefined;
  } catch {
    return undefined;
  }
}

async function readSplitStats(publicClient, vaultAddress, userAddress) {
  const recipients = await publicClient.readContract({
    address: vaultAddress,
    abi: splitVaultABI,
    functionName: 'getRecipientsInfo',
  });

  const stats = {
    recipients: (recipients || []).map((r) => ({
      recipient: getAddress(r.recipient),
      bps: Number(r.bps),
      accumulated: String(r.accumulated),
      claimed: String(r.claimed),
    })),
  };

  if (userAddress) {
    const balances = await publicClient.readContract({
      address: vaultAddress,
      abi: splitVaultABI,
      functionName: 'userBalances',
      args: [userAddress],
    });
    stats.userBalance = {
      accumulated: String(balances?.[0] ?? 0n),
      claimed: String(balances?.[1] ?? 0n),
    };
  }

  return stats;
}

async function readSnowballStats(publicClient, vaultAddress, tokenAddress) {
  const stats = await publicClient.readContract({
    address: vaultAddress,
    abi: snowBallVaultABI,
    functionName: 'vaultStats',
  });
  const deadBalance = await publicClient.readContract({
    address: tokenAddress,
    abi: basememeTaxTokenABI,
    functionName: 'balanceOf',
    args: [DEAD_ADDRESS],
  });
  return {
    totalBuybackQuote: String(stats?.[0] ?? 0n),
    totalTokensBurned: String(stats?.[1] ?? 0n),
    deadBalance: String(deadBalance ?? 0n),
  };
}

async function readBurnDividendStats(publicClient, vaultAddress, userAddress, backendStats) {
  // Default user to zero address when no wallet — the contract returns
  // (0, 0) / 0 for unknown users so the read is safe.
  const probe = userAddress || '0x0000000000000000000000000000000000000000';

  const results = await publicClient.multicall({
    allowFailure: true,
    contracts: [
      { address: vaultAddress, abi: burnDividendVaultABI, functionName: 'userInfo', args: [probe] },
      { address: vaultAddress, abi: burnDividendVaultABI, functionName: 'pendingReward', args: [probe] },
      { address: vaultAddress, abi: burnDividendVaultABI, functionName: 'totalBurned' },
      { address: vaultAddress, abi: burnDividendVaultABI, functionName: 'totalBuybackQuote' },
      { address: vaultAddress, abi: burnDividendVaultABI, functionName: 'totalBuybackTokensBurned' },
      { address: vaultAddress, abi: burnDividendVaultABI, functionName: 'totalRewardDistributed' },
      { address: vaultAddress, abi: burnDividendVaultABI, functionName: 'buybackCount' },
      { address: vaultAddress, abi: burnDividendVaultABI, functionName: 'isDividendMode' },
    ],
  });

  const userInfoRaw = requireSuccess(results[0], `userInfo(${probe})`);
  const pendingReward = requireSuccess(results[1], `pendingReward(${probe})`);
  const totalBurned = requireSuccess(results[2], 'totalBurned');
  const totalBuybackQuote = requireSuccess(results[3], 'totalBuybackQuote');
  const totalBuybackTokensBurned = requireSuccess(results[4], 'totalBuybackTokensBurned');
  const totalRewardDistributed = requireSuccess(results[5], 'totalRewardDistributed');
  const buybackCount = requireSuccess(results[6], 'buybackCount');
  const isDividendMode = requireSuccess(results[7], 'isDividendMode');

  const stats = {
    totalBurned: String(totalBurned),
    totalBuybackQuote: String(totalBuybackQuote),
    totalBuybackTokensBurned: String(totalBuybackTokensBurned),
    totalRewardDistributed: String(totalRewardDistributed),
    buybackCount: String(buybackCount),
    isDividendMode: Boolean(isDividendMode),
  };

  // Polish Commit 6 · L2: `vault_burner_count` (unique wallets that have
  // burned at least once) lives at `statistics.vault_burner_count` in
  // the backend `/coin/tax_info` response. RPC has no equivalent
  // cheap-to-read accumulator, so this is backend-only. Surface
  // `undefined` (not 0) when backend is unavailable — operator can tell
  // "unknown" from "zero" that way.
  if (backendStats && backendStats.vault_burner_count !== undefined) {
    stats.burnerCount = Number(backendStats.vault_burner_count);
  }

  if (userAddress) {
    stats.userInfo = {
      burnedAmount: String(userInfoRaw?.[0] ?? 0n),
      rewardDebt: String(userInfoRaw?.[1] ?? 0n),
    };
    stats.pendingReward = String(pendingReward);
  }

  return stats;
}

async function readGiftStats(vaultRaw, vaultAddress) {
  // Gift fields come from the backend `tax_market_vault_data` subtree —
  // RPC is skipped because we don't have a per-instance gift vault ABI
  // ported yet.
  // TODO(polish): streamingTarget requires giftVaultABI port — see
  // frontend `vault-detail/index.tsx:814,911` (GIFT_VAULT_READ_ABI).
  //
  // B3: also fetch `/gift_vault/info` to surface the individual proofs[]
  // list (frontend `vault-detail/index.tsx:931-944`). Degrades to an
  // empty array on backend failure so the rest of gift stats still
  // populates — mirrors the frontend `catch { return null }` pattern.
  let proofs = [];
  try {
    const giftInfoResp = await getGiftVaultInfo({ vaultAddress });
    const giftInfoBody = unwrapApiResponse(giftInfoResp);
    if (Array.isArray(giftInfoBody?.proofs)) {
      proofs = giftInfoBody.proofs;
    }
  } catch {
    // Non-fatal: operator still sees counts + state from tax_market_vault_data.
    proofs = [];
  }
  return {
    xHandle: vaultRaw?.x_handle ?? null,
    vaultState: vaultRaw?.vault_state ?? null,
    proofCount: vaultRaw?.proof_count ?? 0,
    timeoutDuration: vaultRaw?.timeout_duration ?? null,
    timeoutDeadline: vaultRaw?.timeout_deadline ?? null,
    xId: vaultRaw?.x_id ?? null,
    xIdStatus: vaultRaw?.x_id_status ?? null,
    proofs,
  };
}

export async function vaultInfoCommand(tokenAddress, options = {}) {
  const chainId = getChainId();
  const publicClient = getPublicClient();

  const infoResp = await getTokenInfo(tokenAddress);
  const coin = unwrapApiResponse(infoResp);
  if (!coin || !coin.contract_address) {
    throw new Error(`Token info not found for ${tokenAddress}`);
  }

  const extraData = safeJsonParse(coin.extra_data) || {};
  const coinVersion = coin.coin_version || extraData?.coin_version;
  assertTaxToken(coinVersion);

  const coinWithExtra = { ...coin, extra_data: extraData };
  const { vaultType, vaultAddress, vaultFactory, raw: vaultRaw } = resolveVaultData(coinWithExtra);
  const quoteMeta = resolveQuoteTokenMeta(coinWithExtra);

  const user = tryResolveOptionalUser(options);

  // Fetch backend tax_info for Gift fields and Split recipients config.
  // Snowball ignores backend (HOTFIX #5); BurnDividend uses RPC for the
  // authoritative stats but backend still fills the optional envelope
  // (Polish #6 L2: `statistics.vault_burner_count` is backend-only).
  let backendVault = vaultRaw;
  let backendStats = null;
  try {
    const taxResp = await getTaxInfo(tokenAddress, chainId, user || undefined);
    const backendData = unwrapApiResponse(taxResp);
    if (backendData?.tax_market_vault_data) {
      backendVault = { ...vaultRaw, ...backendData.tax_market_vault_data };
    }
    if (backendData?.statistics) {
      backendStats = backendData.statistics;
    }
  } catch {
    // Backend unavailable is non-fatal for vault-info — RPC covers the
    // write-sensitive fields. Gift vault is the one type that depends on
    // backend; if backend is dead, we fall through to the coin.extra_data
    // snapshot above.
  }

  let stats;
  let source;
  if (vaultType === 'split') {
    stats = await readSplitStats(publicClient, vaultAddress, user);
    source = 'backend+rpc';
  } else if (vaultType === 'snowball') {
    stats = await readSnowballStats(publicClient, vaultAddress, tokenAddress);
    source = 'rpc';
  } else if (vaultType === 'burn_dividend') {
    stats = await readBurnDividendStats(publicClient, vaultAddress, user, backendStats);
    source = 'backend+rpc';
  } else if (vaultType === 'gift') {
    stats = await readGiftStats(backendVault, vaultAddress);
    source = 'backend';
  } else {
    // resolveVaultData already guards this — defensive double-check.
    throw new Error(`Unknown vault type: ${vaultType}`);
  }

  // CONVENTION (vault/gift commands, Polish Fix R1 · L3 #2):
  //   Top-level keys on every return payload are emitted in strict
  //   alphabetical insertion order so machine-consumer diffs stay
  //   stable. When adding a new field, drop it into its sorted slot
  //   here — do NOT append at the end. Optional keys use conditional
  //   spread (`...(cond ? { key: val } : {})`) so they land in the
  //   right slot when present and vanish when absent.
  //   Nested objects (vault/quote/stats) keep their existing internal
  //   order; only the TOP level is pinned.
  //
  // L3 #6 polish source · Polish Fix R1 · L3 #1 (user slot fix).
  const out = {
    chainId,
    coinVersion,
    quote: {
      symbol: quoteMeta.symbol,
      decimals: quoteMeta.decimals,
    },
    source,
    stats,
    token: getAddress(tokenAddress),
    // HOTFIX #17: tax-token-denominated fields (deadBalance, totalTokensBurned,
    // totalBuybackTokensBurned, totalBurned, userInfo.burnedAmount) share the
    // payload with quote-denominated ones. Surface the token decimals as a
    // sibling label so operators / subprocess consumers don't misread them.
    // Tax tokens are always 18-dec by contract invariant.
    tokenDecimals: 18,
    ...(user ? { user } : {}),
    vault: {
      type: vaultType,
      address: vaultAddress,
      factory: vaultFactory,
    },
  };
  return out;
}

export const vaultInfo = new Command('vault-info')
  .description('Per-vault-type snapshot (backend + RPC per vault_type)')
  .argument('<tokenAddress>', 'Tax token contract address (coin_version >= 11.2.0)')
  .option('--user <address>', 'Probe user-specific fields (Split userBalances, BurnDividend userInfo)')
  .action(async (tokenAddress, options) => {
    try {
      const result = await vaultInfoCommand(tokenAddress, options);
      console.log(JSON.stringify({ success: true, data: result }, null, 2));
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error?.message || String(error) }),
      );
      process.exit(1);
    }
  });
