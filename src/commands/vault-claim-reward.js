// `basememe vault-claim-reward <tokenAddress> [--to <addr>] [--dry-run]`
//
// Pulls accrued quote reward from a BurnDividend vault. Default calls
// `claimReward()` (pays caller). `--to <addr>` switches to
// `claimRewardTo(to)` to redirect payout to another wallet (still signed
// by caller).
//
// Reference: frontend `vault-detail/index.tsx:599-626` (calls
// `claimReward()` only). The `--to` branch invoking `claimRewardTo(to)`
// is a CLI-only extension for delegated payout — no frontend counterpart.
// No approve needed — reward is paid from vault's own quote-token balance.

import { Command } from 'commander';
import { encodeFunctionData, getAddress } from 'viem';

import { getPublicClient, getChainId } from '../lib/chain.js';
import { getWalletClient, getAccount } from '../lib/wallet.js';
import { getTokenInfo } from '../lib/api.js';
import { burnDividendVaultABI } from '../lib/tax-abis.js';
import { assertTaxToken, validateUserAddress } from '../lib/dividend-helpers.js';
import { resolveVaultData } from '../lib/vault-helpers.js';

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

async function emitDryRun({ publicClient, account, target, functionName, args }) {
  const calldata = encodeFunctionData({
    abi: burnDividendVaultABI,
    functionName,
    args,
  });
  let simulate;
  try {
    await publicClient.simulateContract({
      address: target,
      abi: burnDividendVaultABI,
      functionName,
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
  // L3 #6 polish: alphabetized top-level keys.
  return {
    args: safeArgs,
    calldata,
    dryRun: true,
    functionName,
    mode: 'tax',
    simulate,
    success: true,
    target,
    value: '0',
  };
}

export async function vaultClaimRewardCommand(tokenAddress, options = {}) {
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
  const { vaultType, vaultAddress } = resolveVaultData(coinWithExtra);
  if (vaultType !== 'burn_dividend') {
    throw new Error(
      `vault-claim-reward only applies to burn_dividend vaults (this token has vault_type=${vaultType})`,
    );
  }

  const account = getAccount();
  const to = options?.to;
  if (to) validateUserAddress(to, '--to address');

  const functionName = to ? 'claimRewardTo' : 'claimReward';
  const args = to ? [getAddress(to)] : [];

  // Advisory: show pendingReward to help the operator decide whether the
  // tx is worth paying gas for. Zero reward is a warn, not an error —
  // the contract call will succeed but yield no transfer.
  const pendingReward = await publicClient.readContract({
    address: vaultAddress,
    abi: burnDividendVaultABI,
    functionName: 'pendingReward',
    args: [getAddress(account.address)],
  });
  // Polish Fix R1 · L1 #1 revert: `claimRewardTo(to)` still pulls the
  // CALLER's own pending reward — `to` only redirects payout. So
  // `pendingReward(caller) === 0n` means the tx will succeed but
  // transfer nothing in BOTH self-claim AND `--to` paths. Warn in both
  // cases so the operator doesn't silently waste gas. The enriched
  // message is explicit about whose reward is being checked, so the
  // `--to` caller doesn't misread it as "the recipient's pending is 0".
  if (pendingReward === 0n) {
    console.error(
      `[warn] caller (${account.address}) has pendingReward=0 — claim will succeed but transfer nothing (claimRewardTo still pulls caller's reward, then sends to --to)`,
    );
  }

  if (isDryRun) {
    // Build full payload BEFORE logging so stdout and return value match —
    // subprocess consumers otherwise miss chainId / token / pendingReward
    // (L2🟡 + L3🟡). L3 #6 polish: alphabetical top-level.
    const dry = await emitDryRun({
      publicClient,
      account,
      target: vaultAddress,
      functionName,
      args,
    });
    const payload = {
      args: dry.args,
      calldata: dry.calldata,
      chainId,
      dryRun: dry.dryRun,
      functionName: dry.functionName,
      mode: dry.mode,
      pendingReward: String(pendingReward),
      simulate: dry.simulate,
      success: dry.success,
      target: dry.target,
      token: getAddress(tokenAddress),
      value: dry.value,
    };
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  try {
    await publicClient.simulateContract({
      address: vaultAddress,
      abi: burnDividendVaultABI,
      functionName,
      args,
      account: account.address,
    });
  } catch (error) {
    throw new Error(
      `vault-claim-reward simulate failed: ${error.shortMessage || error.message}`,
    );
  }

  const walletClient = getWalletClient();
  const hash = await walletClient.writeContract({
    address: vaultAddress,
    abi: burnDividendVaultABI,
    functionName,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`vault-claim-reward tx reverted (tx: ${receipt.transactionHash})`);
  }

  // Top-level keys alphabetized — keep in order when adding fields
  // (Polish Fix R1 · L3 #2 convention; see vault-info.js for details).
  return {
    action: 'vault-claim-reward',
    chainId,
    mode: 'tax',
    pendingReward: String(pendingReward),
    receipt: {
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    },
    recipient: to ? getAddress(to) : getAddress(account.address),
    token: getAddress(tokenAddress),
    txHash: hash,
    user: getAddress(account.address),
    vault: vaultAddress,
    vaultType,
  };
}

export const vaultClaimReward = new Command('vault-claim-reward')
  .description('Claim accrued quote reward from a BurnDividend vault')
  .argument('<tokenAddress>', 'Tax token contract address (coin_version >= 11.2.0, burn_dividend vault)')
  .option('--to <address>', 'Redirect payout to this address (caller still signs)')
  .option('--dry-run', 'Decode + simulate without submitting')
  .action(async (tokenAddress, options) => {
    try {
      const result = await vaultClaimRewardCommand(tokenAddress, options);
      if (result && result.dryRun === true) return;
      console.log(JSON.stringify({ success: true, data: result }, null, 2));
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error?.message || String(error) }),
      );
      process.exit(1);
    }
  });
