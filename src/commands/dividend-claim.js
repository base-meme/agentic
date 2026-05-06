// `basememe dividend-claim <tokenAddress> [--for <addr>] [--keep-weth] [--dry-run]`
//
// Writes `withdrawDividendsFor(targetUser, unwrapWETH)` to the per-token
// dividend contract. Selector `0x0b9e8349` is Phase-1-pinned.
//
// `--for` forces unwrapWETH=true (source: frontend tax-dialog/index.tsx:519-523).
// `--keep-weth` on a self-claim inverts the default unwrap-to-native.
//
// `--dry-run` honors the Phase 2 sentinel convention (see buy.js
// `emitDryRun`): prints `{success:true, dryRun:true, ...}` directly and the
// Commander action sees `result.dryRun === true` to skip its own wrap.
//
// There is NO ERC20 approve step here — the dividend contract pays out
// from its own pool, the user is the recipient, not the payer.

import { Command } from 'commander';
import {
  decodeEventLog,
  encodeFunctionData,
} from 'viem';
import { getPublicClient, getChainId } from '../lib/chain.js';
import { getWalletClient, getAccount } from '../lib/wallet.js';
import { getTokenInfo } from '../lib/api.js';
import { dividendABI } from '../lib/tax-abis.js';
import {
  resolveDividendContract,
  buildClaimArgs,
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

async function emitDryRun({
  publicClient,
  account,
  target,
  args,
}) {
  const calldata = encodeFunctionData({
    abi: dividendABI,
    functionName: 'withdrawDividendsFor',
    args,
  });
  let simulate;
  try {
    await publicClient.simulateContract({
      address: target,
      abi: dividendABI,
      functionName: 'withdrawDividendsFor',
      args,
      account: account.address,
    });
    simulate = { ok: true };
  } catch (error) {
    simulate = { ok: false, error: error.shortMessage || error.message };
  }
  const safeArgs = JSON.parse(
    JSON.stringify(args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
  return {
    success: true,
    dryRun: true,
    mode: 'tax',
    functionName: 'withdrawDividendsFor',
    target,
    args: safeArgs,
    value: '0',
    calldata,
    simulate,
  };
}

// L2 Codex R1 🟡 — `dividendABI` now ports the 2 claim-relevant events
// (`DividendRewardDebtChanged` on success · `DividendWithdrawalFailed` on
// per-user failure). We prefer the Failed event when present (most
// actionable for the operator: "the claim tx succeeded but your address
// silently failed"), otherwise fall back to the first RewardDebtChanged
// for the calling user. Upstream does NOT emit a dedicated "Withdrawn"
// event — a successful claim is signalled by the accounting update in
// `DividendRewardDebtChanged` + a plain WETH/USDC ERC20 `Transfer` log.
function decodeClaimEvent(receipt) {
  if (!receipt?.logs?.length) return null;
  const hits = [];
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: dividendABI,
        data: log.data,
        topics: log.topics,
      });
      if (decoded) hits.push(decoded);
    } catch {
      // not a dividend-ABI event — keep scanning
    }
  }
  if (!hits.length) return null;
  // Prefer a failure event — critical signal for operator.
  const failure = hits.find((h) => h.eventName === 'DividendWithdrawalFailed');
  const chosen = failure || hits[0];
  return {
    eventName: chosen.eventName,
    args: JSON.parse(
      JSON.stringify(chosen.args || {}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
    ),
  };
}

export async function dividendClaimCommand(tokenAddress, options = {}) {
  const chainId = getChainId();
  const publicClient = getPublicClient();
  const isDryRun = !!options.dryRun;

  const infoResp = await getTokenInfo(tokenAddress);
  const coin = unwrapApiResponse(infoResp);
  if (!coin || !coin.contract_address) {
    throw new Error(`Token info not found for ${tokenAddress}`);
  }

  const extraData = safeJsonParse(coin.extra_data) || {};
  const coinVersion = coin.coin_version || extraData?.coin_version;
  assertTaxToken(coinVersion);

  const coinWithExtra = { ...coin, extra_data: extraData };
  const dividendContract = resolveDividendContract(coinWithExtra);

  const account = getAccount();
  const forAddress = options?.for;
  if (forAddress) validateUserAddress(forAddress, '--for address');

  const { args, warnings } = buildClaimArgs({
    callerAddress: account.address,
    forAddress,
    keepWeth: !!options.keepWeth,
  });
  // Post-build defensive check — `args[0]` is either the already-labeled
  // `--for` address or the caller's wallet. Default label is fine: the
  // primary error surfaces from the `--for` check above.
  validateUserAddress(args[0]);

  for (const msg of warnings) {
    // Warn on stderr so JSON stdout stays machine-readable (single-source
    // output envelope from the action wrapper below).
    // eslint-disable-next-line no-console
    console.error(`[warn] ${msg}`);
  }

  if (isDryRun) {
    // Build full payload BEFORE logging so stdout and return value match —
    // subprocess consumers otherwise miss chainId / token / warnings
    // (L2🟡 + L3🟡 applied to vault dry-runs; apply here for parity).
    const payload = {
      ...(await emitDryRun({
        publicClient,
        account,
        target: dividendContract,
        args,
      })),
      warnings,
      chainId,
      token: tokenAddress,
    };
    // Print the dry-run envelope directly (sentinel convention: action
    // wrapper checks `result.dryRun === true` and skips the outer wrap).
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  // Real write: simulate first, then writeContract.
  try {
    await publicClient.simulateContract({
      address: dividendContract,
      abi: dividendABI,
      functionName: 'withdrawDividendsFor',
      args,
      account: account.address,
    });
  } catch (error) {
    // Surface the original shortMessage for actionable debugging.
    throw new Error(
      `dividend-claim simulate failed: ${error.shortMessage || error.message}`,
    );
  }

  const walletClient = getWalletClient();
  const hash = await walletClient.writeContract({
    address: dividendContract,
    abi: dividendABI,
    functionName: 'withdrawDividendsFor',
    args,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`dividend-claim tx reverted (tx: ${receipt.transactionHash})`);
  }

  const event = decodeClaimEvent(receipt);

  return {
    action: 'dividend-claim',
    mode: 'tax',
    txHash: hash,
    chainId,
    token: tokenAddress,
    dividendContract,
    user: args[0],
    unwrapWETH: args[1],
    warnings,
    event,
    receipt: {
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    },
  };
}

export const dividendClaim = new Command('dividend-claim')
  .description('Claim per-token dividends (pulls from pool; no approve needed)')
  .argument('<tokenAddress>', 'Tax token contract address (coin_version >= 11.2.0)')
  .option('--for <address>', 'Claim on behalf of another user (forces unwrapWETH=true)')
  .option('--keep-weth', 'Receive WETH instead of unwrapping to ETH (self-claim only)')
  .option('--dry-run', 'Decode + simulate without submitting')
  .action(async (tokenAddress, options) => {
    try {
      const result = await dividendClaimCommand(tokenAddress, options);
      // Sentinel: dry-run paths print their own payload via emitDryRun.
      if (result && result.dryRun === true) return;
      console.log(JSON.stringify({ success: true, data: result }, null, 2));
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error?.message || String(error) }),
      );
      process.exit(1);
    }
  });
