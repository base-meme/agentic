import { getChainId } from './chain.js';
import { shouldUseTaxFactory, shouldUseUniswapV3 } from './version.js';
import { getChainConfig } from './chain-configs.js';
import {
  basememeTaxFactoryImplABI,
  basememeTaxFactoryTradeHelperABI,
  basememeTaxTokenABI,
  taxProcessorABI,
  dividendABI,
  splitVaultABI,
  snowBallVaultABI,
  burnDividendVaultABI,
  giftVaultFactoryABI,
  uniswapV2RouterABI,
  taxAddresses,
  getTaxAddressesForChain,
} from './tax-abis.js';

export {
  basememeTaxFactoryImplABI,
  basememeTaxFactoryTradeHelperABI,
  basememeTaxTokenABI,
  taxProcessorABI,
  dividendABI,
  splitVaultABI,
  snowBallVaultABI,
  burnDividendVaultABI,
  giftVaultFactoryABI,
  uniswapV2RouterABI,
  taxAddresses,
  getTaxAddressesForChain,
};

const addresses = {
  8453: {
    basememeFactory: '0xC0599137dbF994d238f68e96CA0AfaddeE57Af1B',
    basememeFactoryImpl: '0x560bAAF627b58bA34e68b88Ae562b192119b6C03',
    basememeFactoryTradeHelper: '0xBd6bc115a8c944305b341f294c57F4eB44C1E2F4',
    bondingCurveImpl: '0xB10059567fA4538b80525442dF8881602a6c86a8',
    basememeTokenSwap: '0x2c8E47a09196505Dbc96229510A4B9ff91a8534b',
    basememeTokenImplementation: '0xBbD5C86CcFAD9914B269647f80aD829D2cfA406e',
    quoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    swapRouterV2: '0x2626664c2603336E57B271c5C0b26F421741e481',
    quoterV4: '0x0d5e0F971ED27FBfF6c2837bf31316121532048D',
    universalRouter: '0x6fF5693b99212Da76ad316178A184AB56D299b43',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },

};

export function getAddressesForChain(chainId) {
  const config = addresses[chainId];
  if (!config) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }
  return config;
}

// Legacy V3 trade stacks (Base mainnet).
const legacyTradeAddresses = {
  8453: {
    basememeFactory: '0xc2B483AC7AcA92086e3269962Bc3A92604FaCe01',
    basememeFactoryImpl: '0x91D0Cd1A7b59cb795000117B2Eefa5FDAA133C50',
    basememeTokenImplementation: '0x75212a77483Db23D56edafC566c2cF4FCa1377A6',
    bondingCurveImpl: '0x0Dc2C090011b1F69aADB369F9a5AEA10C58BF60d',
    quoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
    swapRouterV2: '0x2626664c2603336E57B271c5C0b26F421741e481',
    permit2: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  },
};

export function getAddresses() {
  return getAddressesForChain(getChainId());
}

export function getAddressesForTrade(chainId, coinVersion) {
  // Tax-first routing (HOTFIX #2 strengthened): must precede the V2/V3 legacy
  // check so tax tokens (>= 11.2.0) never fall through to the V4 addresses or
  // the V3 legacy stack. resolveTradePath() is the canonical classifier, but
  // the address lookup itself still keys off shouldUseTaxFactory since the
  // legacy-V3 branch needs its own map.
  if (shouldUseTaxFactory(coinVersion)) {
    const taxConfig = taxAddresses[chainId];
    if (!taxConfig) {
      throw new Error(`Unsupported chain ID for tax trade addresses: ${chainId}`);
    }
    const chainConfig = getChainConfig(chainId, coinVersion);
    // Merge tax-specific addresses with the shared UNISWAP_V2_ROUTER (Base
    // canonical 0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24 — used by the
    // DirectCollateral path via fee-on-transfer variants, HOTFIX #3).
    return {
      ...taxConfig,
      uniswapV2Router: chainConfig.UNISWAP_V2_ROUTER,
    };
  }

  if (shouldUseUniswapV3(coinVersion)) {
    const legacy = legacyTradeAddresses[chainId];
    if (!legacy) {
      throw new Error(`Unsupported chain ID for legacy trade addresses: ${chainId}`);
    }
    return legacy;
  }

  return getAddressesForChain(chainId);
}

// Explicit collateral create entrypoints mirror createBasememeTokenWithCollateral
// and createBasememeTokenDynamicWithCollateral from the factory implementation.
export const basememeFactoryCreateABI = [
  {
    name: 'createBasememeTokenWithCollateral',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_name', type: 'string' },
      { name: '_symbol', type: 'string' },
      { name: '_tokenURI', type: 'string' },
      { name: '_nonce', type: 'uint256' },
      { name: '_signature', type: 'bytes' },
      { name: '_platformReferrer', type: 'address' },
      { name: '_payoutRecipient', type: 'address' },
      { name: '_tokenSalt', type: 'bytes32' },
      { name: '_collateralToken', type: 'address' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'createBasememeTokenAndBuyWithCollateral',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_name', type: 'string' },
      { name: '_symbol', type: 'string' },
      { name: '_tokenURI', type: 'string' },
      { name: '_nonce', type: 'uint256' },
      { name: '_collateralAmountIn', type: 'uint256' },
      { name: '_tokenAmountMin', type: 'uint256' },
      { name: '_signature', type: 'bytes' },
      { name: '_platformReferrer', type: 'address' },
      { name: '_payoutRecipient', type: 'address' },
      { name: '_tokenSalt', type: 'bytes32' },
      { name: '_collateralToken', type: 'address' },
    ],
    outputs: [
      { name: '', type: 'address' },
      { name: '', type: 'uint256' },
    ],
  },
  {
    name: 'createBasememeTokenDynamicWithCollateral',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_name', type: 'string' },
      { name: '_symbol', type: 'string' },
      { name: '_tokenURI', type: 'string' },
      { name: '_nonce', type: 'uint256' },
      { name: '_signature', type: 'bytes' },
      { name: '_platformReferrer', type: 'address' },
      { name: '_payoutRecipient', type: 'address' },
      { name: '_tokenSalt', type: 'bytes32' },
      { name: '_collateralToken', type: 'address' },
      { name: 'targetRaise', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'createBasememeTokenDynamicWithCollateral',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_name', type: 'string' },
      { name: '_symbol', type: 'string' },
      { name: '_tokenURI', type: 'string' },
      { name: '_nonce', type: 'uint256' },
      { name: '_signature', type: 'bytes' },
      { name: '_platformReferrer', type: 'address' },
      { name: '_payoutRecipient', type: 'address' },
      { name: '_tokenSalt', type: 'bytes32' },
      { name: '_collateralToken', type: 'address' },
      { name: 'targetRaise', type: 'uint256' },
      { name: 'lockBps', type: 'uint16' },
      { name: 'lockupDuration', type: 'uint64' },
      { name: 'vestingDuration', type: 'uint64' },
      { name: 'lockAdmin', type: 'address' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'createBasememeTokenDynamicAndBuyWithCollateral',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_name', type: 'string' },
      { name: '_symbol', type: 'string' },
      { name: '_tokenURI', type: 'string' },
      { name: '_nonce', type: 'uint256' },
      { name: '_collateralAmountIn', type: 'uint256' },
      { name: '_tokenAmountMin', type: 'uint256' },
      { name: '_signature', type: 'bytes' },
      { name: '_platformReferrer', type: 'address' },
      { name: '_payoutRecipient', type: 'address' },
      { name: '_tokenSalt', type: 'bytes32' },
      { name: '_collateralToken', type: 'address' },
      { name: 'targetRaise', type: 'uint256' },
    ],
    outputs: [
      { name: '', type: 'address' },
      { name: '', type: 'uint256' },
    ],
  },
  {
    name: 'createBasememeTokenDynamicAndBuyWithCollateral',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: '_name', type: 'string' },
      { name: '_symbol', type: 'string' },
      { name: '_tokenURI', type: 'string' },
      { name: '_nonce', type: 'uint256' },
      { name: '_collateralAmountIn', type: 'uint256' },
      { name: '_tokenAmountMin', type: 'uint256' },
      { name: '_signature', type: 'bytes' },
      { name: '_platformReferrer', type: 'address' },
      { name: '_payoutRecipient', type: 'address' },
      { name: '_tokenSalt', type: 'bytes32' },
      { name: '_collateralToken', type: 'address' },
      { name: 'targetRaise', type: 'uint256' },
      { name: 'lockBps', type: 'uint16' },
      { name: 'lockupDuration', type: 'uint64' },
      { name: 'vestingDuration', type: 'uint64' },
      { name: 'lockAdmin', type: 'address' },
    ],
    outputs: [
      { name: '', type: 'address' },
      { name: '', type: 'uint256' },
    ],
  },
];

export const basememeFactoryABI = [
  {
    name: 'tokenToBondingCurve',
    type: 'function',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'tokenToCollateralToken',
    type: 'function',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'buyExactIn',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'minTokenOut', type: 'uint256' },
      { name: 'tradeReferrer', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'buyExactInWithCollateral',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'collateralAmount', type: 'uint256' },
      { name: 'minTokenOut', type: 'uint256' },
      { name: 'tradeReferrer', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'sellExactIn',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'tokenAmountIn', type: 'uint256' },
      { name: 'minCollateralOut', type: 'uint256' },
      { name: 'tradeReferrer', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  ...basememeFactoryCreateABI,
];

export const bondingCurveABI = [
  {
    name: 'virtualCollateralReserves',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'virtualTokenReserves',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'feeBPS',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'firstBuyCompleted',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'firstBuyFee',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'tradingStopped',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'sendingToPairForbidden',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    name: 'virtualCollateralReservesTarget',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'mcLowerLimit',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'mcUpperLimit',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getAmountOutAndFee',
    type: 'function',
    inputs: [
      { name: '_amountIn', type: 'uint256' },
      { name: '_reserveIn', type: 'uint256' },
      { name: '_reserveOut', type: 'uint256' },
      { name: '_paymentTokenIsIn', type: 'bool' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'fee', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
];

// Tax-factory create-receipt events (HOTFIX #9 · Phase 2 port).
// The tax factory signature-aligns its `NewBasememeToken` event with the V4
// factory: same 12-field unindexed shape. Caller picks this ABI only when
// decoding a tax-create receipt — V4 create continues to use the V4 ABI
// below. Source: contracts-basememe-tax/src/interfaces/IBasememeTaxFactoryImpl.sol:214-227.
export const basememeTaxFactoryEvents = [
  {
    name: 'NewBasememeToken',
    type: 'event',
    inputs: [
      { name: 'addr', type: 'address', indexed: false },
      { name: 'bondingCurve', type: 'address', indexed: false },
      { name: 'creator', type: 'address', indexed: false },
      { name: 'signature', type: 'bytes', indexed: false },
      { name: 'platformReferrer', type: 'address', indexed: false },
      { name: 'payoutRecipient', type: 'address', indexed: false },
      { name: 'owner', type: 'address', indexed: false },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'name', type: 'string', indexed: false },
      { name: 'symbol', type: 'string', indexed: false },
      { name: 'tokenURI', type: 'string', indexed: false },
      { name: 'version', type: 'string', indexed: false },
    ],
  },
];

export const basememeFactoryEvents = [
  {
    name: 'NewBasememeToken',
    type: 'event',
    inputs: [
      { name: 'addr', type: 'address', indexed: false },
      { name: 'bondingCurve', type: 'address', indexed: false },
      { name: 'creator', type: 'address', indexed: false },
      { name: 'signature', type: 'bytes', indexed: false },
      { name: 'platformReferrer', type: 'address', indexed: false },
      { name: 'payoutRecipient', type: 'address', indexed: false },
      { name: 'owner', type: 'address', indexed: false },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'name', type: 'string', indexed: false },
      { name: 'symbol', type: 'string', indexed: false },
      { name: 'tokenURI', type: 'string', indexed: false },
      { name: 'version', type: 'string', indexed: false },
    ],
  },
  {
    name: 'BasememeTokenBuy',
    type: 'event',
    inputs: [
      { name: 'buyer', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'collateralAmount', type: 'uint256', indexed: false },
      { name: 'tokenAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    name: 'BasememeTokenSell',
    type: 'event',
    inputs: [
      { name: 'seller', type: 'address', indexed: true },
      { name: 'token', type: 'address', indexed: true },
      { name: 'tokenAmount', type: 'uint256', indexed: false },
      { name: 'collateralAmount', type: 'uint256', indexed: false },
    ],
  },
];

export const erc20ApproveABI = [
  {
    name: 'approve',
    type: 'function',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'allowance',
    type: 'function',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
];

export const erc20ABI = [
  {
    name: 'name',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'symbol',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'decimals',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  ...erc20ApproveABI,
  {
    name: 'transfer',
    type: 'function',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
];

export const tradeHelperABI = [
  {
    name: 'buyWithEth',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'funds', type: 'uint256' },
      { name: 'minTokenOut', type: 'uint256' },
      { name: 'tradeReferrer', type: 'address' },
    ],
    outputs: [
      { name: 'tokenOut', type: 'uint256' },
      { name: 'refundOut', type: 'uint256' },
    ],
    stateMutability: 'payable',
  },
  {
    name: 'sellForEth',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'tokenAmountIn', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
      { name: 'tradeReferrer', type: 'address' },
    ],
    outputs: [{ name: 'ethOut', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'quoteEthToCollateralForToken',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'ethIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'collateralOut', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    name: 'quoteCollateralToEthForToken',
    type: 'function',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'collateralIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'ethOut', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    name: 'quoteDexExactInput',
    type: 'function',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOutReceivedExpected', type: 'uint256' }],
    stateMutability: 'view',
  },
];

export const quoterV2ABI = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'fee', type: 'uint24' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ],
    }],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
];

export const swapRouterV2ABI = [
  {
    name: 'exactInput',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'path', type: 'bytes' },
        { name: 'recipient', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        { name: 'tokenIn', type: 'address' },
        { name: 'tokenOut', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'recipient', type: 'address' },
        { name: 'amountIn', type: 'uint256' },
        { name: 'amountOutMinimum', type: 'uint256' },
        { name: 'sqrtPriceLimitX96', type: 'uint160' },
      ],
    }],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    name: 'multicall',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'deadline', type: 'uint256' },
      { name: 'data', type: 'bytes[]' },
    ],
    outputs: [{ name: 'results', type: 'bytes[]' }],
  },
  {
    name: 'unwrapWETH9',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountMinimum', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [],
  },
];

export const quoterV4ABI = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{
      name: 'params',
      type: 'tuple',
      components: [
        {
          name: 'poolKey',
          type: 'tuple',
          components: [
            { name: 'currency0', type: 'address' },
            { name: 'currency1', type: 'address' },
            { name: 'fee', type: 'uint24' },
            { name: 'tickSpacing', type: 'int24' },
            { name: 'hooks', type: 'address' },
          ],
        },
        { name: 'zeroForOne', type: 'bool' },
        { name: 'exactAmount', type: 'uint128' },
        { name: 'hookData', type: 'bytes' },
      ],
    }],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
];

export const universalRouterABI = [
  {
    name: 'execute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
];

export const permit2ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
  },
];

const ERC8004_NFT_ADDRESSES = {
  8453: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
};

export function ERC8004_NFT_ADDRESS() {
  return ERC8004_NFT_ADDRESSES[getChainId()]
    || ERC8004_NFT_ADDRESSES[8453];
}

export const erc8004ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'balanceOf',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'tokenURI',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'ownerOf',
    type: 'function',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
];

export const erc8004Events = [
  {
    name: 'Registered',
    type: 'event',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
];

export default {
  getAddresses,
  getAddressesForChain,
  getAddressesForTrade,
  basememeFactoryABI,
  basememeFactoryCreateABI,
  bondingCurveABI,
  basememeFactoryEvents,
  basememeTaxFactoryEvents,
  erc20ApproveABI,
  erc20ABI,
  tradeHelperABI,
  quoterV2ABI,
  swapRouterV2ABI,
  quoterV4ABI,
  universalRouterABI,
  permit2ABI,
  ERC8004_NFT_ADDRESS,
  erc8004ABI,
  erc8004Events,
};
