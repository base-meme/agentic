function parseVersion(version) {
  return String(version || '0.0.0')
    .split('.')
    .map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isNaN(value) ? 0 : value;
    });
}

export function isVersionGreaterOrEqual(version, targetVersion) {
  const current = parseVersion(version);
  const target = parseVersion(targetVersion);
  const length = Math.max(current.length, target.length);

  for (let index = 0; index < length; index += 1) {
    const lhs = current[index] || 0;
    const rhs = target[index] || 0;
    if (lhs > rhs) return true;
    if (lhs < rhs) return false;
  }

  return true;
}

export function shouldUseUniswapV2(coinVersion) {
  return isVersionGreaterOrEqual(coinVersion, '11.0.0');
}

export function shouldUseUniswapV3(coinVersion) {
  if (!coinVersion) return false;
  return !shouldUseUniswapV2(coinVersion) && !shouldUseUniswapV4(coinVersion);
}

export function shouldUseUniswapV4(coinVersion) {
  if (!coinVersion) return false;
  return coinVersion.split('.')[0] === '2';
}

export function compareVersion(v1, v2) {
  const a = parseVersion(v1);
  const b = parseVersion(v2);
  const length = Math.max(a.length, b.length);

  for (let index = 0; index < length; index += 1) {
    const lhs = a[index] || 0;
    const rhs = b[index] || 0;
    if (lhs > rhs) return 1;
    if (lhs < rhs) return -1;
  }

  return 0;
}

export function shouldUseDynamicBondingCurve(coinVersion) {
  return compareVersion(coinVersion, '2.1.0') >= 0 && compareVersion(coinVersion, '3.0.0') < 0;
}

// Tax Factory tokens graduate at coin_version >= 11.2.0 (V2 DEX + tax processor).
// Source: frontend-basememe src/utils/version.ts:59 (shouldUseTaxFactory).
// Note: shouldUseUniswapV2 (>= 11.0.0) is a superset; use this for any
// tax-specific routing (tax factory, vaults, dividend, gift proof).
export function shouldUseTaxFactory(coinVersion) {
  if (!coinVersion) return false;
  return isVersionGreaterOrEqual(coinVersion, '11.2.0');
}

export function assertSupportedCoinVersion(coinVersion) {
  if (!coinVersion) {
    throw new Error('Token metadata missing coin_version.');
  }
  if (!shouldUseUniswapV2(coinVersion) && !shouldUseUniswapV3(coinVersion) && !shouldUseUniswapV4(coinVersion)) {
    throw new Error(`Unsupported coin_version ${coinVersion}.`);
  }
}
