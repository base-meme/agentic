// `basememe vault-claim <tokenAddress> [--for <addr>] [--dry-run]`
//
// Pulls the caller's (or `--for` address') accrued quote share from a
// Split vault via `claim(user)`. The vault pays out in the coin's quote
// token (USDC or ETH-via-WETH, per `coin.currency_address`) — unlike
// dividend-claim, there is no unwrap flag here; the vault dispatcher
// handles payout token internally.
//
// Only valid for `vault_type === 'split'`. Snowball / BurnDividend / Gift
// vaults have their own dedicated write commands (vault-burn / -reward
// / gift-proof-*).

import { Command } from 'commander';
import { encodeFunctionData, getAddress } from 'viem';

import { getPublicClient, getChainId } from '../lib/chain.js';
import { getWalletClient, getAccount } from '../lib/wallet.js';
import { getTokenInfo } from '../lib/api.js';
import { splitVaultABI } from '../lib/tax-abis.js';
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

async function emitDryRun({ publicClient, account, target, args }) {
  const calldata = encodeFunctionData({
    abi: splitVaultABI,
    functionName: 'claim',
    args,
  });
  let simulate;
  try {
    await publicClient.simulateContract({
      address: target,
      abi: splitVaultABI,
      functionName: 'claim',
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
    functionName: 'claim',
    mode: 'tax',
    simulate,
    success: true,
    target,
    value: '0',
  };
}

export async function vaultClaimCommand(tokenAddress, options = {}) {
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
  if (vaultType !== 'split') {
    throw new Error(
      `vault-claim only applies to split vaults (this token has vault_type=${vaultType})`,
    );
  }

  const account = getAccount();
  const forAddress = options?.for;
  if (forAddress) {
    validateUserAddress(forAddress, '--for address');
  }
  const beneficiary = forAddress ? getAddress(forAddress) : getAddress(account.address);
  // Post-build sanity check — `beneficiary` is either the already-labeled
  // `--for` address (re-validated defensively) or the connected wallet.
  // Default label suffices: the primary error surfaces from the --for
  // check above, so this branch only trips on a truly malformed account.
  validateUserAddress(beneficiary);

  const args = [beneficiary];

  if (isDryRun) {
    // Build full payload BEFORE logging so stdout and return value match —
    // subprocess consumers otherwise miss chainId / token (L2🟡 + L3🟡).
    // L3 #6 polish: compose alphabetically, explicit keys.
    const dry = await emitDryRun({
      publicClient,
      account,
      target: vaultAddress,
      args,
    });
    const payload = {
      args: dry.args,
      calldata: dry.calldata,
      chainId,
      dryRun: dry.dryRun,
      functionName: dry.functionName,
      mode: dry.mode,
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
      abi: splitVaultABI,
      functionName: 'claim',
      args,
      account: account.address,
    });
  } catch (error) {
    throw new Error(
      `vault-claim simulate failed: ${error.shortMessage || error.message}`,
    );
  }

  const walletClient = getWalletClient();
  const hash = await walletClient.writeContract({
    address: vaultAddress,
    abi: splitVaultABI,
    functionName: 'claim',
    args,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error(`vault-claim tx reverted (tx: ${receipt.transactionHash})`);
  }

  // Top-level keys alphabetized — keep in order when adding fields
  // (Polish Fix R1 · L3 #2 convention; see vault-info.js for details).
  return {
    action: 'vault-claim',
    beneficiary,
    chainId,
    mode: 'tax',
    receipt: {
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    },
    token: getAddress(tokenAddress),
    txHash: hash,
    vault: vaultAddress,
    vaultType,
  };
}

export const vaultClaim = new Command('vault-claim')
  .description('Claim accumulated quote share from a Split vault')
  .argument('<tokenAddress>', 'Tax token contract address (coin_version >= 11.2.0, split vault)')
  .option('--for <address>', 'Claim on behalf of another address (beneficiary)')
  .option('--dry-run', 'Decode + simulate without submitting')
  .action(async (tokenAddress, options) => {
    try {
      const result = await vaultClaimCommand(tokenAddress, options);
      if (result && result.dryRun === true) return;
      console.log(JSON.stringify({ success: true, data: result }, null, 2));
    } catch (error) {
      console.error(
        JSON.stringify({ success: false, error: error?.message || String(error) }),
      );
      process.exit(1);
    }
  });
