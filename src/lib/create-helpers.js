import { createHash } from 'crypto';
import {
  encodeAbiParameters,
  isAddress,
  isAddressEqual,
  parseUnits,
} from 'viem';
import { ZERO_ADDRESS, getCollateralTemplate } from './chain-configs.js';
import { taxAddresses } from './tax-abis.js';

export function parseDuration(value) {
  if (!value || value === '0') return 0n;
  const str = String(value).trim().toLowerCase();
  const num = Number.parseFloat(str);
  if (str.endsWith('y')) return BigInt(Math.floor(num * 365 * 86400));
  if (str.endsWith('m')) return BigInt(Math.floor(num * 30 * 86400));
  if (str.endsWith('d')) return BigInt(Math.floor(num * 86400));
  return BigInt(Math.floor(Number(str) * 86400));
}

export function md5Hex(address, txHash) {
  const value = ((address || '').slice(-6) + (txHash || '').slice(-6)).toLowerCase();
  return createHash('md5').update(value).digest('hex');
}

export function buildCreateParams(opts) {
  const {
    name,
    symbol,
    tokenUri,
    salt,
    account,
    chainId,
    pair = 'ETH',
    targetRaise,
    bondingCurvePct = 80,
    vestingPct = 0,
    vestingDuration,
    cliffDuration,
    vestingRecipient,
  } = opts;

  const template = getCollateralTemplate(chainId, pair);
  if (!salt) {
    throw new Error('Token salt is required.');
  }
  const bondPct = Number(bondingCurvePct);
  const vestPct = Number(vestingPct);
  const migrationPct = 20;

  if (bondPct + vestPct + migrationPct !== 100) {
    throw new Error(`bonding(${bondPct}) + vesting(${vestPct}) + migration(${migrationPct}) must = 100`);
  }

  let targetRaiseWei = 0n;
  if (targetRaise) {
    targetRaiseWei = parseUnits(String(targetRaise), template.DECIMALS);
    const defaultRaise = BigInt(template.TARGET_COLLECTION_AMOUNT);
    const minRaise = defaultRaise / 2n;
    const maxRaise = defaultRaise * 100n;
    if (targetRaiseWei < minRaise || targetRaiseWei > maxRaise) {
      throw new Error(`Target raise out of range. Min: ${minRaise}, Max: ${maxRaise}, Got: ${targetRaiseWei}`);
    }
  }

  const lockBps = vestPct * 100;
  const lockupDuration = parseDuration(cliffDuration);
  const vestingDurationValue = parseDuration(vestingDuration);
  const hasLock = lockBps > 0;
  const lockAdmin = hasLock ? (vestingRecipient || account) : ZERO_ADDRESS;
  const isDynamic = targetRaiseWei > 0n || hasLock;

  return {
    name,
    symbol,
    tokenURI: tokenUri,
    nonce: 0n,
    signature: '0x',
    platformReferrer: ZERO_ADDRESS,
    payoutRecipient: account,
    tokenSalt: salt,
    collateralToken: template.COLLATERAL_TOKEN,
    targetRaise: targetRaiseWei,
    lockBps,
    lockupDuration,
    vestingDuration: vestingDurationValue,
    lockAdmin,
    isDynamic,
    hasLock,
  };
}

export async function fetchSalt(apiUrl, factoryAddr, implAddr) {
  const baseUrl = apiUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/coin/address/salt?factory=${factoryAddr}&implementation=${implAddr}`;
  let resp;
  try {
    resp = await fetch(url);
  } catch (error) {
    throw new Error(`Salt fetch network error: ${error.message}`);
  }
  if (!resp.ok) {
    throw new Error(`Salt fetch HTTP ${resp.status}`);
  }
  const json = await resp.json();
  if (!json.data?.salt) {
    throw new Error(`Salt fetch returned no salt: ${JSON.stringify(json)}`);
  }
  return json.data.salt;
}

export async function submitTxId(apiUrl, chainId, txHash, userAddress) {
  const formData = new FormData();
  formData.append('chain_id', String(chainId));
  formData.append('tx_id', txHash);
  formData.append('tx_type', '1');
  formData.append('user_address', userAddress);
  formData.append('check_code', md5Hex(userAddress, txHash));

  const baseUrl = apiUrl.replace(/\/+$/, '');
  const resp = await fetch(`${baseUrl}/coin/submit_tx_id`, {
    method: 'POST',
    body: formData,
  });
  return resp.json();
}

/* ============================================================
 * Tax Factory (coin_version >= 11.2.0) create-flow helpers.
 *
 * Source of truth for the 24-field CreateParams struct and the four
 * marketVaultData encoders is
 *   frontend-basememe/src/components/common/dialogs/
 *     create-advanced-coin-dialog/onemorething/index.tsx
 * — see line references sprinkled through this block.
 *
 * PORT_AUDIT_CHECKLIST.md hotfixes covered here:
 *   #6 — tax CreateParams has no platformReferrer field.
 *   #7 — vault mode + non-ETH collateral: pre-error, never let the
 *        contract hit MarketVaultRequiresNativeCollateral revert.
 *   #8 — marketPayoutRecipient fallback to creator when both recipient
 *        and vault factory are zero (PR3-FIX history).
 *   #9 — 24-field struct exact order + types (Phase 1 ABI test guards
 *        the ABI side; buildTaxCreateParams returns the struct in the
 *        same order so encodeFunctionData stays stable).
 * ============================================================ */

// Source: create-advanced-coin-dialog/onemorething/index.tsx:111
// `taxDuration` — ~100 years; once set, tax is permanent for the token's
// active lifetime. Not a user-facing option (design decision #3).
export const TAX_DURATION_SECONDS = 3_153_600_000n;

// Source: create-advanced-coin-dialog/onemorething/index.tsx:112
// `antiFarmerDuration` — 3 days of reduced processor fees post-launch.
export const ANTI_FARMER_DURATION_SECONDS = 259_200n;

// Source: create/tax-settings/index.tsx:151 `taxRateOptions = [1, 2, 3, 5]`.
export const TAX_RATE_OPTIONS = Object.freeze([1, 2, 3, 5]);

// Source: create/tax-settings/index.tsx:148 `MIN_DIVIDEND_ELIGIBILITY = 10000`.
// Enforced only when `dividendAllocation > 0`.
export const MIN_DIVIDEND_ELIGIBILITY_TOKENS = 10_000n;

// Default eligibility when user omits the flag (1M whole tokens).
export const DEFAULT_DIVIDEND_ELIGIBILITY_TOKENS = 1_000_000n;

/**
 * Strip a leading `@` (or multiple) and trim whitespace from an X handle.
 * Exported separately so the regex guard in `validateTaxSettings` and the
 * encoder in `buildTaxCreateParams` share the same normalization step
 * (frontend onemorething/index.tsx:444-446).
 */
export function normalizeGiftXHandle(raw) {
  if (raw == null) return '';
  return String(raw).trim().replace(/^@+/, '').trim();
}

/**
 * Port of frontend-basememe/src/utils/tax/resolveMarketPayoutRecipient.ts.
 *
 * The tax contract rejects a zero recipient when no vault is configured
 * (`MarketPayoutRecipientMissing`), so when both are zero (e.g. user set
 * processorMarketBps = 0) we fall back to the creator. In that config the
 * recipient is an unused placeholder since no market-share tax is ever
 * dispatched. `isAddressEqual` is case-insensitive.
 */
export function resolveMarketPayoutRecipient({
  marketPayoutRecipient,
  marketVaultFactory,
  creator,
}) {
  if (!isAddressEqual(marketPayoutRecipient, ZERO_ADDRESS)) {
    return marketPayoutRecipient;
  }
  if (!isAddressEqual(marketVaultFactory, ZERO_ADDRESS)) {
    return ZERO_ADDRESS;
  }
  return creator;
}

/**
 * Encodes the `marketVaultData` bytes payload for one of the four tax
 * vault modes. Source for each branch:
 *   split     — onemorething/index.tsx:415-427
 *   snowball  — onemorething/index.tsx:429-434
 *   burn      — onemorething/index.tsx:435-441
 *   gift      — onemorething/index.tsx:452-460
 *
 * `evm` is not a vault mode — callers must not route `evm` here. We throw
 * so misuse fails fast instead of writing a semantically invalid payload.
 */
export function encodeMarketVaultData(mode, { splitRecipients, giftXHandle, vaultKeeperAddress } = {}) {
  switch (mode) {
    case 'split': {
      if (!Array.isArray(splitRecipients) || splitRecipients.length === 0) {
        throw new Error('encodeMarketVaultData: split requires non-empty splitRecipients.');
      }
      const recipients = splitRecipients.map((r) => {
        if (!r || !isAddress(r.recipient)) {
          throw new Error(`encodeMarketVaultData: invalid split recipient address: ${r?.recipient}`);
        }
        const bps = Number(r.bps);
        if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
          throw new Error(`encodeMarketVaultData: split bps out of range: ${r.bps}`);
        }
        return { recipient: r.recipient, bps };
      });
      // Defensive sum=10000 check — redundant with validateTaxSettings but
      // defense-in-depth since this encoder can be called standalone.
      // Matches frontend onemorething/index.tsx:409-414 throw pattern.
      const bpsSum = recipients.reduce((a, r) => a + r.bps, 0);
      if (bpsSum !== 10000) {
        throw new Error(
          `encodeMarketVaultData: split recipients bps must sum to 10000 (got ${bpsSum}).`,
        );
      }
      return encodeAbiParameters(
        [
          {
            type: 'tuple[]',
            name: 'recipients',
            components: [
              { name: 'recipient', type: 'address' },
              { name: 'bps', type: 'uint16' },
            ],
          },
        ],
        [recipients],
      );
    }
    case 'snowball':
    case 'burn': {
      if (!isAddress(vaultKeeperAddress)) {
        throw new Error(
          `encodeMarketVaultData: ${mode} requires a valid vaultKeeperAddress (got ${vaultKeeperAddress}).`,
        );
      }
      return encodeAbiParameters([{ type: 'address' }], [vaultKeeperAddress]);
    }
    case 'gift': {
      const xHandle = normalizeGiftXHandle(giftXHandle);
      if (!xHandle || !/^[A-Za-z0-9_]{1,15}$/.test(xHandle)) {
        throw new Error(
          'encodeMarketVaultData: gift requires xHandle matching /^[A-Za-z0-9_]{1,15}$/.',
        );
      }
      return encodeAbiParameters(
        [
          {
            type: 'tuple',
            components: [{ name: 'xHandle', type: 'string' }],
          },
        ],
        [{ xHandle }],
      );
    }
    case 'evm':
      throw new Error('encodeMarketVaultData: evm mode does not use marketVaultData — caller bug.');
    default:
      throw new Error(`encodeMarketVaultData: unknown market mode "${mode}".`);
  }
}

/**
 * Validates tax-specific create options. Returns `{ ok }` on success
 * or `{ ok: false, error }` with a user-facing message. Mirrors the
 * frontend's validateTaxSettings shape but widens it for CLI flags
 * (the frontend keeps its validation split across the dialog + schema).
 */
export function validateTaxSettings(options, { collateralToken }) {
  const {
    taxRate,
    fundsBps,
    burnBps,
    dividendBps,
    liquidityBps,
    dividendEligibilityTokens,
    marketMode,
    marketRecipient,
    splitRecipients,
    giftXHandle,
  } = options;

  if (!TAX_RATE_OPTIONS.includes(Number(taxRate))) {
    return {
      ok: false,
      error: `tax-rate must be one of ${TAX_RATE_OPTIONS.join(', ')} (got ${taxRate}).`,
    };
  }

  const bpsFields = [
    ['funds-bps', fundsBps],
    ['burn-bps', burnBps],
    ['dividend-bps', dividendBps],
    ['liquidity-bps', liquidityBps],
  ];
  for (const [label, val] of bpsFields) {
    if (!Number.isInteger(val) || val < 0 || val > 10000) {
      return {
        ok: false,
        error: `${label} must be a non-negative integer in [0, 10000] (got ${val}).`,
      };
    }
  }

  const bpsSum = fundsBps + burnBps + dividendBps + liquidityBps;
  if (bpsSum !== 10000) {
    return {
      ok: false,
      error: `Allocation bps must sum to exactly 10000 (100%). Got ${bpsSum}.`,
    };
  }

  if (dividendBps > 0) {
    const eligibility = Number(dividendEligibilityTokens ?? 0);
    if (!Number.isFinite(eligibility) || eligibility < Number(MIN_DIVIDEND_ELIGIBILITY_TOKENS)) {
      return {
        ok: false,
        error: 'Please set the minimum balance for dividend eligibility to at least 10,000 tokens.',
      };
    }
  }

  if (fundsBps > 0) {
    if (!marketMode) {
      return {
        ok: false,
        error:
          'funds-bps > 0 requires --market-mode (one of evm|split|snowball|burn|gift).',
      };
    }

    // HOTFIX #7: vault modes require ETH as collateral. The tax contract
    // hard-reverts with MarketVaultRequiresNativeCollateral otherwise.
    // Keep the literal string for grep parity with frontend.
    if (marketMode !== 'evm') {
      const isEth = isAddressEqual(collateralToken || ZERO_ADDRESS, ZERO_ADDRESS);
      if (!isEth) {
        return {
          ok: false,
          error:
            'Tax vault mode requires ETH as collateral. Please switch the payment token to ETH or disable the vault option.',
        };
      }
    }

    if (marketMode === 'evm') {
      if (!isAddress(marketRecipient || '')) {
        return {
          ok: false,
          error: 'Please enter a valid wallet address for funds recipient (--market-recipient).',
        };
      }
    } else if (marketMode === 'split') {
      if (!Array.isArray(splitRecipients) || splitRecipients.length === 0) {
        return {
          ok: false,
          error: 'market-mode=split requires --split-recipients with at least one recipient.',
        };
      }
      let splitSum = 0;
      for (const r of splitRecipients) {
        if (!r || !isAddress(r.address)) {
          return {
            ok: false,
            error: `Invalid split recipient address: ${r?.address}`,
          };
        }
        const bps = Number(r.bps);
        if (!Number.isInteger(bps) || bps < 0 || bps > 10000) {
          return {
            ok: false,
            error: `Split recipient bps out of range (0-10000): ${r.bps}`,
          };
        }
        splitSum += bps;
      }
      if (splitSum !== 10000) {
        return {
          ok: false,
          error: `Split vault recipients must sum to exactly 10000 (100%). Got ${splitSum}.`,
        };
      }
    } else if (marketMode === 'gift') {
      const handle = normalizeGiftXHandle(giftXHandle);
      if (!handle || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
        return {
          ok: false,
          error:
            'Invalid X handle. Please enter a valid handle (1-15 characters, letters/numbers/underscore only).',
        };
      }
    } else if (marketMode !== 'snowball' && marketMode !== 'burn') {
      return {
        ok: false,
        error: `Unknown --market-mode "${marketMode}" (expected evm|split|snowball|burn|gift).`,
      };
    }
  }

  return { ok: true };
}

/**
 * Returns true when the caller supplied any tax-specific flag that should
 * force routing through the tax factory. Presence of `--tax-rate` is the
 * trigger per design decision — if absent, the command stays on V4.
 */
export function isTaxCreateMode(options) {
  return options != null && options.taxRate != null;
}

function resolveVaultFactoryAddress(addrs, mode) {
  switch (mode) {
    case 'split':
      return addrs.splitVaultFactory;
    case 'snowball':
      return addrs.snowBallVaultFactory;
    case 'burn':
      return addrs.burnDividendVaultFactory;
    case 'gift':
      return addrs.giftVaultFactory;
    default:
      return ZERO_ADDRESS;
  }
}

/**
 * Builds the 24-field CreateParams tuple + routing metadata for the tax
 * factory. Field order matches the ABI in `src/lib/tax-abis.js`
 * (basememeTaxFactoryImplABI.createBasememeTaxFactoryToken) — do NOT
 * reorder without updating the Phase 1 ABI regression test.
 *
 * Source mapping for each field (onemorething/index.tsx:471-498):
 *   name / symbol / tokenURI / nonce / signature / tokenSalt
 *   payoutRecipient                 ← creator
 *   marketPayoutRecipient           ← resolveMarketPayoutRecipient()
 *   marketVaultFactory              ← taxAddresses[chainId].<mode>VaultFactory
 *   marketVaultData                 ← encodeMarketVaultData()
 *   collateralToken / targetRaise / lockBps / lockupDuration /
 *     vestingDuration / lockAdmin   ← mirrors V4 create (Phase 3 keeps
 *     lock/vest at 0 by default — same as onemorething:328-344)
 *   taxRateBps                      ← taxRate * 100
 *   taxDuration                     ← TAX_DURATION_SECONDS
 *   antiFarmerDuration              ← ANTI_FARMER_DURATION_SECONDS
 *   processor*Bps                   ← four allocation bps (sum == 10000)
 *   minimumShareBalance             ← parseUnits(eligibility, 18)
 */
export function buildTaxCreateParams(opts) {
  const {
    name,
    symbol,
    tokenUri,
    salt,
    account,
    chainId,
    pair = 'ETH',
    taxRate,
    fundsBps,
    burnBps,
    dividendBps,
    liquidityBps,
    dividendEligibilityTokens = DEFAULT_DIVIDEND_ELIGIBILITY_TOKENS,
    marketMode,
    marketRecipient,
    splitRecipients,
    giftXHandle,
    buyAmountWei = 0n,
    minTokenOut = 0n,
  } = opts;

  if (!salt) {
    throw new Error('Token salt is required.');
  }
  if (!TAX_RATE_OPTIONS.includes(Number(taxRate))) {
    throw new Error(`Invalid taxRate: ${taxRate} (expected one of ${TAX_RATE_OPTIONS.join(', ')}).`);
  }

  const template = getCollateralTemplate(chainId, pair);
  const addrs = taxAddresses[chainId];
  if (!addrs) {
    throw new Error(`Unsupported chain ID for tax contracts: ${chainId}`);
  }

  // Resolve market recipient / vault factory / vault data based on mode.
  let marketPayoutRecipient = ZERO_ADDRESS;
  let marketVaultFactory = ZERO_ADDRESS;
  let marketVaultData = '0x';

  const hasMarketShare = Number(fundsBps) > 0;
  if (hasMarketShare && marketMode) {
    if (marketMode === 'evm') {
      if (!isAddress(marketRecipient || '')) {
        throw new Error(`evm mode requires a valid --market-recipient (got ${marketRecipient}).`);
      }
      marketPayoutRecipient = marketRecipient;
    } else if (marketMode === 'split' || marketMode === 'snowball' || marketMode === 'burn' || marketMode === 'gift') {
      // snowball / burn depend on an address-typed vault-keeper payload.
      // Check that first (mainnet placeholder is null) before the factory
      // address check so the error message points at the real missing data.
      const encodeInput = {};
      if (marketMode === 'split') {
        encodeInput.splitRecipients = (splitRecipients || []).map((r) => ({
          recipient: r.address,
          bps: Number(r.bps),
        }));
      } else if (marketMode === 'snowball' || marketMode === 'burn') {
        if (!addrs.vaultKeeper) {
          throw new Error(
            `VAULT_KEEPER address not available on chain ${chainId} — cannot use ${marketMode} mode (mainnet placeholder).`,
          );
        }
        encodeInput.vaultKeeperAddress = addrs.vaultKeeper;
      } else if (marketMode === 'gift') {
        encodeInput.giftXHandle = giftXHandle;
      }

      marketVaultFactory = resolveVaultFactoryAddress(addrs, marketMode);
      if (!marketVaultFactory || marketVaultFactory === ZERO_ADDRESS) {
        throw new Error(`Vault factory address for mode "${marketMode}" not configured on chain ${chainId}.`);
      }

      marketVaultData = encodeMarketVaultData(marketMode, encodeInput);
    } else {
      throw new Error(`Unknown marketMode "${marketMode}".`);
    }
  }

  marketPayoutRecipient = resolveMarketPayoutRecipient({
    marketPayoutRecipient,
    marketVaultFactory,
    creator: account,
  });

  // Phase 3 does not introduce new lock/vesting logic — keep at 0.
  const collateralToken = template.COLLATERAL_TOKEN;
  const targetRaise = 0n;
  const lockBps = 0;
  const lockupDuration = 0n;
  const vestingDuration = 0n;
  const lockAdmin = ZERO_ADDRESS;

  const taxRateBps = Number(taxRate) * 100;
  const processorMarketBps = Number(fundsBps) || 0;
  const processorDeflationBps = Number(burnBps) || 0;
  const processorLpBps = Number(liquidityBps) || 0;
  const processorDividendBps = Number(dividendBps) || 0;
  const minimumShareBalance = parseUnits(
    String(dividendEligibilityTokens ?? DEFAULT_DIVIDEND_ELIGIBILITY_TOKENS),
    18,
  );

  // 24-field struct (order matches basememeTaxFactoryImplABI · HOTFIX #9).
  const createParamsStruct = {
    name,
    symbol,
    tokenURI: tokenUri,
    nonce: 0n,
    signature: '0x',
    tokenSalt: salt,
    payoutRecipient: account,
    marketPayoutRecipient,
    marketVaultFactory,
    marketVaultData,
    collateralToken,
    targetRaise,
    lockBps,
    lockupDuration,
    vestingDuration,
    lockAdmin,
    taxRateBps,
    taxDuration: TAX_DURATION_SECONDS,
    antiFarmerDuration: ANTI_FARMER_DURATION_SECONDS,
    processorMarketBps,
    processorDeflationBps,
    processorLpBps,
    processorDividendBps,
    minimumShareBalance,
  };

  const createArgs = [createParamsStruct];
  const isEthPair = isAddressEqual(collateralToken, ZERO_ADDRESS);
  const isBuying = buyAmountWei > 0n;

  let functionName;
  let buyArgs = null;
  let value = 0n;

  if (isBuying) {
    functionName = 'createBasememeTaxFactoryTokenAndBuy';
    buyArgs = [
      {
        collateralAmountIn: buyAmountWei,
        tokenAmountMin: minTokenOut,
      },
    ];
    value = isEthPair ? buyAmountWei : 0n;
  } else {
    // `createBasememeTaxFactoryTokenBasic` is reserved for minimal tax
    // tokens that skip the full CreateParams struct. Whenever the user
    // provides a 24-field struct we use the full entry.
    functionName = 'createBasememeTaxFactoryToken';
  }

  return {
    createArgs,
    buyArgs,
    functionName,
    value,
    collateralToken,
  };
}

/**
 * BigInt-safe JSON serializer for the tax create `--dry-run` view.
 *
 * Takes the `writeArgs` tuple (either `[createParams]` or
 * `[createParams, buyParams]`) from the output of `buildTaxCreateParams`
 * and returns a plain object with all 24 CreateParams fields plus the
 * optional 2-field BuyParams, with every BigInt stringified so the
 * whole thing round-trips through `JSON.stringify`.
 *
 * The dry-run path is safety-critical (no tx sent), so every displayed
 * field must reflect what would actually be submitted on-chain.
 */
export function decodeTaxArgsForDisplay(_built, writeArgs) {
  const jsonSafe = (obj) => {
    if (Array.isArray(obj)) return obj.map(jsonSafe);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[k] = jsonSafe(v);
      return out;
    }
    if (typeof obj === 'bigint') return obj.toString();
    return obj;
  };
  const params = jsonSafe(writeArgs[0]);
  const result = { createParams: params };
  if (writeArgs[1]) result.buy = jsonSafe(writeArgs[1]);
  return result;
}
