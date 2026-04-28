const MAX_BPS = 10_000n;
const ONE_TOKEN = 10n ** 18n;

function basisPoints(amount, bps) {
  return (amount * bps) / MAX_BPS;
}

function ceilDiv(a, b) {
  if (b === 0n) {
    throw new Error('Division by zero in ceilDiv');
  }
  return a === 0n ? 0n : ((a - 1n) / b) + 1n;
}

function mulDiv(a, b, c) {
  if (c === 0n) {
    throw new Error('Division by zero in mulDiv');
  }
  return (a * b) / c;
}

function mathSqrt(value) {
  if (value === 0n) return 0n;
  if (value === 1n) return 1n;
  return BigInt(Math.floor(Math.sqrt(Number(value))));
}

function errorWithCause(message, cause) {
  const error = new Error(message);
  error.cause = cause;
  return error;
}

function isDynamicCurve(params) {
  return params?.curveType === 'dynamic';
}

export function getMarketCap(totalSupply, collateralReserve, tokenReserve) {
  if (tokenReserve === 0n) return 0n;
  return mulDiv(totalSupply, collateralReserve, tokenReserve);
}

export function calculateEthNeededForTargetMc(
  targetMc,
  currentCollateralReserve,
  currentTokenReserve,
  totalSupply,
  params,
) {
  const currentMc = getMarketCap(totalSupply, currentCollateralReserve, currentTokenReserve);
  if (currentMc >= targetMc) {
    return 0n;
  }

  const initialMarketCap = mulDiv(totalSupply, currentCollateralReserve, currentTokenReserve);
  if (targetMc <= initialMarketCap) {
    return params.firstBuyFee;
  }

  const tempMul = mulDiv(targetMc, currentTokenReserve, totalSupply);
  const insideSqrt = tempMul * currentCollateralReserve;
  const newCollateralReserves = mathSqrt(insideSqrt);
  const netCollateralIn = newCollateralReserves - currentCollateralReserve;
  const grossCollateralIn = params.feeBps === 0n
    ? netCollateralIn
    : ceilDiv(netCollateralIn * MAX_BPS, MAX_BPS - params.feeBps);

  return params.firstBuyCompleted ? grossCollateralIn : grossCollateralIn + params.firstBuyFee;
}

export function calculateTokenNeededForTargetMc(
  targetMc,
  currentCollateralReserve,
  currentTokenReserve,
  totalSupply,
  params,
) {
  const currentMc = getMarketCap(totalSupply, currentCollateralReserve, currentTokenReserve);
  if (currentMc >= targetMc) {
    return 0n;
  }

  const initialMarketCap = mulDiv(totalSupply, currentCollateralReserve, currentTokenReserve);
  if (targetMc <= initialMarketCap) {
    return 0n;
  }

  const tempMul = mulDiv(targetMc, currentTokenReserve, totalSupply);
  const insideSqrt = tempMul * currentCollateralReserve;
  const newCollateralReserves = mathSqrt(insideSqrt);
  const collateralToSpend = newCollateralReserves - currentCollateralReserve;

  return mulDiv(collateralToSpend, currentTokenReserve, currentCollateralReserve + collateralToSpend);
}

function virtualCollateralReservesTarget(params) {
  return params.virtualCollateralReservesInitial + params.targetCollectionAmount;
}

function maxTokenOutBeforeTarget(virtualCollateralReserves, virtualTokenReserves, params) {
  const target = virtualCollateralReservesTarget(params);
  if (virtualCollateralReserves >= target) return 0n;
  const remainingNetCollateral = target - virtualCollateralReserves;
  return mulDiv(
    remainingNetCollateral,
    virtualTokenReserves,
    virtualCollateralReserves + remainingNetCollateral,
  );
}

function shouldTradingBeStopped(virtualCollateralReserves, virtualTokenReserves, params) {
  const target = virtualCollateralReservesTarget(params);
  if (virtualCollateralReserves >= target) return true;
  return maxTokenOutBeforeTarget(virtualCollateralReserves, virtualTokenReserves, params) < ONE_TOKEN;
}

export function getGraduationQuoteFromCurrent(state) {
  const virtualCollateral = BigInt(state.virtualCollateralReserves);
  const virtualToken = BigInt(state.virtualTokenReserves);
  const totalSupply = BigInt(state.totalSupply ?? 0n);
  const mcLowerLimit = BigInt(state.mcLowerLimit ?? 0n);
  const mcUpperLimit = BigInt(state.mcUpperLimit ?? 0n);
  const feeBps = BigInt(state.feeBps ?? state.feeBPS ?? 0n);
  const firstBuyCompleted = Boolean(state.firstBuyCompleted);
  const firstBuyFee = BigInt(state.firstBuyFee ?? 0n);

  if (!isDynamicCurve(state)) {
    if (mcUpperLimit === 0n || totalSupply === 0n) {
      throw new Error('Legacy graduation quote requires mc limits and total supply.');
    }
    const targetLimit = (mcUpperLimit + mcLowerLimit) / 2n;
    const grossAmountIn = calculateEthNeededForTargetMc(targetLimit, virtualCollateral, virtualToken, totalSupply, {
      feeBps,
      firstBuyFee,
      firstBuyCompleted,
    });

    return {
      grossAmountIn,
      netCollateralNeeded: grossAmountIn,
      firstBuyFee,
      totalFeeBps: feeBps,
      willStopTrading: true,
      reason: 'marketCapLimit',
      maxTokenOutBeforeTarget: calculateTokenNeededForTargetMc(
        targetLimit,
        virtualCollateral,
        virtualToken,
        totalSupply,
        { feeBps, firstBuyFee, firstBuyCompleted },
      ),
    };
  }

  const target = state.virtualCollateralReservesTarget !== undefined
    ? BigInt(state.virtualCollateralReservesTarget)
    : virtualCollateralReservesTarget(state);

  if (feeBps >= MAX_BPS) {
    throw new Error(`feeBps (${feeBps}) must be less than 10000`);
  }

  const netCollateralNeeded = virtualCollateral < target ? target - virtualCollateral : 0n;
  const maxTokenOut = netCollateralNeeded > 0n
    ? mulDiv(netCollateralNeeded, virtualToken, virtualCollateral + netCollateralNeeded)
    : 0n;

  if (netCollateralNeeded === 0n) {
    return {
      grossAmountIn: 0n,
      netCollateralNeeded,
      firstBuyFee,
      totalFeeBps: feeBps,
      willStopTrading: true,
      reason: 'targetReached',
      maxTokenOutBeforeTarget: maxTokenOut,
    };
  }

  if (maxTokenOut < ONE_TOKEN) {
    return {
      grossAmountIn: 0n,
      netCollateralNeeded,
      firstBuyFee,
      totalFeeBps: feeBps,
      willStopTrading: true,
      reason: 'dustThreshold',
      maxTokenOutBeforeTarget: maxTokenOut,
    };
  }

  const grossNeeded = feeBps === 0n
    ? netCollateralNeeded
    : ceilDiv(netCollateralNeeded * MAX_BPS, MAX_BPS - feeBps);

  return {
    grossAmountIn: grossNeeded + (firstBuyCompleted ? 0n : firstBuyFee),
    netCollateralNeeded,
    firstBuyFee,
    totalFeeBps: feeBps,
    willStopTrading: true,
    reason: 'targetReached',
    maxTokenOutBeforeTarget: maxTokenOut,
  };
}

function getAmountOutAndFeeLegacy(amountIn, reserveIn, reserveOut, paymentTokenIsIn, params) {
  if (amountIn === 0n) throw new Error('AmountInZero');
  if (reserveIn === 0n || reserveOut === 0n) throw new Error('InvalidLiquidity');

  const {
    feeBps,
    firstBuyFee,
    firstBuyCompleted,
    mcUpperLimit,
    mcLowerLimit,
    totalSupply,
  } = params;

  if (paymentTokenIsIn) {
    if (!firstBuyCompleted && amountIn <= firstBuyFee) {
      throw new Error('InsufficientFirstBuyFee');
    }

    const netAmountForTrade = firstBuyCompleted ? amountIn : amountIn - firstBuyFee;
    const tradeFee = basisPoints(netAmountForTrade, feeBps);
    const netIn = netAmountForTrade - tradeFee;

    let fee = tradeFee;
    if (!firstBuyCompleted) {
      fee += firstBuyFee;
    }

    const reserveInAfter = reserveIn + netIn;
    const reserveOutAfter = mulDiv(reserveIn, reserveOut, reserveInAfter);
    const mcAfter = getMarketCap(totalSupply, reserveInAfter, reserveOutAfter);
    const targetLimit = (mcUpperLimit + mcLowerLimit) / 2n;

    if (mcUpperLimit > 0n && mcAfter > targetLimit) {
      const ethNeeded = calculateEthNeededForTargetMc(
        targetLimit,
        reserveIn,
        reserveOut,
        totalSupply,
        params,
      );
      throw errorWithCause('MarketCapExceededError', ethNeeded);
    }

    const amountOut = netIn > 0n ? mulDiv(netIn, reserveOut, reserveIn + netIn) : 0n;
    if (amountOut >= reserveOut) {
      throw new Error('InsufficientLiquidity');
    }

    return { amount: amountOut, fee, refund: 0n, amountOutUsed: amountOut };
  }

  const grossOut = mulDiv(amountIn, reserveOut, reserveIn + amountIn);
  const fee = basisPoints(grossOut, feeBps);
  const amountOut = grossOut - fee;
  return { amount: amountOut, fee, refund: 0n, amountOutUsed: amountOut };
}

function getAmountOutAndFeeDynamic(amountIn, reserveIn, reserveOut, paymentTokenIsIn, params) {
  if (amountIn === 0n) throw new Error('AmountInZero');
  if (reserveIn === 0n || reserveOut === 0n) throw new Error('InvalidLiquidity');
  if (params.feeBps >= MAX_BPS) {
    throw new Error(`feeBps (${params.feeBps}) must be less than 10000`);
  }

  const { feeBps, firstBuyFee, firstBuyCompleted } = params;

  if (paymentTokenIsIn) {
    if (shouldTradingBeStopped(reserveIn, reserveOut, params)) {
      throw new Error('TradingStopped');
    }

    if (!firstBuyCompleted && amountIn <= firstBuyFee) {
      throw new Error('InsufficientFirstBuyFee');
    }

    let remainingValue = amountIn;
    let firstFee = 0n;
    if (!firstBuyCompleted) {
      remainingValue -= firstBuyFee;
      firstFee = firstBuyFee;
    }

    const collateralToPayWithFeeFull = remainingValue;
    const tradeFeeFull = basisPoints(collateralToPayWithFeeFull, feeBps);
    const netFull = collateralToPayWithFeeFull - tradeFeeFull;

    const virtualCollateral = reserveIn;
    const virtualCollateralTarget = virtualCollateralReservesTarget(params);

    let netUsed = netFull;
    let collateralToPayWithFee = collateralToPayWithFeeFull;
    let tradeFee = tradeFeeFull;

    if (virtualCollateral < virtualCollateralTarget) {
      const remainingNet = virtualCollateralTarget - virtualCollateral;
      if (netFull > remainingNet) {
        netUsed = remainingNet;

        if (feeBps === 0n) {
          collateralToPayWithFee = netUsed;
          tradeFee = 0n;
        } else {
          collateralToPayWithFee = (netUsed * MAX_BPS) / (MAX_BPS - feeBps);
          tradeFee = collateralToPayWithFee - netUsed;
        }
      }
    }

    const amountOut = netUsed > 0n ? mulDiv(netUsed, reserveOut, reserveIn + netUsed) : 0n;
    if (amountOut >= reserveOut) {
      throw new Error('InsufficientLiquidity');
    }

    const totalFee = tradeFee + firstFee;
    const usedGross = firstFee + collateralToPayWithFee;
    const refund = amountIn > usedGross ? amountIn - usedGross : 0n;

    return { amount: amountOut, fee: totalFee, refund, amountOutUsed: amountOut };
  }

  if (shouldTradingBeStopped(reserveOut, reserveIn, params)) {
    throw new Error('TradingStopped');
  }
  const grossOut = mulDiv(amountIn, reserveOut, reserveIn + amountIn);
  const fee = basisPoints(grossOut, feeBps);
  const amountOut = grossOut - fee;
  return { amount: amountOut, fee, refund: 0n, amountOutUsed: amountOut };
}

export function getAmountOutAndFee(amountIn, reserveIn, reserveOut, paymentTokenIsIn, params) {
  if (isDynamicCurve(params)) {
    return getAmountOutAndFeeDynamic(amountIn, reserveIn, reserveOut, paymentTokenIsIn, params);
  }
  return getAmountOutAndFeeLegacy(amountIn, reserveIn, reserveOut, paymentTokenIsIn, params);
}

function getAmountInAndFeeLegacy(amountOut, reserveIn, reserveOut, paymentTokenIsOut, params) {
  if (amountOut === 0n) throw new Error('AmountOutZero');
  if (reserveIn === 0n || reserveOut === 0n) throw new Error('InvalidLiquidity');

  const {
    feeBps,
    firstBuyFee,
    firstBuyCompleted,
    mcUpperLimit,
    mcLowerLimit,
    totalSupply,
  } = params;

  if (paymentTokenIsOut) {
    const grossOut = mulDiv(amountOut, MAX_BPS, MAX_BPS - feeBps);
    if (grossOut >= reserveOut) throw new Error('InsufficientLiquidity');

    const amountIn = mulDiv(grossOut, reserveIn, reserveOut - grossOut);
    const fee = grossOut - amountOut;
    return { amount: amountIn, fee, refund: 0n, amountOutUsed: amountOut };
  }

  const collateralToSpend = mulDiv(amountOut, reserveIn, reserveOut - amountOut);
  const tradeFee = basisPoints(collateralToSpend, feeBps);
  const collateralToPayWithFee = collateralToSpend + tradeFee;

  let amountIn = collateralToPayWithFee;
  let fee = tradeFee;
  if (!firstBuyCompleted) {
    amountIn += firstBuyFee;
    fee += firstBuyFee;
  }

  const reserveInAfter = reserveIn + collateralToSpend;
  const reserveOutAfter = mulDiv(reserveIn, reserveOut, reserveInAfter);
  const mcAfter = getMarketCap(totalSupply, reserveInAfter, reserveOutAfter);
  const targetLimit = (mcUpperLimit + mcLowerLimit) / 2n;

  if (mcUpperLimit > 0n && mcAfter > targetLimit) {
    const tokenNeeded = calculateTokenNeededForTargetMc(
      targetLimit,
      reserveIn,
      reserveOut,
      totalSupply,
      params,
    );
    throw errorWithCause('MarketCapExceededError', tokenNeeded);
  }

  return { amount: amountIn, fee, refund: 0n, amountOutUsed: amountOut };
}

function getAmountInAndFeeDynamic(amountOut, reserveIn, reserveOut, paymentTokenIsOut, params) {
  if (amountOut === 0n) throw new Error('AmountOutZero');
  if (reserveIn === 0n || reserveOut === 0n) throw new Error('InvalidLiquidity');

  const { feeBps, firstBuyFee, firstBuyCompleted } = params;

  if (paymentTokenIsOut) {
    if (shouldTradingBeStopped(reserveOut, reserveIn, params)) {
      throw new Error('TradingStopped');
    }
    if (feeBps >= MAX_BPS) throw new Error('InvalidFeeBps');

    const grossOut = mulDiv(amountOut, MAX_BPS, MAX_BPS - feeBps);
    if (grossOut >= reserveOut) throw new Error('InsufficientLiquidity');

    const amountIn = mulDiv(grossOut, reserveIn, reserveOut - grossOut);
    const fee = grossOut - amountOut;
    return { amount: amountIn, fee, refund: 0n, amountOutUsed: amountOut };
  }

  if (shouldTradingBeStopped(reserveIn, reserveOut, params)) {
    const target = virtualCollateralReservesTarget(params);
    const remainingNetCollateral = reserveIn < target ? target - reserveIn : 0n;
    const maxOut = maxTokenOutBeforeTarget(reserveIn, reserveOut, params);
    throw errorWithCause('TradingStopped', {
      remainingNetCollateral,
      maxTokenOutBeforeTarget: maxOut,
    });
  }

  const virtualCollateral = reserveIn;
  const virtualCollateralTarget = virtualCollateralReservesTarget(params);
  const remainingNet = virtualCollateral < virtualCollateralTarget ? virtualCollateralTarget - virtualCollateral : 0n;

  if (remainingNet === 0n) {
    throw errorWithCause('TradingStopped', { remainingNetCollateral: 0n });
  }

  if (reserveOut === 0n) throw new Error('InsufficientLiquidity');
  const maxByVirtualReserves = reserveOut > 0n ? reserveOut - 1n : 0n;
  const maxByTarget = mulDiv(remainingNet, reserveOut, reserveIn + remainingNet);
  const maxAllowed = maxByTarget < maxByVirtualReserves ? maxByTarget : maxByVirtualReserves;

  let amountOutUsed = amountOut > maxAllowed ? maxAllowed : amountOut;
  if (amountOutUsed === 0n) throw new Error('InsufficientLiquidity');

  let collateralToSpend = mulDiv(amountOutUsed, reserveIn, reserveOut - amountOutUsed);
  if (collateralToSpend > remainingNet) {
    let guard = 0;
    while (amountOutUsed > 0n && collateralToSpend > remainingNet && guard < 32) {
      amountOutUsed -= 1n;
      collateralToSpend = mulDiv(amountOutUsed, reserveIn, reserveOut - amountOutUsed);
      guard += 1;
    }
    if (amountOutUsed === 0n || collateralToSpend > remainingNet) {
      throw errorWithCause('CollectionTargetExceeded', maxByTarget);
    }
  }

  const tradeFee = basisPoints(collateralToSpend, feeBps);
  const collateralToPayWithFee = collateralToSpend + tradeFee;

  let amountIn = collateralToPayWithFee;
  let fee = tradeFee;

  if (!firstBuyCompleted) {
    amountIn += firstBuyFee;
    fee += firstBuyFee;
  }

  return { amount: amountIn, fee, refund: 0n, amountOutUsed };
}

export function getAmountInAndFee(amountOut, reserveIn, reserveOut, paymentTokenIsOut, params) {
  if (isDynamicCurve(params)) {
    return getAmountInAndFeeDynamic(amountOut, reserveIn, reserveOut, paymentTokenIsOut, params);
  }
  return getAmountInAndFeeLegacy(amountOut, reserveIn, reserveOut, paymentTokenIsOut, params);
}
