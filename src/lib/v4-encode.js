import { encodeAbiParameters, pad } from 'viem';

const poolKeyComponents = [
  { type: 'address' },
  { type: 'address' },
  { type: 'uint24' },
  { type: 'int24' },
  { type: 'address' },
];

export const OPEN_DELTA = 0n;
export const CONTRACT_BALANCE = 1n << 255n;

export const UR = {
  V3_SWAP_EXACT_IN: 0x00,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
  V4_SWAP: 0x10,
};

export const V4Action = {
  SWAP_EXACT_IN_SINGLE: 0x06,
  SWAP_EXACT_OUT_SINGLE: 0x08,
  SETTLE: 0x0b,
  SETTLE_ALL: 0x0c,
  TAKE: 0x0e,
  TAKE_ALL: 0x0f,
  SWEEP: 0x14,
};

export function encodeSwapExactInSingle(params) {
  return encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { type: 'tuple', components: poolKeyComponents },
        { type: 'bool' },
        { type: 'uint128' },
        { type: 'uint128' },
        { type: 'bytes' },
      ],
    }],
    [[[
      params.poolKey.currency0,
      params.poolKey.currency1,
      Number(params.poolKey.fee),
      Number(params.poolKey.tickSpacing),
      params.poolKey.hooks,
    ], params.zeroForOne, params.amountIn, params.amountOutMinimum, params.hookData]],
  );
}

export function encodeSwapExactOutSingle(params) {
  return encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { type: 'tuple', components: poolKeyComponents },
        { type: 'bool' },
        { type: 'uint128' },
        { type: 'uint128' },
        { type: 'bytes' },
      ],
    }],
    [[[
      params.poolKey.currency0,
      params.poolKey.currency1,
      Number(params.poolKey.fee),
      Number(params.poolKey.tickSpacing),
      params.poolKey.hooks,
    ], params.zeroForOne, params.amountOut, params.amountInMaximum, params.hookData]],
  );
}

export function encodeSettle(params) {
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'bool' }],
    [params.currency, params.amount, params.payerIsUser],
  );
}

export function encodeSettleAll(params) {
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [params.currency, params.maxAmount],
  );
}

export function encodeTake(params) {
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
    [params.currency, params.recipient, params.amount],
  );
}

export function encodeTakeAll(params) {
  return encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }],
    [params.currency, params.minAmount],
  );
}

export function concatActions(actions) {
  return `0x${actions.map((action) => action.toString(16).padStart(2, '0')).join('')}`;
}

export function deriveZeroForOne(poolKey, inputCurrency) {
  return poolKey.currency0.toLowerCase() === inputCurrency.toLowerCase();
}

export function buildCommands(opcodes) {
  return `0x${opcodes.map((opcode) => opcode.toString(16).padStart(2, '0')).join('')}`;
}

export function inputWrapETH(recipient, amount) {
  return encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [recipient, amount]);
}

export function inputUnwrapWETH(recipient, amountMin) {
  return encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [recipient, amountMin]);
}

export function inputV4Swap(actions, params) {
  return encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, params]);
}

function encodeV3Fee(fee) {
  const feeNumber = typeof fee === 'bigint' ? Number(fee) : fee;
  if (!Number.isFinite(feeNumber) || feeNumber < 0 || feeNumber > 1_000_000) {
    throw new Error(`Invalid V3 fee: ${fee}`);
  }
  return pad(`0x${feeNumber.toString(16)}`, { size: 3 });
}

export function encodeV3PathSingle(params) {
  const feeHex = encodeV3Fee(params.fee).slice(2);
  return `0x${params.tokenIn.slice(2)}${feeHex}${params.tokenOut.slice(2)}`;
}

export function encodeV3Path(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('encodeV3Path requires at least one segment.');
  }

  let encoded = `0x${segments[0].tokenIn.slice(2)}`;
  for (const segment of segments) {
    encoded += `${encodeV3Fee(segment.fee).slice(2)}${segment.tokenOut.slice(2)}`;
  }
  return encoded;
}

export function inputV3SwapExactIn(params) {
  return encodeAbiParameters(
    [
      { type: 'address' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'bytes' },
      { type: 'bool' },
    ],
    [params.recipient, params.amountIn, params.amountOutMinimum, params.path, params.payerIsUser],
  );
}
