// Pure helpers for `basememe vault-*` commands.
//
// Resolves the per-token vault metadata stored in
// `coin.extra_data.tax_market_vault_data` (Source:
// frontend-basememe/src/components/home/types.ts:171-194).
//
// vault_type values: 'split' | 'snowball' | 'burn_dividend' | 'gift'

import { getAddress, isAddress } from 'viem';

const KNOWN_VAULT_TYPES = new Set([
  'split',
  'snowball',
  'burn_dividend',
  'gift',
]);

function safeJsonParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readExtraData(coin) {
  if (!coin) return null;
  const raw = coin.extra_data ?? coin.extraData;
  return safeJsonParse(raw);
}

/**
 * Resolve the vault metadata object (vault address, factory, type, gift
 * fields) from a coin record. Throws when the coin is a tax token that
 * doesn't use the vault system (evm-recipient mode).
 */
export function resolveVaultData(coin) {
  const extra = readExtraData(coin);
  const data = extra?.tax_market_vault_data;
  if (!data || typeof data !== 'object') {
    throw new Error(
      'Token has no vault (tax_market_vault_data missing) — this token pays tax to a fixed recipient, not a vault',
    );
  }
  if (!data.vault || !isAddress(data.vault)) {
    throw new Error(`Invalid vault address in tax_market_vault_data: ${data.vault}`);
  }
  if (!data.vaultFactory || !isAddress(data.vaultFactory)) {
    throw new Error(
      `Invalid vaultFactory address in tax_market_vault_data: ${data.vaultFactory}`,
    );
  }
  const rawType = data.vault_type;
  if (!rawType || !KNOWN_VAULT_TYPES.has(rawType)) {
    throw new Error(
      `Unknown vault type: ${rawType || 'missing'} (expected split | snowball | burn_dividend | gift)`,
    );
  }
  return {
    vaultAddress: getAddress(data.vault),
    vaultFactory: getAddress(data.vaultFactory),
    vaultType: rawType,
    raw: data,
  };
}

/**
 * True if the coin record carries a vault (tax_market_vault_data present).
 * Safe to call on V4 / V3 coins — returns false rather than throwing.
 */
export function hasVault(coin) {
  try {
    const extra = readExtraData(coin);
    return !!extra?.tax_market_vault_data;
  } catch {
    return false;
  }
}
