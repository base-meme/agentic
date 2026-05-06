// `basememe vault-burn <tokenAddress> <amount> [--dry-run]`
//
// User-facing BurnDividend burn: caller burns `amount` (human units, 18-dec)
// of the tax token to earn quote-token reward on the BurnDividend vault.
//
// Three-step flow matches frontend `vault-detail/index.tsx:513-597`:
//   1. Read factory from `vault.factory()` (CI-09: factory — NOT vault —
//      is the approve spender because factory does the actual transferFrom).
//   2. If allowance < amount: approve + HOTFIX #4 poll allowance up to
//      30×1s + 1s buffer. Throw on timeout (no silent proceed).
//   3. vault.burn(amount) — simulate then write.

import { Command } from 'commander';
import { encodeFunctionData, getAddress, parseUnits } from 'viem';

import { getPublicClient, getChainId } from '../lib/chain.js';
import { getWalletClient, getAccount } from '../lib/wallet.js';
import { getTokenInfo } from '../lib/api.js';
import {
  burnDividendVaultABI,
  basememeTaxTokenABI,
} from '../lib/tax-abis.js';
import { assertTaxToken } from '../lib/dividend-helpers.js';
import { resolveVaultData } from '../lib/vault-helpers.js';

const TAX_TOKEN_DECIMALS = 18;

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

function parseAmount(raw) {
  if (raw === undefined || raw === null || raw === '') {
    throw new Error('amount is required (e.g. "1.5")');
  }
  let parsed;
  try {
    parsed = parseUnits(String(raw), TAX_TOKEN_DECIMALS);
  } catch (error) {
    throw new Error(`amount parse failed: ${error?.shortMessage || error?.message || raw}`);
  }
  if (parsed <= 0n) {
    throw new Error('amount must be positive');
  }
  return parsed;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForAllowanceUpdate({
  publicClient,
  token,
  owner,
  spender,
  minAmount,
  maxIterations,
  intervalMs,
  bufferMs,
}) {
  for (let i = 0; i < maxIterations; i += 1) {
    const latest = await publicClient.readContract({
      address: token,
      abi: basememeTaxTokenABI,
      functionName: 'allowance',
      args: [owner, spender],
    });
    if (latest >= minAmount) {
      if (bufferMs > 0) await sleep(bufferMs);
      return latest;
    }
    if (intervalMs > 0) await sleep(intervalMs);
  }
  // HOTFIX #4 timeout path — surface to operator rather than silently
  // proceeding to `burn()` which would revert on ERC20InsufficientAllowance
  // anyway (closing a Phase 2 deferred 🟡 of same semantic).
  throw new Error(
    `Allowance did not update to >= ${minAmount} for spender ${spender} after ${maxIterations} poll iterations`,
  );
}

async function emitDryRun({
  publicClient,
  account,
  target,
  args,
  factory,
  amountRaw,
}) {
  const calldata = encodeFunctionData({
    abi: burnDividendVaultABI,
    functionName: 'burn',
    args,
  });
  let simulate;
  try {
    await publicClient.simulateContract({
      address: target,
      abi: burnDividendVaultABI,
      functionName: 'burn',
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
  // `approveSpender`/`approveReason` are vault-burn specific (CI-09:
  // factory executes transferFrom(user → DEAD), so user must approve
  // factory not the vault) — legitimately absent from other emitDryRun
  // helpers.
  return {
    amountRaw,
    approveReason: 'CI-09 · factory executes transferFrom(user → DEAD)',
    approveSpender: factory,
    args: safeArgs,
    calldata,
    dryRun: true,
    functionName: 'burn',
    mode: 'tax',
    simulate,
    success: true,
    target,
    value: '0',
  };
}

export async function vaultBurnCommand(tokenAddress, amount, options = {}) {
  const chainId = getChainId();
  const publicClient = getPublicClient();
  const isDryRun = !!options.dryRun;

  const amountWei = parseAmount(amount);

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
      `vault-burn only applies to burn_dividend vaults (this token has vault_type=${vaultType})`,
    );
  }

  const account = getAccount();
  const owner = getAddress(account.address);
  const token = getAddress(tokenAddress);

  // CI-09: read factory from vault (never hard-code vault as spender).
  const factory = getAddress(
    await publicClient.readContract({
      address: vaultAddress,
      abi: burnDividendVaultABI,
      functionName: 'factory',
    }),
  );

  const args = [amountWei];

  if (isDryRun) {
    // Build full payload BEFORE logging so stdout and return value match —
    // subprocess consumers otherwise miss chainId / token (L2🟡 + L3🟡).
    // L3 #6 polish: alphabetical top-level.
    const dry = await emitDryRun({
      publicClient,
      account,
      target: vaultAddress,
      args,
      factory,
      amountRaw: String(amountWei),
    });
    const payload = {
      amountRaw: dry.amountRaw,
      approveReason: dry.approveReason,
      approveSpender: dry.approveSpender,
      args: dry.args,
      calldata: dry.calldata,
      chainId,
      dryRun: dry.dryRun,
      functionName: dry.functionName,
      mode: dry.mode,
      simulate: dry.simulate,
      success: dry.success,
      target: dry.target,
      token,
      value: dry.value,
    };
    console.log(JSON.stringify(payload, null, 2));
    return payload;
  }

  const walletClient = getWalletClient();

  // Step 1: check + approve if insufficient.
  const currentAllowance = await publicClient.readContract({
    address: token,
    abi: basememeTaxTokenABI,
    functionName: 'allowance',
    args: [owner, factory],
  });

  if (currentAllowance < amountWei) {
    await publicClient.simulateContract({
      address: token,
      abi: basememeTaxTokenABI,
      functionName: 'approve',
      args: [factory, amountWei],
      account: owner,
    });
    const approveHash = await walletClient.writeContract({
      address: token,
      abi: basememeTaxTokenABI,
      functionName: 'approve',
      args: [factory, amountWei],
    });
    // B2: capture the receipt and throw immediately on revert. Previously
    // the return value was discarded — a reverted approve proceeded to the
    // HOTFIX #4 poll, spun 30×1s, and surfaced as "Allowance did not
    // update..." which misdirects the operator away from the real root
    // cause (reverted approve tx itself). Must run BEFORE the poll.
    const approveReceipt = await publicClient.waitForTransactionReceipt({
      hash: approveHash,
    });
    if (approveReceipt.status !== 'success') {
      throw new Error(
        `vault-burn approve tx reverted (tx: ${approveReceipt.transactionHash})`,
      );
    }

    // HOTFIX #4: poll until allowance is visible. Tests may override
    // timing via `__maxPollIterations` / `__pollIntervalMs` / `__skipBuffer`.
    await waitForAllowanceUpdate({
      publicClient,
      token,
      owner,
      spender: factory,
      minAmount: amountWei,
      maxIterations: options.__maxPollIterations ?? 30,
      intervalMs: options.__pollIntervalMs ?? 1000,
      bufferMs: options.__skipBuffer ? 0 : 1000,
    });
  }

  // Step 2: simulate + burn.
  try {
    await publicClient.simulateContract({
      address: vaultAddress,
      abi: burnDividendVaultABI,
      functionName: 'burn',
      args,
      account: owner,
    });
  } catch (error) {
    throw new Error(
      `vault-burn simulate failed: ${error.shortMessage || error.message}`,
    );
  }

  const burnHash = await walletClient.writeContract({
    address: vaultAddress,
    abi: burnDividendVaultABI,
    functionName: 'burn',
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: burnHash });
  if (receipt.status !== 'success') {
    throw new Error(`vault-burn tx reverted (tx: ${receipt.transactionHash})`);
  }

  // Top-level keys alphabetized — keep in order when adding fields
  // (Polish Fix R1 · L3 #2 convention; see vault-info.js for details).
  return {
    action: 'vault-burn',
    amountRaw: String(amountWei),
    chainId,
    factory,
    mode: 'tax',
    receipt: {
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    },
    token,
    txHash: burnHash,
    user: owner,
    vault: vaultAddress,
    vaultType,
  };
}

export const vaultBurn = new Command('vault-burn')
  .description('Burn tax tokens into a BurnDividend vault for quote reward')
  .argument('<tokenAddress>', 'Tax token contract address (coin_version >= 11.2.0, burn_dividend vault)')
  .argument('<amount>', 'Amount of tax tokens to burn (human units, 18-dec)')
  .option('--dry-run', 'Decode + simulate without submitting')
  .action(async (tokenAddress, amount, options) => {
    try {
      const result = await vaultBurnCommand(tokenAddress, amount, options);
      if (result && result.dryRun === true) return;
      console.log(JSON.stringify({ success: true, data: result }, null, 2));
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error?.message || String(error) }),
      );
      process.exit(1);
    }
  });
