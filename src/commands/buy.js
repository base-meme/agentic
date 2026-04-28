import { Command } from 'commander';
import { encodeFunctionData, parseEther, parseUnits } from 'viem';
import { quoteBuy, getTradeContext } from '../lib/quote.js';
import { getPublicClient } from '../lib/chain.js';
import { getCollateralTemplate, normalizePair, ZERO_ADDRESS } from '../lib/chain-configs.js';
import {
  basememeFactoryABI,
  basememeTaxFactoryImplABI,
  basememeTaxFactoryTradeHelperABI,
  erc20ABI,
  getAddressesForTrade,
  permit2ABI,
  swapRouterV2ABI,
  tradeHelperABI,
  uniswapV2RouterABI,
  universalRouterABI,
} from '../lib/contracts.js';
import {
  CONTRACT_BALANCE,
  OPEN_DELTA,
  UR,
  V4Action,
  buildCommands,
  concatActions,
  deriveZeroForOne,
  encodeSettle,
  encodeSwapExactInSingle,
  encodeTake,
  encodeTakeAll,
  encodeV3PathSingle,
  inputV3SwapExactIn,
  inputUnwrapWETH,
  inputV4Swap,
  inputWrapETH,
} from '../lib/v4-encode.js';
import {
  isDexV2TaxCrossPairEthBuy,
  isDexV2TaxDirectCollateralBuy,
  isDexV2TaxNativeBuy,
  resolveTradePath,
} from '../lib/tax-trade.js';
import { shouldUseTaxFactory, shouldUseUniswapV4 } from '../lib/version.js';
import { getAccount, getWalletClient } from '../lib/wallet.js';
import { RECEIPT_TIMEOUT_CODE, TX_LABELS, pickStableErrorCode } from '../lib/error-codes.js';

const ONE_YEAR_SECONDS = 3600n * 24n * 365n;
const MAX_UINT160 = (1n << 160n) - 1n;

function nowSeconds() {
  return BigInt(Math.floor(Date.now() / 1000));
}

function getDeadline() {
  return nowSeconds() + 300n;
}

function getPoolKey(extraData) {
  const poolKey = extraData?.poolKey || extraData?.pool_key;
  if (!poolKey) {
    throw new Error('V4 poolKey missing from token extra_data.');
  }
  return {
    currency0: poolKey.currency0,
    currency1: poolKey.currency1,
    fee: BigInt(poolKey.fee ?? 0),
    tickSpacing: BigInt(poolKey.tickSpacing ?? 0),
    hooks: poolKey.hooks,
  };
}

async function waitForSuccess(publicClient, hash, txLabel) {
  // Optional env-driven timeout override. Default unset → use viem's
  // built-in default (180s on Base 2s blocks). Tests / power users may
  // export `BASEMEME_RECEIPT_TIMEOUT_MS` to extend the wait when the
  // testnet sequencer batches large-gas tx beyond the default window.
  const opts = { hash };
  const t = process.env.BASEMEME_RECEIPT_TIMEOUT_MS;
  if (t) {
    const n = Number.parseInt(t, 10);
    if (Number.isFinite(n) && n > 0) opts.timeout = n;
  }
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt(opts);
  } catch (err) {
    // viem throws WaitForTransactionReceiptTimeoutError when the wait
    // window elapses without receipt. The tx is still pending and may
    // mine later. Re-throw with the hash + a code so callers (CLI users
    // / e2e harness) can recover by polling the hash with their own
    // deadline instead of resubmitting (which would double-execute).
    if (err?.name === 'WaitForTransactionReceiptTimeoutError') {
      const e = new Error(`Receipt timeout for ${txLabel || 'tx'} ${hash}`);
      e.code = RECEIPT_TIMEOUT_CODE;
      e.txHash = hash;
      e.txLabel = txLabel || 'tx';
      throw e;
    }
    throw err;
  }
  // Defense in depth: viem normalises receipt.status to the string
  // `'success'` / `'reverted'` for current Reth/geth shapes, but a
  // future client returning a non-string falsy value (null, 0, undefined)
  // would silently pass `!== 'success'` if we trusted equality alone.
  // Compare against the explicit success token via String() coercion.
  if (String(receipt.status) !== 'success') {
    throw new Error(`Transaction reverted (tx: ${receipt.transactionHash})`);
  }
  return receipt;
}

async function sleep(ms = 1000) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForAllowanceUpdate(publicClient, tokenAddress, owner, spender, requiredAmount, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    const current = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20ABI,
      functionName: 'allowance',
      args: [owner, spender],
    });
    if (current >= requiredAmount) {
      await sleep(1000);
      return;
    }
    await sleep(1000);
  }
}

async function waitForPermit2AllowanceUpdate(publicClient, permit2, owner, tokenAddress, spender, requiredAmount, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    const [p2Amount] = await publicClient.readContract({
      address: permit2,
      abi: permit2ABI,
      functionName: 'allowance',
      args: [owner, tokenAddress, spender],
    });
    if (p2Amount >= requiredAmount) {
      await sleep(1000);
      return;
    }
    await sleep(1000);
  }
}

async function ensureAllowance(publicClient, walletClient, tokenAddress, spender, amount, owner) {
  const currentAllowance = await publicClient.readContract({
    address: tokenAddress,
    abi: erc20ABI,
    functionName: 'allowance',
    args: [owner, spender],
  });

  if (currentAllowance >= amount) {
    return;
  }

  if (currentAllowance > 0n) {
    const resetHash = await walletClient.writeContract({
      address: tokenAddress,
      abi: erc20ABI,
      functionName: 'approve',
      args: [spender, 0n],
    });
    await waitForSuccess(publicClient, resetHash, TX_LABELS.ALLOWANCE_RESET);
  }

  const hash = await walletClient.writeContract({
    address: tokenAddress,
    abi: erc20ABI,
    functionName: 'approve',
    args: [spender, amount],
  });
  await waitForSuccess(publicClient, hash, TX_LABELS.APPROVE);
  await waitForAllowanceUpdate(publicClient, tokenAddress, owner, spender, amount);
}

async function ensurePermit2Allowance(publicClient, walletClient, tokenAddress, permit2, spender, amount, owner) {
  if (amount > MAX_UINT160) {
    throw new Error(`Permit2 amount exceeds uint160: ${amount.toString()}`);
  }

  await ensureAllowance(publicClient, walletClient, tokenAddress, permit2, amount, owner);

  const [allowedAmount, expiration] = await publicClient.readContract({
    address: permit2,
    abi: permit2ABI,
    functionName: 'allowance',
    args: [owner, tokenAddress, spender],
  });

  if (allowedAmount >= amount && expiration > nowSeconds() + 60n) {
    return;
  }

  const hash = await walletClient.writeContract({
    address: permit2,
    abi: permit2ABI,
    functionName: 'approve',
    args: [tokenAddress, spender, amount, nowSeconds() + ONE_YEAR_SECONDS],
  });
  await waitForSuccess(publicClient, hash, TX_LABELS.PERMIT2_APPROVE);
  await waitForPermit2AllowanceUpdate(publicClient, permit2, owner, tokenAddress, spender, amount);
}

function resolveTradePair(context, pair) {
  const requestedPair = normalizePair(pair || 'ETH');

  if (requestedPair === 'ETH') {
    return {
      pair: 'ETH',
      payWithCollateral: false,
    };
  }

  // Collateral pairs are supported on V4 non-ETH tokens and tax non-ETH
  // tokens. V3 legacy tokens have no USDC pair (V3 ETH only).
  const supportsCollateralPair = shouldUseUniswapV4(context.coinVersion)
    || shouldUseTaxFactory(context.coinVersion);
  if (context.isEthPair || !supportsCollateralPair) {
    throw new Error(`Pair ${requestedPair} is only supported for V4 non-ETH tokens.`);
  }

  const requestedTemplate = getCollateralTemplate(context.chainId, requestedPair, context.coinVersion);
  if (String(requestedTemplate.COLLATERAL_TOKEN).toLowerCase() !== String(context.collateralAddress).toLowerCase()) {
    throw new Error(`Pair ${requestedPair} does not match token collateral ${context.collateralSymbol}.`);
  }

  return {
    pair: requestedPair,
    payWithCollateral: true,
  };
}

// Default slippage = 500 bps (5%) — aligns with frontend
// `src/context/trade-result/index.tsx:15` (`slippage: "5"`) and
// `max-slip-dialog/index.tsx:34` (placeholder "5"). Any change here
// should be mirrored in both the V4 and tax paths + their unit tests.
function normalizeSlippageBpsFlag(raw, fallback = 500) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error(`Invalid --slippage-bps: ${raw}`);
  }
  return parsed;
}

/**
 * Print a dry-run JSON envelope and return without submitting the tx.
 * `target` is the contract being called, `value` (optional) is the ETH value.
 * Every write-path sub-branch can call this to dump the decoded trade for
 * operator review (Phase 2 Coordinator spec, V4 backfill included).
 */
// Print the dry-run JSON payload to stdout (single source of truth for
// dry-run output shape). Call sites use `await emitDryRun(...)` then
// `return { success: true, dryRun: true, tradePath, phase }` — the sentinel
// return tells the Commander wrapper action to skip its own
// `{success, data}` JSON log to avoid double-printing.
async function emitDryRun({
  publicClient,
  account,
  tradePath,
  phase,
  mode,
  target,
  abi,
  functionName,
  args,
  value,
}) {
  const calldata = encodeFunctionData({ abi, functionName, args });
  let simulate;
  try {
    await publicClient.simulateContract({
      address: target,
      abi,
      functionName,
      args,
      account: account.address,
      ...(value && value > 0n ? { value } : {}),
    });
    simulate = { ok: true };
  } catch (error) {
    simulate = { ok: false, error: error.shortMessage || error.message };
  }
  const safeArgs = JSON.parse(JSON.stringify(args, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  console.log(JSON.stringify({
    success: true,
    dryRun: true,
    mode,
    tradePath,
    phase,
    functionName,
    target,
    args: safeArgs,
    value: (value ?? 0n).toString(),
    calldata,
    simulate,
  }, null, 2));
}

export async function buyCommand(tokenAddress, ethAmount, options) {
  if (!ethAmount || Number(ethAmount) <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  const isUseEth = options?.useEth !== false; // default true; --no-use-eth flips.
  const slippageBps = normalizeSlippageBpsFlag(options?.slippageBps ?? options?.slippage);
  const isDryRun = !!options?.dryRun;

  const quote = await quoteBuy(tokenAddress, {
    ethAmount,
    slippageBps,
    ...(options?.pair ? { pair: options.pair } : {}),
  });
  if (quote.phase === 'graduated') {
    throw new Error(
      "Token is in graduated state (migration pending). Trading is temporarily unavailable. Re-check with 'basememe token-info' later.",
    );
  }

  const context = await getTradeContext(tokenAddress);
  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const addresses = getAddressesForTrade(context.chainId, context.coinVersion);
  const account = getAccount();
  const tradePair = resolveTradePair(context, options?.pair);
  const amountInWei = tradePair.payWithCollateral
    ? parseUnits(String(ethAmount), context.collateralDecimals)
    : parseEther(String(ethAmount));
  const minTokenOutWei = BigInt(quote.minOutWei);

  if (minTokenOutWei <= 0n) {
    throw new Error('Quoted minimum output is 0. Trade would result in no output.');
  }

  const deadline = getDeadline();
  const tradePath = resolveTradePath(context.coinVersion);
  let hash;

  // Tax routing is handled ahead of the legacy switch so the tax `switch`
  // pin (HOTFIX #2 strengthened) is the first decision on every buy.
  if (tradePath === 'tax') {
    const pairSymbol = context.isEthPair ? 'ETH' : (context.collateralSymbol || 'ETH');
    const selectedPair = tradePair.pair;
    const taxDryRunBase = { publicClient, account, tradePath: 'tax' };

    if (context.phase === 'curve') {
      // Guard: ETH-pair token + --no-use-eth has no legit BC route. The
      // `else` branch below would call `buyExactInWithCollateral` with
      // `collateralAmount = <eth-wei>` + a ZERO_ADDRESS token address,
      // which silently degrades (no approve reverts, but swap receives
      // wrong token). L1 R2 🟡. Frontend equivalent throws at the UI layer.
      if (context.isEthPair && !isUseEth) {
        throw new Error(
          'ETH-pair tokens can only be bought with ETH on the bonding curve. '
          + 'Drop `--no-use-eth` or pick a non-ETH token.',
        );
      }
      if (context.isEthPair && isUseEth) {
        // BC · ETH pair · pay ETH -> taxHelper.buyWithEth (3-arg, HOTFIX #6)
        const target = addresses.basememeTaxFactoryTradeHelper;
        const args = [tokenAddress, amountInWei, minTokenOutWei];
        if (isDryRun) {
          await emitDryRun({
            ...taxDryRunBase,
            phase: 'curve',
            mode: 'tax',
            target,
            abi: basememeTaxFactoryTradeHelperABI,
            functionName: 'buyWithEth',
            args,
            value: amountInWei,
          });
          return { success: true, dryRun: true, tradePath: 'tax', phase: 'curve' };
        }
        // Pre-flight simulate · same rationale as the DEX paths below:
        // surface contract-level reverts (e.g. InsufficientFirstBuyFee)
        // immediately at submit time instead of mining a doomed tx.
        await publicClient.simulateContract({
          address: target,
          abi: basememeTaxFactoryTradeHelperABI,
          functionName: 'buyWithEth',
          args,
          value: amountInWei,
          account: account.address,
        });
        hash = await walletClient.writeContract({
          address: target,
          abi: basememeTaxFactoryTradeHelperABI,
          functionName: 'buyWithEth',
          args,
          value: amountInWei,
        });
      } else {
        // BC · USDC pair (or --no-use-eth) -> factory.buyExactInWithCollateral
        //   · approve spender = basememeTaxFactory (CI-09 correction)
        //   · HOTFIX #4 allowance poll already inside ensureAllowance
        const target = addresses.basememeTaxFactory;
        const args = [tokenAddress, amountInWei, minTokenOutWei];
        if (isDryRun) {
          await emitDryRun({
            ...taxDryRunBase,
            phase: 'curve',
            mode: 'tax',
            target,
            abi: basememeTaxFactoryImplABI,
            functionName: 'buyExactInWithCollateral',
            args,
            value: 0n,
          });
          return { success: true, dryRun: true, tradePath: 'tax', phase: 'curve' };
        }
        await ensureAllowance(
          publicClient,
          walletClient,
          context.collateralAddress,
          target,
          amountInWei,
          account.address,
        );
        // Pre-flight simulate · catches contract reverts before submit.
        await publicClient.simulateContract({
          address: target,
          abi: basememeTaxFactoryImplABI,
          functionName: 'buyExactInWithCollateral',
          args,
          account: account.address,
        });
        hash = await walletClient.writeContract({
          address: target,
          abi: basememeTaxFactoryImplABI,
          functionName: 'buyExactInWithCollateral',
          args,
        });
      }
    } else if (context.phase === 'dex') {
      const isBcCompleted = true;
      if (isDexV2TaxNativeBuy(context.coinVersion, isBcCompleted, pairSymbol, selectedPair, isUseEth)) {
        // DEX Native: taxHelper.dexBuyWithEth(token, ethIn, minOut) value=ETH
        const target = addresses.basememeTaxFactoryTradeHelper;
        const args = [tokenAddress, amountInWei, minTokenOutWei];
        if (isDryRun) {
          await emitDryRun({
            ...taxDryRunBase,
            phase: 'dex-native',
            mode: 'tax',
            target,
            abi: basememeTaxFactoryTradeHelperABI,
            functionName: 'dexBuyWithEth',
            args,
            value: amountInWei,
          });
          return { success: true, dryRun: true, tradePath: 'tax', phase: 'dex-native' };
        }
        // Pre-flight simulate so a contract-level revert (slippage /
        // liquidity / helper internal failure) surfaces with a readable
        // reason at submit time. Note: there is an inherent 1-3s window
        // between this `eth_call` and `writeContract` where another
        // user's tx could shift the pool reserves; the contract's
        // on-chain `minOut` slippage check is the real safety net,
        // simulate is just for human-readable error reporting.
        await publicClient.simulateContract({
          address: target,
          abi: basememeTaxFactoryTradeHelperABI,
          functionName: 'dexBuyWithEth',
          args,
          value: amountInWei,
          account: account.address,
        });
        hash = await walletClient.writeContract({
          address: target,
          abi: basememeTaxFactoryTradeHelperABI,
          functionName: 'dexBuyWithEth',
          args,
          value: amountInWei,
        });
      } else if (isDexV2TaxCrossPairEthBuy(context.coinVersion, isBcCompleted, pairSymbol, selectedPair, isUseEth)) {
        // DEX CrossPair: helper relays ETH -> collateral internally.
        const target = addresses.basememeTaxFactoryTradeHelper;
        const args = [tokenAddress, amountInWei, minTokenOutWei];
        if (isDryRun) {
          await emitDryRun({
            ...taxDryRunBase,
            phase: 'dex-crosspair',
            mode: 'tax',
            target,
            abi: basememeTaxFactoryTradeHelperABI,
            functionName: 'dexBuyWithEth',
            args,
            value: amountInWei,
          });
          return { success: true, dryRun: true, tradePath: 'tax', phase: 'dex-crosspair' };
        }
        // Pre-flight simulate (same rationale as the Native path above).
        await publicClient.simulateContract({
          address: target,
          abi: basememeTaxFactoryTradeHelperABI,
          functionName: 'dexBuyWithEth',
          args,
          value: amountInWei,
          account: account.address,
        });
        hash = await walletClient.writeContract({
          address: target,
          abi: basememeTaxFactoryTradeHelperABI,
          functionName: 'dexBuyWithEth',
          args,
          value: amountInWei,
        });
      } else if (isDexV2TaxDirectCollateralBuy(context.coinVersion, isBcCompleted, pairSymbol, selectedPair, isUseEth)) {
        // DEX DirectCollateral: V2 Router fee-on-transfer variant (HOTFIX #3).
        // approve target = uniV2Router.
        const router = addresses.uniswapV2Router;
        const path = [context.collateralAddress, tokenAddress];
        const args = [amountInWei, minTokenOutWei, path, account.address, deadline];
        if (isDryRun) {
          await emitDryRun({
            ...taxDryRunBase,
            phase: 'dex-direct-collateral',
            mode: 'tax',
            target: router,
            abi: uniswapV2RouterABI,
            functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
            args,
            value: 0n,
          });
          return { success: true, dryRun: true, tradePath: 'tax', phase: 'dex-direct-collateral' };
        }
        await ensureAllowance(
          publicClient,
          walletClient,
          context.collateralAddress,
          router,
          amountInWei,
          account.address,
        );
        // Pre-flight simulate (same rationale as the helper paths above).
        await publicClient.simulateContract({
          address: router,
          abi: uniswapV2RouterABI,
          functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
          args,
          account: account.address,
        });
        hash = await walletClient.writeContract({
          address: router,
          abi: uniswapV2RouterABI,
          functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
          args,
        });
      } else {
        throw new Error(
          `Unable to resolve tax DEX route (pair=${pairSymbol}, selected=${selectedPair}, isUseEth=${isUseEth}).`,
        );
      }
    } else {
      throw new Error(
        "Token is in graduated state (migration pending). Trading is temporarily unavailable. Re-check with 'basememe token-info' later.",
      );
    }

    const receipt = await waitForSuccess(publicClient, hash, TX_LABELS.BUY);
    return {
      txHash: hash,
      action: 'buy',
      mode: 'tax',
      tradePath: 'tax',
      phase: quote.phase,
      from: account.address,
      token: tokenAddress,
      pair: tradePair.pair,
      paymentPair: tradePair.pair,
      paymentAmount: ethAmount,
      ...(tradePair.payWithCollateral ? { collateralAmount: ethAmount } : { ethAmount }),
      expectedOut: quote.expectedOut,
      minOut: quote.minOut,
      expectedTokenOut: quote.expectedTokenOut,
      minTokenOut: quote.minTokenOut,
      receipt: {
        status: receipt.status,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
      },
    };
  }

  // tradePath === 'v4' or 'v3' — existing behaviour, unchanged except for the
  // explicit throw on the V2-non-tax slot (resolveTradePath threw above).
  if (context.phase === 'curve') {
    if (context.isEthPair) {
      // V4 BC ETH buy · --dry-run: emit decoded calldata + simulate, exit 0.
      if (isDryRun) {
        await emitDryRun({
          publicClient,
          account,
          tradePath: tradePath,
          phase: 'curve',
          mode: 'v4',
          target: addresses.basememeFactory,
          abi: basememeFactoryABI,
          functionName: 'buyExactIn',
          args: [tokenAddress, minTokenOutWei, ZERO_ADDRESS],
          value: amountInWei,
        });
        return { success: true, dryRun: true, tradePath, phase: 'curve' };
      }
      hash = await walletClient.writeContract({
        address: addresses.basememeFactory,
        abi: basememeFactoryABI,
        functionName: 'buyExactIn',
        args: [tokenAddress, minTokenOutWei, ZERO_ADDRESS],
        value: amountInWei,
      });
    } else if (tradePair.payWithCollateral) {
      if (isDryRun) {
        await emitDryRun({
          publicClient,
          account,
          tradePath,
          phase: 'curve',
          mode: 'v4',
          target: addresses.basememeFactory,
          abi: basememeFactoryABI,
          functionName: 'buyExactInWithCollateral',
          args: [tokenAddress, amountInWei, minTokenOutWei, ZERO_ADDRESS],
          value: 0n,
        });
        return { success: true, dryRun: true, tradePath, phase: 'curve' };
      }
      await ensureAllowance(
        publicClient,
        walletClient,
        context.collateralAddress,
        addresses.basememeFactory,
        amountInWei,
        account.address,
      );
      hash = await walletClient.writeContract({
        address: addresses.basememeFactory,
        abi: basememeFactoryABI,
        functionName: 'buyExactInWithCollateral',
        args: [tokenAddress, amountInWei, minTokenOutWei, ZERO_ADDRESS],
      });
    } else {
      if (isDryRun) {
        await emitDryRun({
          publicClient,
          account,
          tradePath,
          phase: 'curve',
          mode: 'v4',
          target: addresses.basememeFactoryTradeHelper,
          abi: tradeHelperABI,
          functionName: 'buyWithEth',
          args: [tokenAddress, amountInWei, minTokenOutWei, ZERO_ADDRESS],
          value: amountInWei,
        });
        return { success: true, dryRun: true, tradePath, phase: 'curve' };
      }
      hash = await walletClient.writeContract({
        address: addresses.basememeFactoryTradeHelper,
        abi: tradeHelperABI,
        functionName: 'buyWithEth',
        args: [tokenAddress, amountInWei, minTokenOutWei, ZERO_ADDRESS],
        value: amountInWei,
      });
    }
  } else if (context.phase === 'dex') {
    // tradePath === 'v4' -> UniversalRouter-based execution.
    // tradePath === 'v3' -> legacy SwapRouterV2 exactInputSingle.
    // (tradePath === 'tax' was handled above; resolveTradePath throws on the
    // V2-non-tax slot, so only 'v4' / 'v3' can reach here.)
    if (tradePath === 'v4') {
      const chainWeth = context.chainConfig.WETH;
      const universalRouter = addresses.universalRouter;
      const poolKey = getPoolKey(context.extraData);
      if (context.isEthPair) {
        const zeroForOne = deriveZeroForOne(poolKey, chainWeth);
        const outputToken = zeroForOne ? poolKey.currency1 : poolKey.currency0;

        const p0 = encodeSettle({
          currency: chainWeth,
          amount: amountInWei,
          payerIsUser: false,
        });
        const p1 = encodeSwapExactInSingle({
          poolKey,
          zeroForOne,
          amountIn: OPEN_DELTA,
          amountOutMinimum: minTokenOutWei,
          hookData: '0x',
        });
        const p2 = encodeTakeAll({
          currency: outputToken,
          minAmount: minTokenOutWei,
        });
        const p3 = encodeTake({
          currency: chainWeth,
          recipient: universalRouter,
          amount: 0n,
        });
        const commands = buildCommands([UR.WRAP_ETH, UR.V4_SWAP, UR.UNWRAP_WETH]);
        const inputs = [
          inputWrapETH(universalRouter, amountInWei),
          inputV4Swap(
            concatActions([
              V4Action.SETTLE,
              V4Action.SWAP_EXACT_IN_SINGLE,
              V4Action.TAKE_ALL,
              V4Action.TAKE,
            ]),
            [p0, p1, p2, p3],
          ),
          inputUnwrapWETH(account.address, 0n),
        ];

        hash = await walletClient.writeContract({
          address: universalRouter,
          abi: universalRouterABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
          value: amountInWei,
        });
      } else if (tradePair.payWithCollateral) {
        await ensurePermit2Allowance(
          publicClient,
          walletClient,
          context.collateralAddress,
          addresses.permit2,
          universalRouter,
          amountInWei,
          account.address,
        );

        const zeroForOne = deriveZeroForOne(poolKey, context.collateralAddress);
        const commands = buildCommands([UR.V4_SWAP]);
        const inputs = [
          inputV4Swap(
            concatActions([
              V4Action.SETTLE,
              V4Action.SWAP_EXACT_IN_SINGLE,
              V4Action.TAKE_ALL,
              V4Action.TAKE_ALL,
            ]),
            [
              encodeSettle({
                currency: context.collateralAddress,
                amount: amountInWei,
                payerIsUser: true,
              }),
              encodeSwapExactInSingle({
                poolKey,
                zeroForOne,
                amountIn: OPEN_DELTA,
                amountOutMinimum: minTokenOutWei,
                hookData: '0x',
              }),
              encodeTakeAll({
                currency: tokenAddress,
                minAmount: minTokenOutWei,
              }),
              encodeTakeAll({
                currency: context.collateralAddress,
                minAmount: 0n,
              }),
            ],
          ),
        ];

        hash = await walletClient.writeContract({
          address: universalRouter,
          abi: universalRouterABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
        });
      } else {
        const zeroForOne = deriveZeroForOne(poolKey, context.collateralAddress);
        const commands = buildCommands([UR.WRAP_ETH, UR.V3_SWAP_EXACT_IN, UR.V4_SWAP]);
        const inputs = [
          inputWrapETH(universalRouter, amountInWei),
          inputV3SwapExactIn({
            recipient: universalRouter,
            amountIn: amountInWei,
            amountOutMinimum: 0n,
            path: encodeV3PathSingle({
              tokenIn: chainWeth,
              fee: 500,
              tokenOut: context.collateralAddress,
            }),
            payerIsUser: false,
          }),
          inputV4Swap(
            concatActions([
              V4Action.SETTLE,
              V4Action.SWAP_EXACT_IN_SINGLE,
              V4Action.TAKE_ALL,
              V4Action.TAKE_ALL,
            ]),
            [
              encodeSettle({
                currency: context.collateralAddress,
                amount: CONTRACT_BALANCE,
                payerIsUser: false,
              }),
              encodeSwapExactInSingle({
                poolKey,
                zeroForOne,
                amountIn: OPEN_DELTA,
                amountOutMinimum: minTokenOutWei,
                hookData: '0x',
              }),
              encodeTakeAll({
                currency: tokenAddress,
                minAmount: minTokenOutWei,
              }),
              encodeTakeAll({
                currency: context.collateralAddress,
                minAmount: 0n,
              }),
            ],
          ),
        ];

        hash = await walletClient.writeContract({
          address: universalRouter,
          abi: universalRouterABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
          value: amountInWei,
        });
      }
    } else {
      hash = await walletClient.writeContract({
        address: addresses.swapRouterV2,
        abi: swapRouterV2ABI,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: context.dexCollateralAddress,
          tokenOut: tokenAddress,
          fee: BigInt(context.chainConfig.V3_POOL_FEE),
          recipient: account.address,
          amountIn: amountInWei,
          amountOutMinimum: minTokenOutWei,
          sqrtPriceLimitX96: 0n,
        }],
        value: amountInWei,
      });
    }
  } else {
    throw new Error(
      "Token is in graduated state (migration pending). Trading is temporarily unavailable. Re-check with 'basememe token-info' later.",
    );
  }

  const receipt = await waitForSuccess(publicClient, hash, TX_LABELS.BUY);

  return {
    txHash: hash,
    action: 'buy',
    phase: quote.phase,
    from: account.address,
    token: tokenAddress,
    pair: tradePair.pair,
    paymentPair: tradePair.pair,
    paymentAmount: ethAmount,
    ...(tradePair.payWithCollateral ? { collateralAmount: ethAmount } : { ethAmount }),
    expectedOut: quote.expectedOut,
    minOut: quote.minOut,
    expectedTokenOut: quote.expectedTokenOut,
    minTokenOut: quote.minTokenOut,
    receipt: {
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    },
  };
}

// Commander instance — parallels `create.js:400` pattern so `helpers.js`
// `runtime.buy` resolves to a Command object with `parseAsync`. Registered
// on the root program in `src/index.js` via `program.addCommand(buy)`.
// Default slippage 500 bps (5%) matches frontend `trade-result/index.tsx:15`.
export const buy = new Command('buy')
  .description('Buy tokens with ETH or collateral (tax-aware routing)')
  .argument('<tokenAddress>', 'Token contract address')
  .argument('<ethAmount>', 'Amount to spend (ETH by default; switch unit with --no-use-eth)')
  .option('--slippage <bps>', 'Legacy alias for --slippage-bps')
  .option('--slippage-bps <bps>', 'Slippage tolerance in bps (default: 500 = 5%)')
  .option('--pair <type>', 'Collateral pair (ETH|USDC|SOL)')
  .option('--use-eth', 'Pay with ETH (default)', true)
  .option('--no-use-eth', "Pay with the token's collateral ERC20 instead of ETH")
  .option('--dry-run', 'Decode + simulate the trade without submitting')
  .action(async (tokenAddress, ethAmount, options) => {
    try {
      const result = await buyCommand(tokenAddress, ethAmount, options);
      // Dry-run paths print their own payload via `emitDryRun` and return
      // a `{success:true, dryRun:true, ...}` sentinel so we know to skip
      // the `{success, data}` wrap here (avoids double-printing to stdout).
      if (result && result.dryRun === true) return;
      console.log(JSON.stringify({ success: true, data: result }, null, 2));
    } catch (error) {
      // Surface RECEIPT_TIMEOUT structured fields so callers (CLI users +
      // e2e harness) can recover by polling the in-flight tx hash with
      // their own deadline instead of resubmitting (which would
      // double-execute the same on-chain action). Filter `code` through a
      // whitelist so viem's RpcRequestError numeric `.code` (-32603 etc.)
      // doesn't leak into the JSON payload alongside our string codes.
      const payload = { success: false, error: error?.message || String(error) };
      const stableCode = pickStableErrorCode(error?.code);
      if (stableCode) payload.code = stableCode;
      if (error?.txHash) payload.txHash = error.txHash;
      if (error?.txLabel) payload.txLabel = error.txLabel;
      console.error(JSON.stringify(payload));
      process.exit(1);
    }
  });
