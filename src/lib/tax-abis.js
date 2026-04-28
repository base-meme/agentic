// Tax Factory (coin_version >= 11.2.0) contract ABIs and addresses.
//
// ABIs are hand-ported from the frontend's upstream npm package
// `basememe-v4-tax-contracts-configs@testnet`. We do NOT import the npm
// package at runtime — see freee-system/BASEMEME_AI_TAX_PLAN.md design
// decision #1 (kept self-contained, bfun-ai style). Each block below is a
// minimal function subset with a `Source:` pointer to the canonical file
// so the provenance stays auditable.
//
// Source reference path (for all below):
//   node_modules/basememe-v4-tax-contracts-configs/index.js
//   (shipped with frontend-basememe · verified 2026-04-23)
//
// HOTFIX #3: when adding any DEX-swap call path for tax tokens, only use
// the `*SupportingFeeOnTransferTokens` variants of UNISWAP_V2_ROUTER_ABI.
// See PORT_AUDIT_CHECKLIST.md.

/* ============================================================
 * 1) basememeTaxFactoryImpl — factory entry point for tax tokens
 *    (create / buy / sell / view routing).
 *    Source: index.js:447 .. 1305
 * ============================================================ */
export const basememeTaxFactoryImplABI = [
  // -- create entry points (Source: index.js:592..763) --
  {
    name: 'createBasememeTaxFactoryToken',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'tokenURI', type: 'string' },
          { name: 'nonce', type: 'uint256' },
          { name: 'signature', type: 'bytes' },
          { name: 'tokenSalt', type: 'bytes32' },
          { name: 'payoutRecipient', type: 'address' },
          { name: 'marketPayoutRecipient', type: 'address' },
          { name: 'marketVaultFactory', type: 'address' },
          { name: 'marketVaultData', type: 'bytes' },
          { name: 'collateralToken', type: 'address' },
          { name: 'targetRaise', type: 'uint256' },
          { name: 'lockBps', type: 'uint16' },
          { name: 'lockupDuration', type: 'uint64' },
          { name: 'vestingDuration', type: 'uint64' },
          { name: 'lockAdmin', type: 'address' },
          { name: 'taxRateBps', type: 'uint16' },
          { name: 'taxDuration', type: 'uint64' },
          { name: 'antiFarmerDuration', type: 'uint64' },
          { name: 'processorMarketBps', type: 'uint16' },
          { name: 'processorDeflationBps', type: 'uint16' },
          { name: 'processorLpBps', type: 'uint16' },
          { name: 'processorDividendBps', type: 'uint16' },
          { name: 'minimumShareBalance', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'createBasememeTaxFactoryTokenAndBuy',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'tokenURI', type: 'string' },
          { name: 'nonce', type: 'uint256' },
          { name: 'signature', type: 'bytes' },
          { name: 'tokenSalt', type: 'bytes32' },
          { name: 'payoutRecipient', type: 'address' },
          { name: 'marketPayoutRecipient', type: 'address' },
          { name: 'marketVaultFactory', type: 'address' },
          { name: 'marketVaultData', type: 'bytes' },
          { name: 'collateralToken', type: 'address' },
          { name: 'targetRaise', type: 'uint256' },
          { name: 'lockBps', type: 'uint16' },
          { name: 'lockupDuration', type: 'uint64' },
          { name: 'vestingDuration', type: 'uint64' },
          { name: 'lockAdmin', type: 'address' },
          { name: 'taxRateBps', type: 'uint16' },
          { name: 'taxDuration', type: 'uint64' },
          { name: 'antiFarmerDuration', type: 'uint64' },
          { name: 'processorMarketBps', type: 'uint16' },
          { name: 'processorDeflationBps', type: 'uint16' },
          { name: 'processorLpBps', type: 'uint16' },
          { name: 'processorDividendBps', type: 'uint16' },
          { name: 'minimumShareBalance', type: 'uint256' },
        ],
      },
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'collateralAmountIn', type: 'uint256' },
          { name: 'tokenAmountMin', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: '', type: 'address' },
      { name: '', type: 'uint256' },
    ],
  },
  {
    name: 'createBasememeTaxFactoryTokenBasic',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'symbol', type: 'string' },
          { name: 'tokenURI', type: 'string' },
          { name: 'nonce', type: 'uint256' },
          { name: 'signature', type: 'bytes' },
          { name: 'tokenSalt', type: 'bytes32' },
          { name: 'payoutRecipient', type: 'address' },
          { name: 'collateralToken', type: 'address' },
        ],
      },
    ],
    outputs: [{ name: '', type: 'address' }],
  },

  // -- trade entry points (3-arg, no referrer · Source: index.js:513..542, 937..946) --
  // HOTFIX: tax factory does NOT accept a `tradeReferrer` param. Do not pass
  // a 4th arg here (PORT_AUDIT_CHECKLIST HOTFIX #6, "UX vs contract").
  {
    name: 'buyExactIn',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'minTokenOut', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'buyExactInWithCollateral',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'collateralAmountIn', type: 'uint256' },
      { name: 'minTokenOut', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'sellExactIn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'tokenAmountIn', type: 'uint256' },
      { name: 'minCollateralOut', type: 'uint256' },
    ],
    outputs: [],
  },

  // -- view routing (Source: index.js:780..815, 1180..1220) --
  {
    name: 'tokenToBondingCurve',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'factoryTradeHelper',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'multiDexRouter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'collateralEnabled',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'contractVersion',
    type: 'function',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'getDynamicCreateCollateralConfig',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'defaultTargetRaise', type: 'uint256' },
          { name: 'initialTokenSupply', type: 'uint256' },
          { name: 'firstBuyFee', type: 'uint256' },
          { name: 'tradeFeeBps', type: 'uint16' },
          { name: 'migrationFeeBps', type: 'uint16' },
          { name: 'defaultSellBps', type: 'uint16' },
          { name: 'minBuyBackQuote', type: 'uint256' },
        ],
      },
    ],
  },

  // -- BurnDividend vault burn entry (Source: index.js, search burnTokenFromVault) --
  // Note: CI-09 plan says approve spender = Tax Factory (NOT the vault address)
  // — M3 architecture has factory.burnTokenFromVault delegate the DEAD transfer.
  {
    name: 'burnTokenFromVault',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'user', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
];

/* ============================================================
 * 2) basememeTaxFactoryTradeHelperABI
 *    Trade estimation / quoting helper (tax-aware, 3-arg).
 *    Source: index.js:1685..2085 (~400 entries)
 * ============================================================ */
export const basememeTaxFactoryTradeHelperABI = [
  {
    name: 'buyWithEth',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'funds', type: 'uint256' },
      { name: 'minTokenOut', type: 'uint256' },
    ],
    outputs: [
      { name: 'tokenOut', type: 'uint256' },
      { name: 'refundOut', type: 'uint256' },
    ],
  },
  {
    name: 'sellForEth',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'tokenAmountIn', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
    ],
    outputs: [{ name: 'ethOut', type: 'uint256' }],
  },
  {
    name: 'dexBuyWithEth',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'funds', type: 'uint256' },
      { name: 'minTokenOut', type: 'uint256' },
    ],
    outputs: [{ name: 'tokenOut', type: 'uint256' }],
  },
  {
    name: 'dexSellForEth',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'tokenAmountIn', type: 'uint256' },
      { name: 'minEthOut', type: 'uint256' },
    ],
    outputs: [{ name: 'ethOut', type: 'uint256' }],
  },
  {
    name: 'quoteEthToCollateralForToken',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'ethIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'collateralOut', type: 'uint256' },
    ],
  },
  {
    name: 'quoteCollateralToEthForToken',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'collateralIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'collateralToken', type: 'address' },
      { name: 'ethOut', type: 'uint256' },
    ],
  },
  {
    name: 'quoteDexExactInput',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [{ name: 'amountOutReceivedExpected', type: 'uint256' }],
  },
  {
    name: 'factory',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'tokenSwap',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
];

/* ============================================================
 * 3) basememeTaxTokenABI — per-token ERC20 + tax metadata
 *    Source: index.js:2093..2659
 * ============================================================ */
export const basememeTaxTokenABI = [
  // standard ERC20 surface
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },

  // tax metadata surface
  { name: 'contractVersion', type: 'function', stateMutability: 'pure', inputs: [], outputs: [{ name: '', type: 'string' }] },
  { name: 'taxRate', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] },
  { name: 'taxDuration', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint64' }] },
  { name: 'taxExpirationTime', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'antiFarmerDuration', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint64' }] },
  { name: 'antiFarmerExpirationTime', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'liquidationThreshold', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'mainPool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'taxProcessor', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'dividendContract', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'factory', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'state', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
];

/* ============================================================
 * 4) taxProcessorABI — per-token processor that routes tax flow
 *    (market / deflation / lp / dividend buckets).
 *    Source: index.js:7220..7799
 * ============================================================ */
export const taxProcessorABI = [
  { name: 'taxToken', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'quoteToken', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'dividendAddress', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'marketAddress', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
  { name: 'feeReceiver', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },

  { name: 'marketBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] },
  { name: 'deflationBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] },
  { name: 'lpBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] },
  { name: 'dividendBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] },
  { name: 'feeRateCurve', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] },
  { name: 'feeRateDex', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] },

  { name: 'minBuyBackQuote', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'lpQuoteBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'marketQuoteBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'dividendQuoteBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'feeQuoteBalance', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalQuoteAddedToLiquidity', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalTokenAddedToLiquidity', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalQuoteSentToMarketing', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalQuoteSentToDividend', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
];

/* ============================================================
 * 5) dividendABI — per-token dividend contract (USDC-denominated by default).
 *
 * IMPORTANT: This is a PER-TOKEN contract (callers resolve its address via
 * `token.dividendContract()` first, so no taxToken arg anywhere in the ABI).
 * All view functions take `(user)` or `()` — not `(taxToken, user)`.
 *
 * selector of interest: withdrawDividendsFor(address,bool) = 0x0b9e8349
 * Source: index.js:4678..5102
 * ============================================================ */
export const dividendABI = [
  // -- withdraw actions (Source: index.js:4863..4879) --
  {
    name: 'withdrawDividends',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [{ name: 'success', type: 'bool' }],
  },
  {
    name: 'withdrawDividendsFor',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'unwrapWETH', type: 'bool' },
    ],
    outputs: [{ name: 'success', type: 'bool' }],
  },

  // -- per-user views (Source: index.js:4690..4907) --
  {
    name: 'accumulativeDividendOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdrawableDividendOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdrawableDividends',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'withdrawnDividends',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'userInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'share', type: 'uint256' },
      { name: 'rewardDebt', type: 'uint256' },
      { name: 'pendingBalance', type: 'uint256' },
    ],
  },

  // -- global views (Source: index.js:4773..4835) --
  {
    name: 'totalDividendsDistributed',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalShares',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'minimumShareBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'dividendToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'taxToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'weth',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },

  // -- events (L2 Codex R1 🟡) --
  // Upstream dividend contract does NOT emit a "DividendWithdrawn" event on
  // successful claim — the two events below are the signal the CLI can
  // surface to the operator. Source: basememe-v4-tax-contracts-configs
  // index.js:5033..5051 (DividendWithdrawalFailed) and :4988..5031
  // (DividendRewardDebtChanged).
  {
    type: 'event',
    name: 'DividendRewardDebtChanged',
    inputs: [
      { name: 'taxToken', type: 'address', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'rewardDebt', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'DividendWithdrawalFailed',
    inputs: [
      { name: 'taxToken', type: 'address', indexed: true },
      { name: 'user', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
];

/* ============================================================
 * 6) Vault ABIs (Split / Snowball / BurnDividend / Gift)
 *    Minimal read + action surface for `vault-info` / `vault-send`
 *    / `vault-burn` / `gift-proof-submit` CLI commands (Phase 5).
 * ============================================================ */

// splitVaultABI — per-vault, allocates tax to configurable recipients.
// Source: index.js:6876..7061
export const splitVaultABI = [
  {
    name: 'taxToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'vaultFactory',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'description',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'TOTAL_BPS',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'recipients',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'recipient', type: 'address' },
      { name: 'bps', type: 'uint16' },
    ],
  },
  {
    name: 'getRecipientsInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: 'info',
        type: 'tuple[]',
        components: [
          { name: 'recipient', type: 'address' },
          { name: 'bps', type: 'uint16' },
          { name: 'accumulated', type: 'uint256' },
          { name: 'claimed', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'userBalances',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'accumulated', type: 'uint128' },
      { name: 'claimed', type: 'uint128' },
    ],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [],
  },
  {
    name: 'dispatch',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
];

// snowBallVaultABI — per-vault, quote-token accumulator w/ DEAD burn tracking.
// Source: index.js:6265..6615
// NOTE: CLI `vault-info` for Snowball must read this ABI's vaultStats()
// directly via RPC — backend does not index the BasememeSnowBallExecuted
// event yet (PORT_AUDIT_CHECKLIST HOTFIX #5 equivalent, bfun-gap).
export const snowBallVaultABI = [
  {
    name: 'token',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'quoteToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'factory',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'description',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'vaultStats',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      // Field name aligned with frontend `tax-dialog/vault-detail/index.tsx:81`.
      // Output is positional so wire decode is unaffected — this is a
      // display-level rename for operator sanity (CLI emits field names).
      { name: 'totalBuybackQuote', type: 'uint256' },
      { name: 'totalTokensBurned', type: 'uint256' },
    ],
  },
  {
    name: 'snowball',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'quoteAmt', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
    ],
    outputs: [],
  },
];

// burnDividendVaultABI — per-vault, accumulates quote for buyback & burn.
// Source: index.js:3808..4371
// NOTE: `burn` action: approve spender = Tax Factory (not vault address).
// BUYBACK_THRESHOLD defaults to 0.025 ETH (Base-main tuning).
export const burnDividendVaultABI = [
  {
    name: 'token',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'quoteToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'factory',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'BUYBACK_THRESHOLD',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'isDividendMode',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'rewardBalance',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalBurned',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalBuybackQuote',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalBuybackTokensBurned',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'totalRewardDistributed',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'buybackCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'pendingReward',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    // userInfo(address) → (burnedAmount, rewardDebt)
    // Phase 5 L0 gap fix · frontend uses this at `vault-detail/index.tsx:497-509`.
    name: 'userInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'burnedAmount', type: 'uint256' },
      { name: 'rewardDebt', type: 'uint256' },
    ],
  },
  {
    // User-facing burn — sends `amount` tax tokens from caller to DEAD
    // (via factory's transferFrom, hence approve spender = factory per CI-09).
    // Phase 5 L0 gap fix · frontend: `vault-detail/index.tsx:578-587`.
    name: 'burn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'buyback',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'quoteAmt', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'claimReward',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claimRewardTo',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }],
    outputs: [],
  },
];

// giftVaultFactoryABI — factory-level entry for gift vaults.
// The proof-submit path (X verification) goes through the factory, not
// the vault directly. See PORT_AUDIT_CHECKLIST NT-TR-02 ("gift proof").
// Source: index.js:5600..6000
//
// Upstream XProof tuple (struct GiftVaultFactory.XProof):
//   { targetAddress address, taxToken address, xHandle string,
//     XId uint128, tweetId uint128 }
// All proof-taking functions take the tuple AND a separate `bytes signature`
// param (see index.js:5716..5731 for verifyXProof definition).
const X_PROOF_TUPLE = {
  name: 'proof',
  type: 'tuple',
  components: [
    { name: 'targetAddress', type: 'address' },
    { name: 'taxToken', type: 'address' },
    { name: 'xHandle', type: 'string' },
    { name: 'XId', type: 'uint128' },
    { name: 'tweetId', type: 'uint128' },
  ],
};

export const giftVaultFactoryABI = [
  {
    name: 'newVault',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'taxToken', type: 'address' },
      { name: 'quoteToken', type: 'address' },
      { name: '', type: 'address' },
      { name: 'vaultData', type: 'bytes' },
    ],
    outputs: [{ name: 'vault', type: 'address' }],
  },
  {
    name: 'taxTokenToVault',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'isVault',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'canManageVault',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'taxToken', type: 'address' },
      { name: '_xHandle', type: 'string' },
      { name: 'tweetId', type: 'uint128' },
    ],
    outputs: [
      { name: 'canManage', type: 'bool' },
      { name: 'errorMessage', type: 'string' },
    ],
  },
  {
    name: 'verifyXProof',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      X_PROOF_TUPLE,
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    // Source: index.js:5711..5731 — 3-arg, leading taxToken is NOT
    // redundant with proof.taxToken (factory scopes the call to a vault
    // by token before verifying the proof).
    name: 'manageByProof',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'taxToken', type: 'address' },
      X_PROOF_TUPLE,
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'xOracleKeyAddress',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
];

/* ============================================================
 * 7) Uniswap V2 Router ABI — DEX-graduated tax tokens swap here.
 *    HOTFIX #3: MUST include the three fee-on-transfer variants;
 *    viem will throw "Function … not found on ABI" otherwise.
 *    Source: frontend-basememe src/contract/abi.ts:75..244
 *    (UNISWAP_V2_ROUTER_ABI — shipped on `basememe-tax` branch)
 * ============================================================ */
export const uniswapV2RouterABI = [
  {
    name: 'WETH',
    type: 'function',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'factory',
    type: 'function',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getAmountsIn',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'getAmountsOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },

  // ---- Fee-on-transfer variants (HOTFIX #3: use these for tax tokens) ----
  {
    name: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
];

/* ============================================================
 * 8) Tax-factory deployed addresses (per-chain).
 *
 * mainnet (8453): PLACEHOLDERS — will be filled in before first tax
 * release on `main` branch (see BASEMEME_AI_TAX_PLAN.md design #6).
 *
 * testnet (84532): from basememe-v4-tax-contracts-configs index.js
 * (verified 2026-04-23).
 * ============================================================ */
export const taxAddresses = {
  8453: {
    // Mainnet tax deployment (Base 8453). Source of truth:
    //   contracts-basememe-tax/addresses/8453.json
    //   contracts-basememe-tax/chainConfigs/8453.json (VAULT_KEEPER)
    // Reuse policy per TAX_TOKEN_MIGRATION_PLAN.md §1.6:
    //   - basememeTaxTokenSwap REUSES V4 basememeTokenSwap
    //   - basememeLockVault REUSES V4 BasememeLockVault
    //   - (ProtocolRewards / AgentVerifier likewise reuse on the contract
    //     side · CLI doesn't reference them so they aren't surfaced here)
    // All addresses verified on-chain 2026-04-26 (each has bytecode;
    // VAULT_KEEPER is a multisig EOA so EMPTY-code is expected).
    basememeTaxFactory: '0xc5fdff6b45A3A5cEF7E72Edf98EC1b0Bc6f388Dd',         // FACTORY_PROXY
    basememeTaxFactoryImpl: '0xf65D825B847fC7945836748Ac44778ec0Df65457',     // FACTORY_IMPL
    basememeTaxFactoryTradeHelper: '0x9A76e6e63DDfCf81f3B0eA5465fEE2c4267cbD2b', // FACTORY_TRADE_HELPER_PROXY
    basememeTaxTokenSwap: '0x2c8E47a09196505Dbc96229510A4B9ff91a8534b',       // TOKEN_SWAP_PROXY (= V4 basememeTokenSwap, reused per plan §1.6)
    basememeMultiDexRouter: '0x0a17BA18E8Dee6D9a3063B7b79DF295BE3985dec',     // MULTI_DEX_ROUTER
    taxProcessor: '0xdFbf27Fe18b213938eBf4DC613d51152C6490754',               // TAX_PROCESSOR_IMPL
    dividend: '0xADd3C7394EF15B929856C8A629d6675269ECE850',                   // DIVIDEND_IMPL
    splitVaultFactory: '0x7a74745b49a8401fAe853aa06c2371273161F719',          // SPLIT_VAULT_FACTORY
    splitVault: '0xeF5dbEfD7b9d943b058F2115E511A6Dcae28bf3a',                 // SPLIT_VAULT_IMPL
    snowBallVaultFactory: '0x67DD5585bb8d5DC81bccEd0dC3f5E39E43c6ad1B',       // SNOWBALL_VAULT_FACTORY
    snowBallVault: '0x65724Ef035D6AB02E33D0c53f5E87e53b2fEbBA2',              // SNOWBALL_VAULT_IMPL
    burnDividendVaultFactory: '0x4CDf43ba52A76fD3Cf2b241955D25B2Ca00979C1',   // BURN_DIVIDEND_VAULT_FACTORY
    burnDividendVault: '0xefE1a7289ac38d3865e2F0615A47f7c4e73254E3',          // BURN_DIVIDEND_VAULT_IMPL
    giftVaultFactory: '0xC2D72baD33aE74Ff7A53cB8DA06B64cBA4cc00B6',           // GIFT_VAULT_FACTORY
    giftVault: '0xb829B3975F927B213b092fFbc499b9FB65F0b701',                  // GIFT_VAULT_IMPL
    basememeLockVault: '0x856ED1d2A2401927A4653cd2399cF16eBB1C6fBC',          // LOCK_VAULT (REUSED V4 per plan §1.6)
    basememeTaxToken: '0x5F5Fa2c25448a8a047FEDB872a10502A85d87D21',           // BASEMEME_TAX_IMPL
    basememeTaxFactoryToken: '0xe9E7a1e6ac04ac53511642297818CcaDea9eE143',    // BASEMEME_IMPL
    bondingCurve: '0x5165f54f015E9BD0be61508411c26eAC61f53E96',               // BONDING_CURVE_IMPL
    vaultKeeper: '0x80eee0ff145bd4e65b6fe501b7239253d70fe753',                // VAULT_KEEPER (chainConfigs/8453 · multisig EOA)
  },
  84532: {
    // Source: index.js:440
    basememeTaxFactory: '0x30F95BE0F94cD2D89c7b21C43197B56359e9C134',
    // Source: index.js:1306
    basememeTaxFactoryImpl: '0xb1CEBb1b2DA8296a1B7D2f45e878a7E011F9ebd7',
    // Source: index.js:2086
    basememeTaxFactoryTradeHelper: '0xA6B0db951E64587EE5202090c527C74c34D7523f',
    // Source: index.js:3107
    basememeTaxTokenSwap: '0x1a57Dc1597159819eBE52E6ad93da9A7f1Ea8b37',
    // Source: index.js:398
    basememeMultiDexRouter: '0x3F261F2971BF38C38c5fd755ec3eC746BaA5369b',
    // Source: index.js:7799
    taxProcessor: '0x1966044b58DC81762F7b8C554941BD18406a016d',
    // Source: index.js:5103
    dividend: '0x6621aa3745E45E3d040a0F69030072B744a38E4e',
    // Source: index.js:7213
    splitVaultFactory: '0x78D408e1654B6b385ACbcCDa55812845B947B1b7',
    // Source: index.js:7062
    splitVault: '0x6aE7ce1495275816945497C2B547F71177dCBF4f',
    // Source: index.js:6869
    snowBallVaultFactory: '0x81FA72335957BF5d54FF5CC10B0B57153188bd39',
    // Source: index.js:6616
    snowBallVault: '0x622f664dE0ae126733779a017232B7036C830C32',
    // Source: index.js:4671
    burnDividendVaultFactory: '0x8ab97BBBdcb4AB96b139C3f67273549aeA193C43',
    // Source: index.js:4372
    burnDividendVault: '0xf0FF6302576A0aB04699127c928f85AF5028a2c7',
    // Source: index.js:6001
    giftVaultFactory: '0x089280E33CE9ECF940cc4Ad87b041a3b02639c9e',
    // Source: index.js:5593
    giftVault: '0xf088c88547b116A0fF54dE0885Ad8c46063B5f9f',
    // Source: index.js:317
    basememeLockVault: '0x821A6750Fdc2581eE17e5271dE3421199e774Fe5',
    // Source: index.js:2660
    basememeTaxToken: '0xA2A2CF2D765c8884aB5d4454610B2f9950c3444B',
    // Source: index.js:1678
    basememeTaxFactoryToken: '0x4610C06fcbAa2eec4b07f0C6f54f005CE7bdb190',
    // Source: index.js:3801
    bondingCurve: '0x8BecC55Ad74bbCf69F563411C2f9b346d9421C2D',
    // Source: index.js:8136 (chain 84532 "VAULT_KEEPER")
    // Used as `marketVaultData` payload for snowball / burnDividend modes
    // (frontend onemorething/index.tsx:430-441).
    vaultKeeper: '0x57cf387c585e73F2F6E74A91d1ed05862EAB539f',
  },
};

export function getTaxAddressesForChain(chainId) {
  const config = taxAddresses[chainId];
  if (!config) {
    throw new Error(`Unsupported chain ID for tax contracts: ${chainId}`);
  }
  return config;
}

export default {
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
