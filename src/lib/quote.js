import { formatEther, formatUnits, parseEther, parseUnits } from 'viem';
import { getTokenInfo } from './api.js';
import { getChainId, getPublicClient } from './chain.js';
import {
  getChainConfig,
  getCollateralTemplate,
  getCollateralTemplateByAddress,
  isNativeCollateralAddress,
  normalizePair,
  ZERO_ADDRESS,
} from './chain-configs.js';
import { getAmountOutAndFee, getGraduationQuoteFromCurrent } from './bonding-curve.js';
import {
  basememeFactoryABI,
  basememeTaxFactoryTradeHelperABI,
  bondingCurveABI,
  erc20ABI,
  getAddressesForTrade,
  quoterV2ABI,
  quoterV4ABI,
  tradeHelperABI,
} from './contracts.js';
import {
  assertSupportedCoinVersion,
  shouldUseDynamicBondingCurve,
  shouldUseTaxFactory,
  shouldUseUniswapV4,
} from './version.js';
import {
  resolveTradePath,
} from './tax-trade.js';

const QUOTE_ACCOUNT = '0x000000000000000000000000000000000000dEaD';

function normalizeSlippageBpsInput(value, defaultValue = 500) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    throw new Error(`Invalid slippage bps: ${value}`);
  }
  if (parsed < 0 || parsed > 10_000) {
    throw new Error(`Slippage bps must be between 0 and 10000. Received: ${parsed}`);
  }
  return parsed;
}

function applyMinOut(amount, slippageBps) {
  if (slippageBps <= 0) return amount;
  if (slippageBps >= 10_000) return 0n;
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

function unwrapApiResponse(response) {
  if (response && typeof response === 'object' && 'data' in response) {
    return response.data;
  }
  return response;
}

function safeJsonParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function selectTokenRecord(data, tokenAddress) {
  if (!data) return null;
  if (Array.isArray(data?.list)) {
    return selectTokenRecord(data.list, tokenAddress);
  }
  if (Array.isArray(data)) {
    const match = data.find(
      (item) => item?.contract_address?.toLowerCase() === tokenAddress.toLowerCase(),
    );
    if (!match) {
      throw new Error(`Token ${tokenAddress} not found in API response`);
    }
    return match;
  }
  if (data.contract_address?.toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error(`Token mismatch: requested ${tokenAddress}, got ${data.contract_address}`);
  }
  return data;
}

export function parseExtraData(extraData) {
  const parsed = safeJsonParse(extraData);
  return parsed && typeof parsed === 'object' ? parsed : {};
}

export function validatePoolKey(poolKey) {
  if (!poolKey) throw new Error('V4 poolKey missing from token extra_data');
  const { currency0, currency1, fee, tickSpacing, hooks } = poolKey;
  if (!currency0 || !currency1) throw new Error('V4 poolKey missing currency0/currency1');
  if (fee === undefined || fee === null) throw new Error('V4 poolKey missing fee');
  if (tickSpacing === undefined || tickSpacing === null) throw new Error('V4 poolKey missing tickSpacing');
  if (!hooks) throw new Error('V4 poolKey missing hooks');
}

function getPoolKey(extraData) {
  const poolKey = extraData?.poolKey || extraData?.pool_key;
  validatePoolKey(poolKey);
  return {
    currency0: poolKey.currency0,
    currency1: poolKey.currency1,
    fee: BigInt(poolKey.fee),
    tickSpacing: BigInt(poolKey.tickSpacing),
    hooks: poolKey.hooks,
  };
}

export function deriveTokenPhase({ tradingStopped, sendingToPairForbidden }) {
  if (!tradingStopped) return 'curve';
  if (sendingToPairForbidden === true) return 'graduated';
  return 'dex';
}

function formatQuote(quote, tokenDecimals) {
  if (quote.side === 'buy') {
    const paymentAsset = quote.tradeWithEth ? 'ETH' : quote.collateralSymbol;
    const feeAsset = quote.isEthPair ? 'ETH' : quote.collateralSymbol;

    return {
      tokenAddress: quote.tokenAddress,
      phase: quote.phase,
      pairType: quote.isEthPair ? 'eth' : 'collateral',
      collateralAddress: quote.collateralAddress,
      pair: quote.pair,
      tradeWithEth: quote.tradeWithEth,
      paymentAsset,
      paymentAmount: quote.inputAmount,
      paymentAmountWei: quote.inputWei.toString(),
      expectedOut: formatUnits(quote.expectedOutWei, tokenDecimals),
      minOut: formatUnits(quote.minOutWei, tokenDecimals),
      fee: quote.isEthPair ? formatEther(quote.feeWei) : formatUnits(quote.feeWei, quote.collateralDecimals || 18),
      feeAsset,
      refund: quote.isEthPair ? formatEther(quote.refundWei) : formatUnits(quote.refundWei, quote.collateralDecimals || 18),
      refundAsset: feeAsset,
      expectedOutWei: quote.expectedOutWei.toString(),
      minOutWei: quote.minOutWei.toString(),
      feeWei: quote.feeWei.toString(),
      refundWei: quote.refundWei.toString(),
      expectedTokenOut: formatUnits(quote.expectedOutWei, tokenDecimals),
      minTokenOut: formatUnits(quote.minOutWei, tokenDecimals),
      ...(quote.tradeWithEth
        ? {
            ethIn: quote.inputAmount,
            ethInWei: quote.inputWei.toString(),
          }
        : {
            collateralIn: quote.inputAmount,
            collateralInWei: quote.inputWei.toString(),
          }),
    };
  }

  const outputAsset = quote.tradeWithEth ? 'ETH' : quote.collateralSymbol;
  const outputDecimals = quote.tradeWithEth ? 18 : (quote.collateralDecimals || 18);
  const formattedExpectedOut = formatUnits(quote.expectedOutWei, outputDecimals);
  const formattedMinOut = formatUnits(quote.minOutWei, outputDecimals);

  return {
    tokenAddress: quote.tokenAddress,
    phase: quote.phase,
    pairType: quote.isEthPair ? 'eth' : 'collateral',
    collateralAddress: quote.collateralAddress,
    pair: quote.pair,
    tradeWithEth: quote.tradeWithEth,
    outputAsset,
    expectedOut: formattedExpectedOut,
    minOut: formattedMinOut,
    fee: quote.isEthPair ? formatEther(quote.feeWei) : formatUnits(quote.feeWei, quote.collateralDecimals || 18),
    feeAsset: quote.isEthPair ? 'ETH' : quote.collateralSymbol,
    expectedOutWei: quote.expectedOutWei.toString(),
    minOutWei: quote.minOutWei.toString(),
    feeWei: quote.feeWei.toString(),
    tokenIn: quote.inputAmount,
    tokenInWei: quote.inputWei.toString(),
    ...(quote.tradeWithEth
      ? {
          expectedEthOut: formattedExpectedOut,
          minEthOut: formattedMinOut,
        }
      : {
          expectedCollateralOut: formattedExpectedOut,
          minCollateralOut: formattedMinOut,
        }),
  };
}

function resolveRequestedPairContext(context, pair) {
  const requestedPair = normalizePair(pair || 'ETH');

  if (requestedPair === 'ETH') {
    return {
      pair: 'ETH',
      tradeWithEth: true,
    };
  }

  // Collateral pairs supported for V4 + tax non-ETH tokens (all phases).
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
    tradeWithEth: false,
  };
}

async function simulateHelper(client, helperAddress, functionName, args, abi = tradeHelperABI) {
  const { result } = await client.simulateContract({
    address: helperAddress,
    abi,
    functionName,
    args,
    account: QUOTE_ACCOUNT,
  });
  return result;
}

/**
 * Resolve the trade-helper address + ABI for a quote context. Tax tokens
 * (>= 11.2.0) live on `basememeTaxFactoryTradeHelper` with the tax helper
 * ABI; V4/legacy tokens use `basememeFactoryTradeHelper` with the V4
 * `tradeHelperABI`. Without this split, CrossPair quote-buy/sell on tax
 * tokens (e.g. graduated USDC-pair) called an undefined address and
 * surfaced a cryptic `OpcodeNotFound` from a sentinel sender.
 */
function resolveQuoteHelper(context) {
  if (shouldUseTaxFactory(context.coinVersion)) {
    const address = context.addresses.basememeTaxFactoryTradeHelper;
    if (!address) {
      // Symmetric to the L1 fix on `basememeTaxFactory` in
      // `loadTokenContext`: mainnet `tax-abis.js` ships
      // `basememeTaxFactoryTradeHelper = null` until the multisig
      // executes the deploy. If a tax token appears before that, we
      // surface a clear misconfiguration message rather than letting
      // an undefined address reach `simulateContract` and surface as
      // a cryptic ABI/`OpcodeNotFound` error from a sentinel sender.
      throw new Error(
        `basememeTaxFactoryTradeHelper not configured for chain ${context.chainId} `
        + '— tax helper must be deployed and wired in tax-abis.js before tax tokens can be quoted',
      );
    }
    return { address, abi: basememeTaxFactoryTradeHelperABI };
  }
  const address = context.addresses.basememeFactoryTradeHelper;
  if (!address) {
    throw new Error(`basememeFactoryTradeHelper not configured for chain ${context.chainId}`);
  }
  return { address, abi: tradeHelperABI };
}

async function quoteEthToCollateral(client, helper, tokenAddress, ethIn) {
  if (ethIn === 0n) {
    return [ZERO_ADDRESS, 0n];
  }
  return simulateHelper(client, helper.address, 'quoteEthToCollateralForToken', [tokenAddress, ethIn], helper.abi);
}

async function quoteCollateralToEth(client, helper, tokenAddress, collateralIn) {
  if (collateralIn === 0n) {
    return [ZERO_ADDRESS, 0n];
  }
  return simulateHelper(client, helper.address, 'quoteCollateralToEthForToken', [tokenAddress, collateralIn], helper.abi);
}

export async function loadTokenContext(tokenAddress) {
  const client = getPublicClient();
  const chainId = getChainId();

  const infoResponse = await getTokenInfo(tokenAddress);
  const token = selectTokenRecord(unwrapApiResponse(infoResponse), tokenAddress);
  if (!token) {
    throw new Error(`Token info not found for ${tokenAddress}`);
  }

  const extraData = parseExtraData(token.extra_data);
  if (!token.contract_address) {
    throw new Error(`Token ${tokenAddress} metadata missing contract_address`);
  }
  const coinVersion = token.coin_version || extraData?.coin_version;
  const addresses = getAddressesForTrade(chainId, coinVersion);
  assertSupportedCoinVersion(coinVersion);
  const chainConfig = getChainConfig(chainId, coinVersion);
  const defaultTemplate = getCollateralTemplate(chainId, 'ETH', coinVersion);

  const collateralAddress = token.currency_address || ZERO_ADDRESS;
  const isEthPair = isNativeCollateralAddress(collateralAddress, chainConfig);

  // Tax tokens live on `basememeTaxFactory`; V4/legacy on `basememeFactory`.
  // `tokenToBondingCurve` exists on both ABIs with identical signature so we
  // route by coinVersion.
  //
  // Phase 6 Fix R1 · F1 (L1 security): the previous fallback
  // `addresses.basememeTaxFactory || addresses.basememeFactory` masked a
  // mainnet pre-launch misconfiguration. `tax-abis.js` ships mainnet
  // `basememeTaxFactory = null` until the config multisig executes; if a
  // tax token appeared before that, the fallback quietly routed
  // `tokenToBondingCurve` to the V4 factory which returned a zero-address,
  // surfacing as a cryptic downstream multicall failure. We now throw
  // explicitly so the misconfiguration is immediately visible.
  const factoryAddress = shouldUseTaxFactory(coinVersion)
    ? addresses.basememeTaxFactory
    : addresses.basememeFactory;
  if (!factoryAddress) {
    throw new Error(
      shouldUseTaxFactory(coinVersion)
        ? `basememeTaxFactory not configured for chain ${chainId} — tax factory must be set before tax tokens can be traded`
        : `basememeFactory not configured for chain ${chainId}`,
    );
  }

  const mcContracts = [
    { address: tokenAddress, abi: erc20ABI, functionName: 'decimals' },
    ...(isEthPair
      ? []
      : [{ address: collateralAddress, abi: erc20ABI, functionName: 'decimals' }]),
    {
      address: factoryAddress,
      abi: basememeFactoryABI,
      functionName: 'tokenToBondingCurve',
      args: [tokenAddress],
    },
  ];
  const mcResults = await client.multicall({ contracts: mcContracts });
  for (const r of mcResults) { if (r.status === 'failure') throw r.error; }
  const tokenDecimals = mcResults[0].result;
  const collateralDecimals = isEthPair ? 18 : mcResults[1].result;
  const bondingCurveAddress = mcResults[mcResults.length - 1].result;

  const phaseResults = await client.multicall({
    contracts: [
      { address: bondingCurveAddress, abi: bondingCurveABI, functionName: 'tradingStopped' },
      { address: bondingCurveAddress, abi: bondingCurveABI, functionName: 'sendingToPairForbidden' },
    ],
  });
  for (const r of phaseResults) { if (r.status === 'failure') throw r.error; }
  const [tradingStopped, sendingToPairForbidden] = phaseResults.map((r) => r.result);

  const phase = deriveTokenPhase({ tradingStopped, sendingToPairForbidden });
  const pairTemplate = getCollateralTemplateByAddress(chainId, collateralAddress, coinVersion);
  const mergedConfig = { ...chainConfig, ...defaultTemplate, ...(pairTemplate || {}) };
  const dynamicParams = extraData?.dynamic_params || {};
  const targetRaise = dynamicParams.targetRaise || mergedConfig.TARGET_COLLECTION_AMOUNT;
  const virtualCollateralReservesInitial = dynamicParams.virtualCollateralReservesInitial || mergedConfig.VIRTUAL_COLLATERAL_RESERVES;

  // Tax-token fee merge: BC stage uses a single-parameter curve, so the
  // platform fee and tax rate are summed into a single `feeBps` (frontend
  // tradeEstimation.ts:91-96). V4 coins have taxRateBps = 0 -> no effect.
  const taxRateBps = shouldUseTaxFactory(coinVersion) ? getTaxRateBps(extraData) : 0n;
  const platformFeeBps = BigInt(mergedConfig.FEE_BASIS_POINTS);
  const curveFeeBps = platformFeeBps + taxRateBps;

  return {
    client,
    chainId,
    chainConfig: mergedConfig,
    addresses,
    tokenAddress,
    token,
    coinVersion,
    extraData,
    phase,
    isEthPair,
    collateralAddress,
    collateralSymbol: pairTemplate?.SYMBOL || (isEthPair ? 'ETH' : 'COLLATERAL'),
    dexCollateralAddress: isEthPair ? mergedConfig.WETH : collateralAddress,
    tokenDecimals: Number(tokenDecimals),
    collateralDecimals: Number(collateralDecimals),
    bondingCurveAddress,
    taxRateBps,
    tradePath: resolveTradePath(coinVersion),
    virtualCollateralReserves: parseUnits(String(token.virtual_collateral_reserves || '0'), Number(collateralDecimals)),
    virtualTokenReserves: parseUnits(String(token.virtual_token_reserves || '0'), Number(tokenDecimals)),
    curveParams: {
      curveType: shouldUseDynamicBondingCurve(coinVersion) ? 'dynamic' : undefined,
      feeBps: curveFeeBps,
      firstBuyFee: BigInt(mergedConfig.FIRST_BUY_FEE),
      firstBuyCompleted: Number.parseFloat(String(token.total_volume || '0')) > 0,
      mcUpperLimit: BigInt(mergedConfig.MC_UPPER_LIMIT),
      mcLowerLimit: BigInt(mergedConfig.MC_LOWER_LIMIT),
      totalSupply: BigInt(mergedConfig.TOTAL_SUPPLY),
      targetCollectionAmount: BigInt(targetRaise),
      virtualCollateralReservesInitial: BigInt(virtualCollateralReservesInitial),
    },
  };
}

/**
 * Extract the tax rate (bps) from a token's extra_data payload.
 * Source: frontend-basememe reads `extra_data.tax_token_params.taxRateBps`
 * (onemorething/index.tsx create side, useBuyEstimation.ts read side).
 *
 * Returns 0n only when the field is genuinely missing (including tax_token_params
 * missing entirely — V4 tokens, BC-phase tax tokens whose backend hasn't
 * populated yet). For MALFORMED values (non-numeric string, object, NaN),
 * this throws (L2 Codex R2 🟡).
 *
 * Note: CLI is intentionally STRICTER than frontend here. Frontend
 * `tradeEstimation.ts` uses `BigInt(raw || 0)` which silently collapses
 * any falsy input (empty string, 0, false, null) to `0n`. CLI fails fast
 * because a malformed field at this layer means we read the wrong schema
 * — surfacing that to the user as a clear error beats silently trading
 * with a 0% tax assumption and a miscalibrated quote + slippage.
 */
export function getTaxRateBps(extraData) {
  const raw = extraData?.tax_token_params?.taxRateBps
    ?? extraData?.tax_token_params?.tax_rate_bps;
  if (raw === undefined || raw === null) return 0n;
  // `BigInt` throws on invalid numeric string (e.g. "abc", "1.5", object).
  // Let it throw — caller sees a clear "Cannot convert ... to a BigInt"
  // rather than silently trading with wrong tax assumption.
  return BigInt(raw);
}

async function quoteDexExactInput(context, tokenIn, tokenOut, amountIn) {
  if (amountIn === 0n) return 0n;

  // HOTFIX #2 discipline — drive routing off the single-value classifier
  // `resolveTradePath` rather than standalone predicates. The 'v2-non-tax'
  // slot is unreachable on basememe (tax ≡ V2 on this chain); if hit, the
  // classifier throws. See PORT_AUDIT_CHECKLIST HOTFIX #2 强化.
  switch (resolveTradePath(context.coinVersion)) {
    case 'tax': {
      // Tax helper has the same `quoteDexExactInput` selector as the V4
      // helper, but ABI shapes differ; use the tax helper explicitly.
      return context.client.readContract({
        address: context.addresses.basememeTaxFactoryTradeHelper,
        abi: basememeTaxFactoryTradeHelperABI,
        functionName: 'quoteDexExactInput',
        args: [tokenIn, tokenOut, amountIn],
      });
    }
    case 'v4':
      // Falls through to the V4 / V3 blocks below (kept as-is to minimise
      // churn on the existing V4 path).
      break;
    case 'v3':
      break;
  }

  if (shouldUseUniswapV4(context.coinVersion)) {
    const poolKey = getPoolKey(context.extraData);
    const zeroForOne = tokenIn.toLowerCase() === poolKey.currency0.toLowerCase();
    const { result } = await context.client.simulateContract({
      address: context.addresses.quoterV4,
      abi: quoterV4ABI,
      functionName: 'quoteExactInputSingle',
      args: [{
        poolKey,
        zeroForOne,
        exactAmount: amountIn,
        hookData: '0x',
      }],
      account: QUOTE_ACCOUNT,
    });
    return result[0];
  }

  const { result } = await context.client.simulateContract({
    address: context.addresses.quoterV2,
    abi: quoterV2ABI,
    functionName: 'quoteExactInputSingle',
    args: [{
      tokenIn,
      tokenOut,
      amountIn,
      fee: BigInt(context.chainConfig.V3_POOL_FEE),
      sqrtPriceLimitX96: 0n,
    }],
    account: QUOTE_ACCOUNT,
  });
  return result[0];
}

export function normalizeSlippageBps(value, defaultValue = 500) {
  return normalizeSlippageBpsInput(value, defaultValue);
}

export async function getTradeContext(tokenAddress) {
  return loadTokenContext(tokenAddress);
}

export async function quoteGraduation(tokenAddress) {
  const context = await loadTokenContext(tokenAddress);
  const formatCollateral = (amount) => formatUnits(amount, context.collateralDecimals);

  if (context.phase !== 'curve') {
    return {
      tokenAddress: context.tokenAddress,
      phase: context.phase,
      pairType: context.isEthPair ? 'eth' : 'collateral',
      collateralAddress: context.collateralAddress,
      grossAmountIn: 0n,
      grossAmountInFormatted: formatCollateral(0n),
      netCollateralNeeded: 0n,
      netCollateralNeededFormatted: formatCollateral(0n),
      firstBuyFee: 0n,
      firstBuyFeeFormatted: formatCollateral(0n),
      totalFeeBps: 0n,
      willStopTrading: true,
      reason: 'targetReached',
    };
  }

  const curveResults = await context.client.multicall({
    contracts: [
      { address: context.bondingCurveAddress, abi: bondingCurveABI, functionName: 'virtualCollateralReserves' },
      { address: context.bondingCurveAddress, abi: bondingCurveABI, functionName: 'virtualTokenReserves' },
      { address: context.bondingCurveAddress, abi: bondingCurveABI, functionName: 'feeBPS' },
      { address: context.bondingCurveAddress, abi: bondingCurveABI, functionName: 'firstBuyCompleted' },
      { address: context.bondingCurveAddress, abi: bondingCurveABI, functionName: 'firstBuyFee' },
      { address: context.bondingCurveAddress, abi: bondingCurveABI, functionName: 'virtualCollateralReservesTarget' },
      { address: context.bondingCurveAddress, abi: bondingCurveABI, functionName: 'mcLowerLimit' },
      { address: context.bondingCurveAddress, abi: bondingCurveABI, functionName: 'mcUpperLimit' },
    ],
  });
  for (const r of curveResults) { if (r.status === 'failure') throw r.error; }
  const [
    virtualCollateralReserves,
    virtualTokenReserves,
    feeBPS,
    firstBuyCompleted,
    firstBuyFee,
    virtualCollateralReservesTarget,
    mcLowerLimit,
    mcUpperLimit,
  ] = curveResults.map((r) => r.result);

  const quote = getGraduationQuoteFromCurrent({
    virtualCollateralReserves,
    virtualTokenReserves,
    feeBPS,
    firstBuyCompleted,
    firstBuyFee,
    virtualCollateralReservesTarget,
    mcLowerLimit,
    mcUpperLimit,
  });

  return {
    tokenAddress: context.tokenAddress,
    phase: context.phase,
    pairType: context.isEthPair ? 'eth' : 'collateral',
    collateralAddress: context.collateralAddress,
    grossAmountIn: quote.grossAmountIn,
    grossAmountInFormatted: formatCollateral(quote.grossAmountIn),
    netCollateralNeeded: quote.netCollateralNeeded,
    netCollateralNeededFormatted: formatCollateral(quote.netCollateralNeeded),
    firstBuyFee: quote.firstBuyFee,
    firstBuyFeeFormatted: formatCollateral(quote.firstBuyFee),
    totalFeeBps: quote.totalFeeBps,
    willStopTrading: quote.willStopTrading,
    reason: quote.reason,
    maxTokenOutBeforeTarget: quote.maxTokenOutBeforeTarget,
    maxTokenOutBeforeTargetFormatted: formatUnits(quote.maxTokenOutBeforeTarget, context.tokenDecimals),
  };
}

export async function quoteBuy(tokenAddress, { ethAmount, slippageBps = 500, pair } = {}) {
  if (ethAmount === undefined || ethAmount === null || ethAmount === '') {
    throw new Error('ethAmount is required');
  }

  const resolvedSlippageBps = normalizeSlippageBpsInput(slippageBps);
  const context = await loadTokenContext(tokenAddress);
  const pairContext = resolveRequestedPairContext(context, pair);
  const amountInWei = pairContext.tradeWithEth
    ? parseEther(String(ethAmount))
    : parseUnits(String(ethAmount), context.collateralDecimals);
  // Tax-aware helper resolution (CrossPair quote bug · Phase 6 Fix R2).
  const helper = resolveQuoteHelper(context);

  let expectedOutWei = 0n;
  let feeWei = 0n;
  let refundWei = 0n;

  if (context.phase === 'curve') {
    if (context.isEthPair) {
      const result = getAmountOutAndFee(
        amountInWei,
        context.virtualCollateralReserves,
        context.virtualTokenReserves,
        true,
        context.curveParams,
      );
      expectedOutWei = result.amount;
      feeWei = result.fee;
      refundWei = result.refund;
    } else if (!pairContext.tradeWithEth) {
      // Direct collateral buy — user pays with collateral (e.g. USDC), no ETH conversion
      const result = getAmountOutAndFee(
        amountInWei,
        context.virtualCollateralReserves,
        context.virtualTokenReserves,
        true,
        context.curveParams,
      );
      expectedOutWei = result.amount;
      feeWei = result.fee;
      refundWei = result.refund;
    } else {
      // ETH buy on non-ETH pair — convert ETH to collateral first via helper
      const [, collateralOut] = await quoteEthToCollateral(context.client, helper, context.tokenAddress, amountInWei);
      const result = getAmountOutAndFee(
        collateralOut,
        context.virtualCollateralReserves,
        context.virtualTokenReserves,
        true,
        context.curveParams,
      );
      expectedOutWei = result.amount;
      feeWei = result.fee;
      refundWei = result.refund;
    }
  } else if (context.phase === 'dex') {
    if (context.isEthPair) {
      expectedOutWei = await quoteDexExactInput(
        context,
        context.dexCollateralAddress,
        context.tokenAddress,
        amountInWei,
      );
    } else if (!pairContext.tradeWithEth) {
      expectedOutWei = await quoteDexExactInput(
        context,
        context.collateralAddress,
        context.tokenAddress,
        amountInWei,
      );
    } else {
      const [collateralToken, collateralOut] = await quoteEthToCollateral(
        context.client,
        helper,
        context.tokenAddress,
        amountInWei,
      );
      expectedOutWei = await quoteDexExactInput(
        context,
        collateralToken,
        context.tokenAddress,
        collateralOut,
      );
    }

    // Tax DEX: `quoteDexExactInput` on `basememeTaxFactoryTradeHelper`
    // ALREADY applies the tax + liquidation-aware discount internally
    // (contract: `netIn = amountIn * (1-inTaxBps)` + simulates pending
    // `_liquidateTax` swap · then `amountOut = outRaw * (1-outTaxBps)`).
    // We must NOT double-discount here — bfun + basememe frontend both
    // trust the helper output directly and only apply slippage buffer.
    // (Previously `computeTaxAwareBuyExpected(expectedOutWei, taxBps)`
    // lived here · that re-applied the same discount · producing a
    // quote that was systematically `(1-tax)²×output` instead of
    // `(1-tax)×output` — which caused 11d/11e/12d/12e flakes that
    // looked like "slippage too tight".)
  } else {
    throw new Error(
      "Token is in graduated state (migration pending). Trading is temporarily unavailable. Re-check with 'basememe token-info' later.",
    );
  }

  const minOutWei = applyMinOut(expectedOutWei, resolvedSlippageBps);

  return formatQuote(
    {
      side: 'buy',
      tokenAddress: context.tokenAddress,
      phase: context.phase,
      collateralAddress: context.collateralAddress,
      isEthPair: context.isEthPair,
      pair: pairContext.pair,
      tradeWithEth: pairContext.tradeWithEth,
      inputAmount: String(ethAmount),
      inputWei: amountInWei,
      expectedOutWei,
      minOutWei,
      feeWei,
      refundWei,
      collateralDecimals: context.collateralDecimals,
      collateralSymbol: context.collateralSymbol,
    },
    context.tokenDecimals,
  );
}

export async function quoteSell(tokenAddress, { tokenAmount, slippageBps = 500, pair } = {}) {
  const resolvedSlippageBps = normalizeSlippageBpsInput(slippageBps);
  const context = await loadTokenContext(tokenAddress);
  const pairContext = resolveRequestedPairContext(context, pair);
  const amountInWei = parseUnits(String(tokenAmount), context.tokenDecimals);
  // Tax-aware helper resolution (CrossPair quote bug · Phase 6 Fix R2).
  const helper = resolveQuoteHelper(context);

  let expectedOutWei = 0n;
  let feeWei = 0n;

  if (context.phase === 'curve') {
    const result = getAmountOutAndFee(
      amountInWei,
      context.virtualTokenReserves,
      context.virtualCollateralReserves,
      false,
      context.curveParams,
    );

    if (context.isEthPair) {
      expectedOutWei = result.amount;
      feeWei = result.fee;
    } else if (!pairContext.tradeWithEth) {
      // Direct collateral sell — return collateral directly, no ETH conversion
      expectedOutWei = result.amount;
      feeWei = result.fee;
    } else {
      // ETH sell on non-ETH pair — convert collateral output to ETH via helper
      expectedOutWei = (await quoteCollateralToEth(context.client, helper, context.tokenAddress, result.amount))[1];
      feeWei = result.fee;
    }
  } else if (context.phase === 'dex') {
    // Tax DEX sell: `quoteDexExactInput` on the tax helper ALREADY
    // applies the input-side tax discount (`netIn = amountIn * (1-inTaxBps)`)
    // AND simulates pending `_liquidateTax` swaps that would mutate
    // pool reserves before the user's actual swap executes. Pass the
    // RAW `amountInWei` — the contract does the discount once. (A
    // previous version pre-discounted here via
    // `computeTaxAwarePreSellAmountInToPool` · which then got re-
    // discounted inside the contract · producing
    // `amountIn * (1-tax)²`-based quotes that under-estimated by the
    // tax squared and looked like "slippage too tight" on TAX01.)
    if (context.isEthPair) {
      expectedOutWei = await quoteDexExactInput(
        context,
        context.tokenAddress,
        context.dexCollateralAddress,
        amountInWei,
      );
    } else if (!pairContext.tradeWithEth) {
      expectedOutWei = await quoteDexExactInput(
        context,
        context.tokenAddress,
        context.collateralAddress,
        amountInWei,
      );
    } else {
      const collateralOut = await quoteDexExactInput(
        context,
        context.tokenAddress,
        context.collateralAddress,
        amountInWei,
      );
      expectedOutWei = (await quoteCollateralToEth(context.client, helper, context.tokenAddress, collateralOut))[1];
    }
  } else {
    throw new Error(
      "Token is in graduated state (migration pending). Trading is temporarily unavailable. Re-check with 'basememe token-info' later.",
    );
  }

  const minOutWei = applyMinOut(expectedOutWei, resolvedSlippageBps);

  return formatQuote({
    side: 'sell',
    tokenAddress: context.tokenAddress,
    phase: context.phase,
    collateralAddress: context.collateralAddress,
    isEthPair: context.isEthPair,
    pair: pairContext.pair,
    tradeWithEth: pairContext.tradeWithEth,
    inputAmount: String(tokenAmount),
    inputWei: amountInWei,
    expectedOutWei,
    minOutWei,
    feeWei,
    collateralDecimals: context.collateralDecimals,
    collateralSymbol: context.collateralSymbol,
  });
}
