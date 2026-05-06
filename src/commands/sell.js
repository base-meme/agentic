import { Command } from 'commander';
import { encodeFunctionData } from 'viem';
import { quoteSell, getTradeContext } from '../lib/quote.js';
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
  encodeSettle,
  encodeSwapExactInSingle,
  encodeTake,
  encodeV3PathSingle,
  inputV3SwapExactIn,
  inputUnwrapWETH,
  inputV4Swap,
} from '../lib/v4-encode.js';
import {
  isDexV2TaxCrossPairEthSell,
  isDexV2TaxDirectCollateralSell,
  isDexV2TaxNativeSell,
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
  // See buy.js:waitForSuccess for the timeout / RECEIPT_TIMEOUT contract.
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
    if (err?.name === 'WaitForTransactionReceiptTimeoutError') {
      const e = new Error(`Receipt timeout for ${txLabel || 'tx'} ${hash}`);
      e.code = RECEIPT_TIMEOUT_CODE;
      e.txHash = hash;
      e.txLabel = txLabel || 'tx';
      throw e;
    }
    throw err;
  }
  // Defense in depth: see buy.js:waitForSuccess.
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
    // L2 W3 edge case · documented: if this `allowance-reset` waitForSuccess
    // throws RECEIPT_TIMEOUT, the wallet may end up with `allowance == 0`
    // unconfirmed. The structured error includes `txLabel: 'allowance-reset'`
    // so callers can resolve the in-flight reset hash before retrying. A
    // naive retry without recovery would re-submit the reset (idempotent if
    // the original mined; harmless redundancy if it didn't), so this is a
    // soft edge — listed here so the next reader sees it documented.
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

  // Collateral pairs supported on V4 + tax non-ETH tokens.
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

// Default slippage = 500 bps (5%) — aligns with frontend default.
// See buy.js for the full citation.
function normalizeSlippageBpsFlag(raw, fallback = 500) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10_000) {
    throw new Error(`Invalid --slippage-bps: ${raw}`);
  }
  return parsed;
}

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

export async function sellCommand(tokenAddress, tokenAmount, options) {
  if (!tokenAmount || Number(tokenAmount) <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  const isUseEth = options?.useEth !== false;
  const slippageBps = normalizeSlippageBpsFlag(options?.slippageBps ?? options?.slippage);
  const isDryRun = !!options?.dryRun;

  const quote = await quoteSell(tokenAddress, {
    tokenAmount,
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
  const amountInWei = BigInt(quote.tokenInWei);
  const minOutWei = BigInt(quote.minOutWei);
  const deadline = getDeadline();

  if (minOutWei <= 0n) {
    throw new Error('Quoted minimum output is 0. Trade would result in no output.');
  }

  const tradePath = resolveTradePath(context.coinVersion);
  let hash;

  if (tradePath === 'tax') {
    // Tax-first routing (HOTFIX #2 strengthened).
    const pairSymbol = context.isEthPair ? 'ETH' : (context.collateralSymbol || 'ETH');
    const selectedPair = tradePair.pair;
    const taxDryRunBase = { publicClient, account, tradePath: 'tax' };

    if (context.phase === 'curve') {
      // BC sell -> taxFactory.sellExactIn (3-arg, HOTFIX #6); approve spender = factory.
      const target = addresses.basememeTaxFactory;
      const args = [tokenAddress, amountInWei, minOutWei];
      if (isDryRun) {
        await emitDryRun({
          ...taxDryRunBase,
          phase: 'curve',
          mode: 'tax',
          target,
          abi: basememeTaxFactoryImplABI,
          functionName: 'sellExactIn',
          args,
          value: 0n,
        });
        return { success: true, dryRun: true, tradePath: 'tax', phase: 'curve' };
      }
      await ensureAllowance(
        publicClient,
        walletClient,
        tokenAddress,
        target,
        amountInWei,
        account.address,
      );
      // Pre-flight simulate · catches contract reverts before submit.
      await publicClient.simulateContract({
        address: target,
        abi: basememeTaxFactoryImplABI,
        functionName: 'sellExactIn',
        args,
        account: account.address,
      });
      hash = await walletClient.writeContract({
        address: target,
        abi: basememeTaxFactoryImplABI,
        functionName: 'sellExactIn',
        args,
      });
    } else if (context.phase === 'dex') {
      const isBcCompleted = true;
      // Tax sell for ETH output (Native OR CrossPair) → always route through
      // `TaxHelper.dexSellForEth`. Frontend does the same collapse: predicate
      // setup at `coin-trade/sell/index.tsx:296-326`, actual `dexSellForEth`
      // writeContract call at `:1026-1057`. Helper internally handles the
      // ERC20-collateral → WETH hop for CrossPair pairs. The V2 Router's
      // `swapExactTokensForETHSupportingFeeOnTransferTokens` would revert on
      // tax tokens because the Router's token→token→WETH path drops below
      // minOut after the tax deduction — frontend comment at
      // `sell/index.tsx:~370` says "swapExactTokensForETH would revert for
      // fee-on-transfer tax". Collapsed here to match that behaviour.
      const isTaxDexSellForEth =
        isDexV2TaxNativeSell(context.coinVersion, isBcCompleted, pairSymbol, selectedPair) ||
        isDexV2TaxCrossPairEthSell(context.coinVersion, isBcCompleted, pairSymbol, selectedPair);
      if (isTaxDexSellForEth) {
        const nativeNotCross = isDexV2TaxNativeSell(
          context.coinVersion, isBcCompleted, pairSymbol, selectedPair,
        );
        const phaseTag = nativeNotCross ? 'dex-native' : 'dex-crosspair';
        const target = addresses.basememeTaxFactoryTradeHelper;
        const args = [tokenAddress, amountInWei, minOutWei];
        if (isDryRun) {
          await emitDryRun({
            ...taxDryRunBase,
            phase: phaseTag,
            mode: 'tax',
            target,
            abi: basememeTaxFactoryTradeHelperABI,
            functionName: 'dexSellForEth',
            args,
            value: 0n,
          });
          return { success: true, dryRun: true, tradePath: 'tax', phase: phaseTag };
        }
        // HOTFIX #4 — ensureAllowance polls `allowance >= amountInWei`
        // after the approve tx lands to absorb RPC `eth_call` state lag.
        await ensureAllowance(
          publicClient,
          walletClient,
          tokenAddress,
          target,
          amountInWei,
          account.address,
        );
        // Pre-flight simulate so a contract-level revert (slippage /
        // liquidity / helper internal failure) surfaces with a readable
        // reason at submit time instead of mining a doomed tx that the
        // user pays gas for. Note: this does NOT mitigate the separate
        // Reth+viem receipt-polling flake (see test/e2e/12-tax-sell.e2e.js
        // 12d/12e skip rationale) — that one applies to txs that DO
        // mine successfully but viem can't recognise the Reth-shaped
        // receipt as final.
        await publicClient.simulateContract({
          address: target,
          abi: basememeTaxFactoryTradeHelperABI,
          functionName: 'dexSellForEth',
          args,
          account: account.address,
        });
        hash = await walletClient.writeContract({
          address: target,
          abi: basememeTaxFactoryTradeHelperABI,
          functionName: 'dexSellForEth',
          args,
        });
      } else if (isDexV2TaxDirectCollateralSell(context.coinVersion, isBcCompleted, pairSymbol, selectedPair)) {
        // DEX DirectCollateral · user wants pool's ERC20 back.
        // V2 Router: swapExactTokensForTokens...SupportingFeeOnTransferTokens (HOTFIX #3)
        const router = addresses.uniswapV2Router;
        const path = [tokenAddress, context.collateralAddress];
        const args = [amountInWei, minOutWei, path, account.address, deadline];
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
        // HOTFIX #4 — allowance poll after approve (same as BC path).
        await ensureAllowance(
          publicClient,
          walletClient,
          tokenAddress,
          router,
          amountInWei,
          account.address,
        );
        // Pre-flight simulate (same rationale as the dexSellForEth path
        // above) — surfaces revert reasons instead of viem timeouts.
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
          `Unable to resolve tax DEX sell route (pair=${pairSymbol}, selected=${selectedPair}).`,
        );
      }
    } else {
      throw new Error(
        "Token is in graduated state (migration pending). Trading is temporarily unavailable. Re-check with 'basememe token-info' later.",
      );
    }

    const receipt = await waitForSuccess(publicClient, hash, TX_LABELS.SELL);
    return {
      txHash: hash,
      action: 'sell',
      mode: 'tax',
      tradePath: 'tax',
      phase: quote.phase,
      from: account.address,
      token: tokenAddress,
      pair: tradePair.pair,
      outputPair: tradePair.pair,
      tokenAmount,
      expectedOut: quote.expectedOut,
      minOut: quote.minOut,
      expectedEthOut: quote.expectedEthOut,
      minEthOut: quote.minEthOut,
      expectedCollateralOut: quote.expectedCollateralOut,
      minCollateralOut: quote.minCollateralOut,
      receipt: {
        status: receipt.status,
        blockNumber: Number(receipt.blockNumber),
        gasUsed: receipt.gasUsed.toString(),
      },
    };
  }

  if (context.phase === 'curve') {
    if (context.isEthPair) {
      await ensureAllowance(
        publicClient,
        walletClient,
        tokenAddress,
        addresses.basememeFactory,
        amountInWei,
        account.address,
      );

      hash = await walletClient.writeContract({
        address: addresses.basememeFactory,
        abi: basememeFactoryABI,
        functionName: 'sellExactIn',
        args: [tokenAddress, amountInWei, minOutWei, ZERO_ADDRESS],
      });
    } else if (tradePair.payWithCollateral) {
      await ensureAllowance(
        publicClient,
        walletClient,
        tokenAddress,
        addresses.basememeFactory,
        amountInWei,
        account.address,
      );

      hash = await walletClient.writeContract({
        address: addresses.basememeFactory,
        abi: basememeFactoryABI,
        functionName: 'sellExactIn',
        args: [tokenAddress, amountInWei, minOutWei, ZERO_ADDRESS],
      });
    } else {
      await ensureAllowance(
        publicClient,
        walletClient,
        tokenAddress,
        addresses.basememeFactory,
        amountInWei,
        account.address,
      );

      hash = await walletClient.writeContract({
        address: addresses.basememeFactoryTradeHelper,
        abi: tradeHelperABI,
        functionName: 'sellForEth',
        args: [tokenAddress, amountInWei, minOutWei, ZERO_ADDRESS],
      });
    }
  } else if (context.phase === 'dex') {
    // tradePath === 'tax' was handled above; resolveTradePath threw on the
    // V2-non-tax slot; only 'v4' / 'v3' can reach here.
    if (tradePath === 'v4') {
      const universalRouter = addresses.universalRouter;
      const permit2 = addresses.permit2;
      const poolKey = getPoolKey(context.extraData);
      const zeroForOne = poolKey.currency0.toLowerCase() === tokenAddress.toLowerCase();

      await ensurePermit2Allowance(
        publicClient,
        walletClient,
        tokenAddress,
        permit2,
        universalRouter,
        amountInWei,
        account.address,
      );

      if (context.isEthPair) {
        const commands = buildCommands([UR.V4_SWAP, UR.UNWRAP_WETH]);
        const inputs = [
          inputV4Swap(
            concatActions([
              V4Action.SETTLE,
              V4Action.SWAP_EXACT_IN_SINGLE,
              V4Action.TAKE,
              V4Action.TAKE,
            ]),
            [
              encodeSettle({
                currency: tokenAddress,
                amount: amountInWei,
                payerIsUser: true,
              }),
              encodeSwapExactInSingle({
                poolKey,
                zeroForOne,
                amountIn: OPEN_DELTA,
                amountOutMinimum: minOutWei,
                hookData: '0x',
              }),
              encodeTake({
                currency: context.dexCollateralAddress,
                recipient: universalRouter,
                amount: 0n,
              }),
              encodeTake({
                currency: tokenAddress,
                recipient: account.address,
                amount: 0n,
              }),
            ],
          ),
          inputUnwrapWETH(account.address, 0n),
        ];

        hash = await walletClient.writeContract({
          address: universalRouter,
          abi: universalRouterABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
        });
      } else if (tradePair.payWithCollateral) {
        const commands = buildCommands([UR.V4_SWAP]);
        const inputs = [
          inputV4Swap(
            concatActions([
              V4Action.SETTLE,
              V4Action.SWAP_EXACT_IN_SINGLE,
              V4Action.TAKE,
              V4Action.TAKE,
            ]),
            [
              encodeSettle({
                currency: tokenAddress,
                amount: amountInWei,
                payerIsUser: true,
              }),
              encodeSwapExactInSingle({
                poolKey,
                zeroForOne,
                amountIn: OPEN_DELTA,
                amountOutMinimum: minOutWei,
                hookData: '0x',
              }),
              encodeTake({
                currency: context.collateralAddress,
                recipient: account.address,
                amount: 0n,
              }),
              encodeTake({
                currency: tokenAddress,
                recipient: account.address,
                amount: 0n,
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
        const chainWeth = context.chainConfig.WETH;
        const collateralTemplate = getCollateralTemplate(
          context.chainId,
          normalizePair(context.collateralSymbol),
          context.coinVersion,
        );
        const commands = buildCommands([UR.V4_SWAP, UR.V3_SWAP_EXACT_IN, UR.UNWRAP_WETH]);
        const inputs = [
          inputV4Swap(
            concatActions([
              V4Action.SETTLE,
              V4Action.SWAP_EXACT_IN_SINGLE,
              V4Action.TAKE,
              V4Action.TAKE,
            ]),
            [
              encodeSettle({
                currency: tokenAddress,
                amount: amountInWei,
                payerIsUser: true,
              }),
              encodeSwapExactInSingle({
                poolKey,
                zeroForOne,
                amountIn: OPEN_DELTA,
                amountOutMinimum: 0n,
                hookData: '0x',
              }),
              encodeTake({
                currency: context.collateralAddress,
                recipient: universalRouter,
                amount: 0n,
              }),
              encodeTake({
                currency: tokenAddress,
                recipient: account.address,
                amount: 0n,
              }),
            ],
          ),
          inputV3SwapExactIn({
            recipient: universalRouter,
            amountIn: CONTRACT_BALANCE,
            amountOutMinimum: minOutWei,
            path: encodeV3PathSingle({
              tokenIn: context.collateralAddress,
              fee: collateralTemplate.TOKEN_SWAP?.V3_FEE ?? 500,
              tokenOut: chainWeth,
            }),
            payerIsUser: false,
          }),
          inputUnwrapWETH(account.address, 0n),
        ];

        hash = await walletClient.writeContract({
          address: universalRouter,
          abi: universalRouterABI,
          functionName: 'execute',
          args: [commands, inputs, deadline],
        });
      }
    } else {
      await ensureAllowance(
        publicClient,
        walletClient,
        tokenAddress,
        addresses.swapRouterV2,
        amountInWei,
        account.address,
      );

      const exactInputSingleData = encodeFunctionData({
        abi: swapRouterV2ABI,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: tokenAddress,
          tokenOut: context.dexCollateralAddress,
          fee: BigInt(context.chainConfig.V3_POOL_FEE),
          recipient: addresses.swapRouterV2,
          amountIn: amountInWei,
          amountOutMinimum: minOutWei,
          sqrtPriceLimitX96: 0n,
        }],
      });
      const unwrapWethData = encodeFunctionData({
        abi: swapRouterV2ABI,
        functionName: 'unwrapWETH9',
        args: [0n, account.address],
      });

      hash = await walletClient.writeContract({
        address: addresses.swapRouterV2,
        abi: swapRouterV2ABI,
        functionName: 'multicall',
        args: [deadline, [exactInputSingleData, unwrapWethData]],
      });
    }
  } else {
    throw new Error(
      "Token is in graduated state (migration pending). Trading is temporarily unavailable. Re-check with 'basememe token-info' later.",
    );
  }

  const receipt = await waitForSuccess(publicClient, hash, TX_LABELS.SELL);

  return {
    txHash: hash,
    action: 'sell',
    phase: quote.phase,
    from: account.address,
    token: tokenAddress,
    pair: tradePair.pair,
    outputPair: tradePair.pair,
    tokenAmount,
    expectedOut: quote.expectedOut,
    minOut: quote.minOut,
    expectedEthOut: quote.expectedEthOut,
    minEthOut: quote.minEthOut,
    expectedCollateralOut: quote.expectedCollateralOut,
    minCollateralOut: quote.minCollateralOut,
    receipt: {
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    },
  };
}

// Commander instance — parallels `create.js:400` pattern so `helpers.js`
// `runtime.sell` resolves to a Command object with `parseAsync`.
// Default slippage 500 bps (5%) matches frontend `trade-result/index.tsx:15`.
export const sell = new Command('sell')
  .description('Sell tokens for ETH or collateral (tax-aware routing)')
  .argument('<tokenAddress>', 'Token contract address')
  .argument('<tokenAmount>', 'Token amount to sell (whole tokens, not wei)')
  .option('--slippage <bps>', 'Legacy alias for --slippage-bps')
  .option('--slippage-bps <bps>', 'Slippage tolerance in bps (default: 500 = 5%)')
  .option('--pair <type>', 'Collateral pair (ETH|USDC|SOL)')
  .option('--use-eth', 'Receive ETH (default)', true)
  .option('--no-use-eth', "Receive the token's collateral ERC20 instead of ETH")
  .option('--dry-run', 'Decode + simulate the trade without submitting')
  .action(async (tokenAddress, tokenAmount, options) => {
    try {
      const result = await sellCommand(tokenAddress, tokenAmount, options);
      // Same dry-run sentinel convention as buy.js — `emitDryRun` already
      // printed a full payload; skip the wrap to avoid double JSON log.
      if (result && result.dryRun === true) return;
      console.log(JSON.stringify({ success: true, data: result }, null, 2));
    } catch (error) {
      // See buy.js .action — propagate RECEIPT_TIMEOUT structured fields,
      // filtering `code` through the stable-code whitelist so viem's
      // `RpcRequestError.code` (numeric) doesn't leak into the payload.
      const payload = { success: false, error: error?.message || String(error) };
      const stableCode = pickStableErrorCode(error?.code);
      if (stableCode) payload.code = stableCode;
      if (error?.txHash) payload.txHash = error.txHash;
      if (error?.txLabel) payload.txLabel = error.txLabel;
      console.error(JSON.stringify(payload));
      process.exit(1);
    }
  });
