import { Command } from 'commander';
import { readFileSync, existsSync } from 'fs';
import { resolve, extname } from 'path';
import {
  decodeEventLog,
  encodeFunctionData,
  isAddress,
  parseUnits,
} from 'viem';
import axios from 'axios';
import { getApiUrl, getChainId, getPublicClient } from '../lib/chain.js';
import { getAccount, getWalletClient } from '../lib/wallet.js';
import {
  basememeFactoryABI,
  basememeFactoryEvents,
  basememeTaxFactoryEvents,
  basememeTaxFactoryImplABI,
  erc20ABI,
  getAddresses,
  taxAddresses,
} from '../lib/contracts.js';
import { getCollateralTemplate, ZERO_ADDRESS } from '../lib/chain-configs.js';
import {
  buildCreateParams,
  buildTaxCreateParams,
  decodeTaxArgsForDisplay,
  DEFAULT_DIVIDEND_ELIGIBILITY_TOKENS,
  fetchSalt,
  isTaxCreateMode,
  md5Hex,
  validateTaxSettings,
} from '../lib/create-helpers.js';

const EXT_TO_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mpeg': 'video/mpeg',
};

/**
 * Parses tax-factory specific CLI flags into a structured object.
 * Returns `{ taxRate: undefined }` when --tax-rate is absent so
 * `isTaxCreateMode` drops the request back to the V4 path.
 */
function parseTaxFlags(options) {
  if (options.taxRate == null) {
    return { taxRate: undefined };
  }

  const parseIntFlag = (raw, label) => {
    if (raw == null) return undefined;
    const num = Number.parseInt(raw, 10);
    if (!Number.isInteger(num)) {
      throw new Error(`Invalid ${label}: ${raw}`);
    }
    return num;
  };

  let splitRecipients;
  if (options.splitRecipients) {
    try {
      splitRecipients = JSON.parse(options.splitRecipients);
    } catch (error) {
      throw new Error(`Invalid --split-recipients JSON: ${error.message}`);
    }
    if (!Array.isArray(splitRecipients)) {
      throw new Error('--split-recipients must be a JSON array');
    }
  }

  return {
    taxRate: parseIntFlag(options.taxRate, '--tax-rate'),
    fundsBps: parseIntFlag(options.fundsBps ?? 0, '--funds-bps') ?? 0,
    burnBps: parseIntFlag(options.burnBps ?? 0, '--burn-bps') ?? 0,
    dividendBps: parseIntFlag(options.dividendBps ?? 0, '--dividend-bps') ?? 0,
    liquidityBps: parseIntFlag(options.liquidityBps ?? 0, '--liquidity-bps') ?? 0,
    dividendEligibilityTokens:
      options.dividendEligibilityTokens != null
        ? Number(options.dividendEligibilityTokens)
        : Number(DEFAULT_DIVIDEND_ELIGIBILITY_TOKENS),
    marketMode: options.marketMode,
    marketRecipient: options.marketRecipient,
    splitRecipients,
    giftXHandle: options.giftXHandle,
  };
}

/**
 * Tax-factory create path. Mirrors the V4 path's ordering but calls the
 * tax factory address with `basememeTaxFactoryImplABI`. See
 * freee-system/BASEMEME_AI_TAX_PLAN.md Phase 3.
 *
 * Steps:
 *   1. Validate all tax + vault inputs (HOTFIX #7 early error for vault +
 *      non-ETH collateral, HOTFIX #8 marketPayoutRecipient fallback).
 *   2. Upload metadata to IPFS (reuse the V4 upload helper).
 *   3. Fetch token salt from backend (tax factory + tax-token impl).
 *   4. Build the 24-field CreateParams struct (HOTFIX #9 shape guard).
 *   5. If --dry-run: print decoded + simulateContract result and return.
 *   6. Approve ERC20 collateral (only relevant for ETH-pair + buy? — vault
 *      mode is ETH-only; USDC path is evm-recipient only).
 *   7. Call factory.writeContract → NewBasememeTaxFactoryToken-esque log.
 *   8. Notify backend via /coin/submit_tx_id (non-fatal).
 *   9. Print JSON summary.
 */
async function runTaxCreate(rawOptions, taxOptions) {
  const errors = [];
  const pair = String(rawOptions.pair || 'ETH').trim().toUpperCase();
  const imagePath = resolve(process.cwd(), rawOptions.image || '');

  if (!rawOptions.name) errors.push('--name is required');
  if (rawOptions.name && rawOptions.name.length > 32) errors.push('--name max 32 chars');
  if (!rawOptions.symbol) errors.push('--symbol is required');
  if (rawOptions.symbol && rawOptions.symbol.length > 15) errors.push('--symbol max 15 chars');
  if (!rawOptions.image) {
    errors.push('--image is required');
  } else if (!existsSync(imagePath)) {
    errors.push(`Image not found: ${imagePath}`);
  }
  const imageExt = rawOptions.image ? extname(imagePath).toLowerCase() : null;

  let mediaPath = null;
  let mediaExt = null;
  if (rawOptions.media) {
    mediaPath = resolve(process.cwd(), rawOptions.media);
    if (!existsSync(mediaPath)) errors.push(`Media not found: ${mediaPath}`);
    mediaExt = extname(mediaPath).toLowerCase();
  }

  const chainId = getChainId();
  let template = null;
  try {
    template = getCollateralTemplate(chainId, pair);
  } catch (error) {
    errors.push(error.message);
  }

  if (errors.length > 0) {
    console.error(JSON.stringify({ success: false, errors }));
    process.exit(1);
  }

  const validation = validateTaxSettings(taxOptions, {
    pair,
    collateralToken: template.COLLATERAL_TOKEN,
  });
  if (!validation.ok) {
    console.error(JSON.stringify({ success: false, error: validation.error }));
    process.exit(1);
  }

  const taxAddrs = taxAddresses[chainId];
  if (!taxAddrs || !taxAddrs.basememeTaxFactory || !taxAddrs.basememeTaxToken) {
    console.error(JSON.stringify({
      success: false,
      error: `Tax factory addresses not configured for chain ${chainId}. Mainnet tax support lands after Phase 6.`,
    }));
    process.exit(1);
  }

  const account = getAccount();
  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const apiUrl = getApiUrl();

  // Salt is derived from the tax factory + tax-token impl pair (frontend
  // onemorething/index.tsx:247-257 switches to tax addresses when tax is
  // enabled — same contract here).
  const salt = await fetchSalt(
    apiUrl,
    taxAddrs.basememeTaxFactory,
    taxAddrs.basememeTaxToken,
  );

  let buyAmountWei = 0n;
  if (rawOptions.buyAmount != null) {
    const buyAmountRaw = Number.parseFloat(rawOptions.buyAmount);
    if (!Number.isFinite(buyAmountRaw) || buyAmountRaw < 0) {
      throw new Error(`Invalid --buy-amount: "${rawOptions.buyAmount}"`);
    }
    if (buyAmountRaw > 0) {
      buyAmountWei = parseUnits(String(rawOptions.buyAmount), template.DECIMALS);
    }
  }

  // ── Upload metadata (same contract as V4 path) ──
  console.error('Uploading metadata...');
  const imageBuffer = readFileSync(imagePath);
  const imageMime = EXT_TO_MIME[imageExt] || 'application/octet-stream';
  const imageBlob = new Blob([imageBuffer], { type: imageMime });
  const imageFilename = `image${imageExt}`;
  const formData = new FormData();
  formData.append('name', rawOptions.name);
  formData.append('symbol', rawOptions.symbol);
  if (rawOptions.description) formData.append('description', rawOptions.description);
  if (rawOptions.website) formData.append('website', rawOptions.website);
  if (rawOptions.twitter) formData.append('twitter', rawOptions.twitter);
  if (rawOptions.telegram) formData.append('telegram', rawOptions.telegram);
  formData.append('image', imageBlob, imageFilename);

  if (mediaPath) {
    const mediaBuffer = readFileSync(mediaPath);
    const mediaMime = EXT_TO_MIME[mediaExt] || 'application/octet-stream';
    const mediaBlob = new Blob([mediaBuffer], { type: mediaMime });
    const mediaFilename = `media${mediaExt}`;
    formData.append('media', mediaBlob, mediaFilename);
  }

  let tokenUri;
  if (rawOptions.dryRun) {
    // On dry-run we don't hit IPFS — use a placeholder so buildTaxCreateParams
    // can still produce the 24-field tuple deterministically.
    tokenUri = 'ipfs://dry-run';
  } else {
    const uploadResp = await axios.post(`${apiUrl}/private/token/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60_000,
    });
    if (uploadResp.data.code !== 0) {
      throw new Error(`IPFS upload failed: ${uploadResp.data.msg}`);
    }
    tokenUri = uploadResp.data.data.token_uri;
  }

  const built = buildTaxCreateParams({
    name: rawOptions.name,
    symbol: rawOptions.symbol,
    tokenUri,
    salt,
    account: account.address,
    chainId,
    pair,
    taxRate: taxOptions.taxRate,
    fundsBps: taxOptions.fundsBps,
    burnBps: taxOptions.burnBps,
    dividendBps: taxOptions.dividendBps,
    liquidityBps: taxOptions.liquidityBps,
    dividendEligibilityTokens: taxOptions.dividendEligibilityTokens,
    marketMode: taxOptions.marketMode,
    marketRecipient: taxOptions.marketRecipient,
    splitRecipients: taxOptions.splitRecipients,
    giftXHandle: taxOptions.giftXHandle,
    buyAmountWei,
    minTokenOut: 0n,
  });

  const writeArgs = built.buyArgs
    ? [built.createArgs[0], built.buyArgs[0]]
    : [built.createArgs[0]];

  if (rawOptions.dryRun) {
    const calldata = encodeFunctionData({
      abi: basememeTaxFactoryImplABI,
      functionName: built.functionName,
      args: writeArgs,
    });
    let simulateResult = null;
    try {
      simulateResult = await publicClient.simulateContract({
        address: taxAddrs.basememeTaxFactory,
        abi: basememeTaxFactoryImplABI,
        functionName: built.functionName,
        args: writeArgs,
        account: account.address,
        ...(built.value > 0n ? { value: built.value } : {}),
      });
    } catch (error) {
      // Simulation may fail for legit reasons on dry-run (e.g. insufficient
      // balance in test wallet). Surface the error but keep dry-run exit=0
      // so the decoded view is still useful.
      simulateResult = { simulateError: error.shortMessage || error.message };
    }
    console.log(JSON.stringify({
      success: true,
      dryRun: true,
      mode: 'tax',
      functionName: built.functionName,
      factory: taxAddrs.basememeTaxFactory,
      args: decodeTaxArgsForDisplay(built, writeArgs),
      value: built.value.toString(),
      calldata,
      simulate: simulateResult?.simulateError
        ? { ok: false, error: simulateResult.simulateError }
        : { ok: true },
    }, null, 2));
    return;
  }

  // ── ERC20 approve (only if collateral != ETH; vault modes are ETH-only,
  // so this path runs for evm-recipient + USDC). ──
  const isEthPair = template.COLLATERAL_TOKEN === ZERO_ADDRESS;
  if (!isEthPair && buyAmountWei > 0n) {
    const allowance = await publicClient.readContract({
      address: template.COLLATERAL_TOKEN,
      abi: erc20ABI,
      functionName: 'allowance',
      args: [account.address, taxAddrs.basememeTaxFactory],
    });
    if (allowance < buyAmountWei) {
      if (allowance > 0n) {
        const resetTx = await walletClient.writeContract({
          address: template.COLLATERAL_TOKEN,
          abi: erc20ABI,
          functionName: 'approve',
          args: [taxAddrs.basememeTaxFactory, 0n],
        });
        const resetReceipt = await publicClient.waitForTransactionReceipt({ hash: resetTx });
        if (resetReceipt.status !== 'success') {
          throw new Error(`ERC20 approve reset reverted (tx: ${resetTx}).`);
        }
      }
      const approveTx = await walletClient.writeContract({
        address: template.COLLATERAL_TOKEN,
        abi: erc20ABI,
        functionName: 'approve',
        args: [taxAddrs.basememeTaxFactory, buyAmountWei],
      });
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
      if (approveReceipt.status !== 'success') {
        throw new Error(`ERC20 approve reverted (tx: ${approveTx}).`);
      }
    }
  }

  const txHash = await walletClient.writeContract({
    address: taxAddrs.basememeTaxFactory,
    abi: basememeTaxFactoryImplABI,
    functionName: built.functionName,
    args: writeArgs,
    ...(built.value > 0n ? { value: built.value } : {}),
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    console.error(JSON.stringify({
      success: false,
      error: 'Transaction reverted',
      transactionHash: txHash,
    }));
    process.exit(1);
  }

  // Decode the tax factory's `NewBasememeToken` receipt event — 12-field
  // shape signature-aligned with the V4 factory (HOTFIX #9, resolves Phase 3
  // 🟡 #1). The ABI comes from `basememeTaxFactoryEvents` now that it's
  // exported; we fall back to null if no matching log is present (e.g. the
  // tx reverted in a way that still produced a success status, which would
  // be an unusual on-chain edge case).
  let tokenAddress = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: basememeTaxFactoryEvents,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName === 'NewBasememeToken' && decoded.args?.addr) {
        tokenAddress = decoded.args.addr;
        break;
      }
    } catch {
      // unrelated log — skip.
    }
  }

  try {
    const submitForm = new FormData();
    submitForm.append('chain_id', String(chainId));
    submitForm.append('tx_id', txHash);
    submitForm.append('tx_type', '1');
    submitForm.append('user_address', account.address);
    submitForm.append('check_code', md5Hex(account.address, txHash));
    await axios.post(`${apiUrl}/coin/submit_tx_id`, submitForm, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  } catch (error) {
    console.error(`Backend notify failed: ${error.message}`);
  }

  console.log(JSON.stringify({
    success: true,
    data: {
      mode: 'tax',
      tokenAddress,
      transactionHash: txHash,
      pair,
      taxRate: Number(taxOptions.taxRate),
      marketMode: taxOptions.marketMode || null,
      buyAmount: rawOptions.buyAmount || '0',
    },
  }, null, 2));
}

/**
 * Converts the built CreateParams + (optional) buy struct into a
 * JSON-serialisable view (bigint → string) for --dry-run output.
 * Preserves upstream field order so the dry-run output is grep-friendly.
 */

export const create = new Command('create')
  .description('Create a new Basememe token')
  .requiredOption('-n, --name <name>', 'Token name (max 32 chars)')
  .requiredOption('-s, --symbol <symbol>', 'Token symbol (max 15 chars)')
  .requiredOption('-i, --image <path>', 'Path to token image (jpg/png/gif/webp, ≤5MB)')
  .option('-m, --media <path>', 'Path to media file (mp4/mov/mpeg, optional)')
  .option('-d, --description <text>', 'Token description')
  .option('-w, --website <url>', 'Website URL')
  .option('-t, --twitter <handle>', 'Twitter handle')
  .option('--telegram <handle>', 'Telegram handle')
  .option('--pair <type>', 'Collateral pair (ETH|USDC|SOL)', 'ETH')
  .option('--target-raise <amount>', 'Target raise in collateral units')
  .option('--bonding-curve-pct <pct>', 'Bonding curve % (50-80)', '80')
  .option('--vesting-pct <pct>', 'Creator vesting % (0-30)', '0')
  .option('--vesting-duration <value>', 'Vesting period (e.g. "6m", "90d", "1y")')
  .option('--cliff-duration <value>', 'Cliff/lockup period (e.g. "3m", "30d")')
  .option('--vesting-recipient <address>', 'Vesting recipient address')
  .option('--buy-amount <amount>', 'Optional first buy amount in collateral units')
  // ── Tax Factory flags (coin_version >= 11.2.0) ──────────────────────
  // Setting --tax-rate switches the command to the tax factory path.
  // See freee-system/BASEMEME_AI_TAX_PLAN.md Phase 3 for the full spec.
  .option('--tax-rate <rate>', 'Tax rate percent (one of 1|2|3|5)')
  .option('--funds-bps <bps>', 'Market (funds) allocation bps (0-10000)')
  .option('--burn-bps <bps>', 'Deflation (burn) allocation bps (0-10000)')
  .option('--dividend-bps <bps>', 'Dividend allocation bps (0-10000)')
  .option('--liquidity-bps <bps>', 'LP allocation bps (0-10000)')
  .option('--dividend-eligibility-tokens <n>', 'Minimum tokens to earn dividends (>=10000 when dividend-bps>0, default: 1000000)')
  .option('--market-mode <mode>', 'Market share destination (evm|split|snowball|burn|gift)')
  .option('--market-recipient <addr>', 'EVM recipient for market share (evm mode)')
  .option('--split-recipients <json>', 'Split recipients JSON: [{"address":"0x..","bps":5000},...]')
  .option('--gift-x-handle <handle>', 'X handle (without @) for gift mode')
  .option('--dry-run', 'Decode + simulate the create tx without submitting')
  .action(async (options) => {
    try {
      // Normalise tax numeric flags before branching.
      const taxOptions = parseTaxFlags(options);

      if (isTaxCreateMode(taxOptions)) {
        await runTaxCreate(options, taxOptions);
        return;
      }

      const errors = [];
      const pair = String(options.pair || 'ETH').trim().toUpperCase();
      const imagePath = resolve(process.cwd(), options.image);

      if (!options.name) errors.push('--name is required');
      if (options.name && options.name.length > 32) errors.push('--name max 32 chars');
      if (!options.symbol) errors.push('--symbol is required');
      if (options.symbol && options.symbol.length > 15) errors.push('--symbol max 15 chars');
      if (!existsSync(imagePath)) errors.push(`Image not found: ${imagePath}`);
      const imageExt = extname(imagePath).toLowerCase();

      let mediaPath = null;
      let mediaExt = null;
      if (options.media) {
        mediaPath = resolve(process.cwd(), options.media);
        if (!existsSync(mediaPath)) errors.push(`Media not found: ${mediaPath}`);
        mediaExt = extname(mediaPath).toLowerCase();
      }

      const bondingPct = Number.parseInt(options.bondingCurvePct, 10);
      const vestingPct = Number.parseInt(options.vestingPct, 10);
      if (Number.isNaN(bondingPct) || bondingPct < 50 || bondingPct > 80) {
        errors.push('--bonding-curve-pct must be 50-80');
      }
      if (Number.isNaN(vestingPct) || vestingPct < 0 || vestingPct > 30) {
        errors.push('--vesting-pct must be 0-30');
      }
      if (bondingPct + vestingPct + 20 !== 100) {
        errors.push(`bonding(${bondingPct}) + vesting(${vestingPct}) + migration(20) must = 100`);
      }
      if (options.vestingRecipient && !isAddress(options.vestingRecipient)) {
        errors.push(`Invalid --vesting-recipient address: ${options.vestingRecipient}`);
      }

      let template = null;
      try {
        template = getCollateralTemplate(getChainId(), pair);
      } catch (error) {
        errors.push(error.message);
      }

      if (errors.length > 0) {
        console.error(JSON.stringify({ success: false, errors }));
        process.exit(1);
      }

      const chainId = getChainId();
      const account = getAccount();
      const walletClient = getWalletClient();
      const publicClient = getPublicClient();
      const addrs = getAddresses();
      const apiUrl = getApiUrl();

      const salt = await fetchSalt(
        apiUrl,
        addrs.basememeFactory,
        addrs.basememeTokenImplementation,
      );

      const buildParams = ({ tokenUri }) =>
        buildCreateParams({
          name: options.name,
          symbol: options.symbol,
          tokenUri,
          salt,
          account: account.address,
          chainId,
          pair,
          targetRaise: options.targetRaise,
          bondingCurvePct: options.bondingCurvePct,
          vestingPct: options.vestingPct,
          vestingDuration: options.vestingDuration,
          cliffDuration: options.cliffDuration,
          vestingRecipient: options.vestingRecipient,
        });

      buildParams({
        tokenUri: 'ipfs://validation-only',
      });

      let isBuying = false;
      let buyAmountWei = 0n;
      if (options.buyAmount != null) {
        const buyAmountRaw = Number.parseFloat(options.buyAmount);
        if (!Number.isFinite(buyAmountRaw) || buyAmountRaw < 0) {
          throw new Error(`Invalid --buy-amount: "${options.buyAmount}"`);
        }
        isBuying = buyAmountRaw > 0;
        buyAmountWei = isBuying ? parseUnits(String(options.buyAmount), template.DECIMALS) : 0n;
      }

      console.error('Uploading metadata...');
      const imageBuffer = readFileSync(imagePath);
      const imageMime = EXT_TO_MIME[imageExt] || 'application/octet-stream';
      const imageBlob = new Blob([imageBuffer], { type: imageMime });
      const imageFilename = `image${imageExt}`;
      const formData = new FormData();
      formData.append('name', options.name);
      formData.append('symbol', options.symbol);
      if (options.description) formData.append('description', options.description);
      if (options.website) formData.append('website', options.website);
      if (options.twitter) formData.append('twitter', options.twitter);
      if (options.telegram) formData.append('telegram', options.telegram);
      formData.append('image', imageBlob, imageFilename);

      if (mediaPath) {
        const mediaBuffer = readFileSync(mediaPath);
        const mediaMime = EXT_TO_MIME[mediaExt] || 'application/octet-stream';
        const mediaBlob = new Blob([mediaBuffer], { type: mediaMime });
        const mediaFilename = `media${mediaExt}`;
        formData.append('media', mediaBlob, mediaFilename);
      }

      const uploadResp = await axios.post(`${apiUrl}/private/token/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60_000,
      });
      if (uploadResp.data.code !== 0) {
        throw new Error(`IPFS upload failed: ${uploadResp.data.msg}`);
      }
      const tokenUri = uploadResp.data.data.token_uri;

      const createParams = buildParams({ tokenUri });
      const isEthPair = template.COLLATERAL_TOKEN === ZERO_ADDRESS;
      const txValue = isEthPair ? buyAmountWei : 0n;

      if (!isEthPair && isBuying) {
        const allowance = await publicClient.readContract({
          address: template.COLLATERAL_TOKEN,
          abi: erc20ABI,
          functionName: 'allowance',
          args: [account.address, addrs.basememeFactory],
        });

        if (allowance < buyAmountWei) {
          if (allowance > 0n) {
            const resetTx = await walletClient.writeContract({
              address: template.COLLATERAL_TOKEN,
              abi: erc20ABI,
              functionName: 'approve',
              args: [addrs.basememeFactory, 0n],
            });
            const resetReceipt = await publicClient.waitForTransactionReceipt({ hash: resetTx });
            if (resetReceipt.status !== 'success') {
              throw new Error(`ERC20 approve reset reverted (tx: ${resetTx}).`);
            }
          }

          const approveTx = await walletClient.writeContract({
            address: template.COLLATERAL_TOKEN,
            abi: erc20ABI,
            functionName: 'approve',
            args: [addrs.basememeFactory, buyAmountWei],
          });
          const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
          if (approveReceipt.status !== 'success') {
            throw new Error(`ERC20 approve reverted (tx: ${approveTx}).`);
          }
        }
      }

      const commonArgs = [
        createParams.name,
        createParams.symbol,
        createParams.tokenURI,
        createParams.nonce,
      ];
      const postBuyArgs = [
        createParams.signature,
        createParams.platformReferrer,
        createParams.payoutRecipient,
        createParams.tokenSalt,
        createParams.collateralToken,
      ];

      let functionName;
      let args;

      if (isBuying) {
        if (createParams.isDynamic) {
          functionName = 'createBasememeTokenDynamicAndBuyWithCollateral';
          args = [
            ...commonArgs,
            buyAmountWei,
            0n,
            ...postBuyArgs,
            createParams.targetRaise,
            ...(createParams.hasLock
              ? [
                  createParams.lockBps,
                  createParams.lockupDuration,
                  createParams.vestingDuration,
                  createParams.lockAdmin,
                ]
              : []),
          ];
        } else {
          functionName = 'createBasememeTokenAndBuyWithCollateral';
          args = [
            ...commonArgs,
            buyAmountWei,
            0n,
            ...postBuyArgs,
          ];
        }
      } else if (createParams.isDynamic) {
        functionName = 'createBasememeTokenDynamicWithCollateral';
        args = [
          ...commonArgs,
          ...postBuyArgs,
          createParams.targetRaise,
          ...(createParams.hasLock
            ? [
                createParams.lockBps,
                createParams.lockupDuration,
                createParams.vestingDuration,
                createParams.lockAdmin,
              ]
            : []),
        ];
      } else {
        functionName = 'createBasememeTokenWithCollateral';
        args = [
          ...commonArgs,
          ...postBuyArgs,
        ];
      }

      if (options.dryRun) {
        // V4 dry-run backfill (Phase 3 🟡 #2 resolved in Phase 2).
        // Mirror the tax path: decode + simulate, don't submit.
        const calldata = encodeFunctionData({
          abi: basememeFactoryABI,
          functionName,
          args,
        });
        let simulateResult = { ok: true };
        try {
          await publicClient.simulateContract({
            address: addrs.basememeFactory,
            abi: basememeFactoryABI,
            functionName,
            args,
            account: account.address,
            ...(txValue > 0n ? { value: txValue } : {}),
          });
        } catch (error) {
          simulateResult = { ok: false, error: error.shortMessage || error.message };
        }
        const safeArgs = JSON.parse(JSON.stringify(args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
        console.log(JSON.stringify({
          success: true,
          dryRun: true,
          mode: 'v4',
          functionName,
          factory: addrs.basememeFactory,
          args: safeArgs,
          value: txValue.toString(),
          calldata,
          simulate: simulateResult,
        }, null, 2));
        return;
      }

      const txHash = await walletClient.writeContract({
        address: addrs.basememeFactory,
        abi: basememeFactoryABI,
        functionName,
        args,
        ...(txValue > 0n ? { value: txValue } : {}),
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== 'success') {
        console.error(JSON.stringify({ success: false, error: 'Transaction reverted', transactionHash: txHash }));
        process.exit(1);
      }

      let tokenAddress = null;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: basememeFactoryEvents,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === 'NewBasememeToken') {
            tokenAddress = decoded.args.addr;
            break;
          }
        } catch {
          // ignore unrelated logs
        }
      }

      try {
        const submitForm = new FormData();
        submitForm.append('chain_id', String(chainId));
        submitForm.append('tx_id', txHash);
        submitForm.append('tx_type', '1');
        submitForm.append('user_address', account.address);
        submitForm.append('check_code', md5Hex(account.address, txHash));
        await axios.post(`${apiUrl}/coin/submit_tx_id`, submitForm, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } catch (error) {
        console.error(`Backend notify failed: ${error.message}`);
      }

      const isAdvanced = Number.parseFloat(options.targetRaise || '0') > 0 || Number.parseInt(options.vestingPct || '0', 10) > 0;

      console.log(JSON.stringify({
        success: true,
        data: {
          tokenAddress,
          transactionHash: txHash,
          mode: isAdvanced ? 'advanced' : 'standard',
          pair,
          buyAmount: options.buyAmount || '0',
        },
      }, null, 2));
    } catch (error) {
      console.error(JSON.stringify({ success: false, error: error.message }));
      process.exit(1);
    }
  });
