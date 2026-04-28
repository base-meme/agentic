// `basememe dividend-info <tokenAddress> [--user <address>]`
//
// Reads per-user dividend balances from the PER-TOKEN dividend contract
// (address at `extra_data.tax_token_params.dividendContract`). Output
// returns BOTH `withdrawable` (pending claim) and `withdrawn` (historical).
//
// HOTFIX #17: numeric values are raw strings; `quoteDecimals` is a
// SEPARATE label. We NEVER auto-format (the dividend payout decimals can
// differ from the tax token's 18-dec ERC20, and historically bfun's
// single-chain collision hid this bug).

import { Command } from 'commander';
import { getPublicClient, getChainId } from '../lib/chain.js';
import { getTokenInfo } from '../lib/api.js';
import { dividendABI } from '../lib/tax-abis.js';
import { getAccount } from '../lib/wallet.js';
import {
  resolveDividendContract,
  resolveQuoteTokenMeta,
  validateUserAddress,
  assertTaxToken,
} from '../lib/dividend-helpers.js';

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

export async function dividendInfoCommand(tokenAddress, options = {}) {
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

  // Assemble a coin record that carries parsed extra_data so
  // resolveDividendContract / resolveQuoteTokenMeta can read fields
  // regardless of whether the API returned JSON or a stringified blob.
  const coinWithExtra = {
    ...coin,
    extra_data: extraData,
  };

  const dividendContract = resolveDividendContract(coinWithExtra);

  let user = options?.user;
  const userFromFlag = !!user;
  if (!user) {
    user = getAccount().address;
  }
  // Label matches source: `--user address` when caller passed the flag,
  // `wallet address` when we fell back to the connected account.
  validateUserAddress(user, userFromFlag ? '--user address' : 'wallet address');

  // Source: frontend-basememe/src/components/common/tax-dialog/index.tsx:300-324
  //   multicall reads withdrawableDividendOf + withdrawnDividends in parallel.
  const multicallResult = await publicClient.multicall({
    allowFailure: true,
    contracts: [
      {
        address: dividendContract,
        abi: dividendABI,
        functionName: 'withdrawableDividendOf',
        args: [user],
      },
      {
        address: dividendContract,
        abi: dividendABI,
        functionName: 'withdrawnDividends',
        args: [user],
      },
    ],
  });

  // L2 Codex R1 🔴 — previous code silently mapped failed reads to `0n`,
  // making RPC failure indistinguishable from a real zero balance. Users
  // would see "eligible: false, withdrawable: 0" and decide NOT to claim
  // real funds they are actually owed. Now surface the error plainly.
  const withdrawableResult = multicallResult?.[0];
  const withdrawnResult = multicallResult?.[1];

  if (withdrawableResult?.status !== 'success') {
    const reason =
      withdrawableResult?.error?.shortMessage
      || withdrawableResult?.error?.message
      || 'unknown RPC error';
    throw new Error(
      `Failed to read withdrawableDividendOf(${user}) from ${dividendContract}: ${reason}`,
    );
  }
  if (withdrawnResult?.status !== 'success') {
    const reason =
      withdrawnResult?.error?.shortMessage
      || withdrawnResult?.error?.message
      || 'unknown RPC error';
    throw new Error(
      `Failed to read withdrawnDividends(${user}) from ${dividendContract}: ${reason}`,
    );
  }

  const withdrawableRaw = withdrawableResult.result;
  const withdrawnRaw = withdrawnResult.result;

  const quoteMeta = resolveQuoteTokenMeta(coinWithExtra);

  // HOTFIX #17: numeric values are returned as strings. `quoteDecimals` is
  // a separate label so the caller knows how to render if they choose to,
  // but no auto-formatting happens here.
  return {
    token: tokenAddress,
    user,
    dividendContract,
    quoteToken: quoteMeta.symbol,
    quoteDecimals: quoteMeta.decimals,
    withdrawable: String(withdrawableRaw),
    withdrawn: String(withdrawnRaw),
    eligible: withdrawableRaw > 0n,
  };
}

export const dividendInfo = new Command('dividend-info')
  .description('Per-user pending + historical dividend balances (raw, decimals label)')
  .argument('<tokenAddress>', 'Tax token contract address (coin_version >= 11.2.0)')
  .option('--user <address>', 'Inspect this user (default: connected account)')
  .action(async (tokenAddress, options) => {
    try {
      const result = await dividendInfoCommand(tokenAddress, options);
      console.log(JSON.stringify({ success: true, data: result }, null, 2));
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error?.message || String(error) }),
      );
      process.exit(1);
    }
  });
