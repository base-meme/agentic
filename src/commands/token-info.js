import { Command } from 'commander';
import { getPublicClient, getChainId } from '../lib/chain.js';
import { getTokenInfo } from '../lib/api.js';
import { getAddressesForTrade, basememeFactoryABI, bondingCurveABI, erc20ABI } from '../lib/contracts.js';
import { assertSupportedCoinVersion } from '../lib/version.js';

export function deriveTokenPhase({ tradingStopped, sendingToPairForbidden }) {
  if (!tradingStopped) return 'curve';
  if (sendingToPairForbidden === true) return 'graduated';
  return 'dex';
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
    return data.find((item) => item?.contract_address?.toLowerCase() === tokenAddress.toLowerCase()) || null;
  }
  if (data.contract_address?.toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error(`Token mismatch: requested ${tokenAddress}, got ${data.contract_address}`);
  }
  return data;
}

export async function tokenInfoCommand(tokenAddress) {
  const client = getPublicClient();
  const chainId = getChainId();

  const infoResponse = await getTokenInfo(tokenAddress);
  const token = selectTokenRecord(unwrapApiResponse(infoResponse), tokenAddress);
  if (!token) {
    throw new Error(`Token info not found for ${tokenAddress}`);
  }

  const extraData = safeJsonParse(token.extra_data);
  const coinVersion = token.coin_version || extraData?.coin_version;
  assertSupportedCoinVersion(coinVersion);
  const addrs = getAddressesForTrade(chainId, coinVersion);

  // Tax tokens (cv >= 11.2.0) get routed to taxAddresses[chainId] which
  // exposes the factory under `basememeTaxFactory`; V4 tokens use the
  // legacy `basememeFactory` key. The tax factory implements the same
  // `tokenToBondingCurve(address)` selector as V4 (HOTFIX #9 alignment),
  // so a single readContract call works for both — only the address key
  // differs. Without the fallback, tax tokens get `undefined → 0x0` →
  // viem reverts with "invalid opcode EOFCREATE".
  const factoryAddress = addrs.basememeTaxFactory || addrs.basememeFactory;
  const curveAddress = await client.readContract({
    address: factoryAddress,
    abi: basememeFactoryABI,
    functionName: 'tokenToBondingCurve',
    args: [tokenAddress],
  });

  if (!curveAddress || curveAddress === '0x0000000000000000000000000000000000000000') {
    throw new Error(`No BondingCurve found for token ${tokenAddress}`);
  }

  const multicallResults = await client.multicall({
    contracts: [
      { address: tokenAddress, abi: erc20ABI, functionName: 'name' },
      { address: tokenAddress, abi: erc20ABI, functionName: 'symbol' },
      { address: tokenAddress, abi: erc20ABI, functionName: 'decimals' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'virtualCollateralReserves' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'virtualTokenReserves' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'feeBPS' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'firstBuyCompleted' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'firstBuyFee' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'tradingStopped' },
      { address: curveAddress, abi: bondingCurveABI, functionName: 'sendingToPairForbidden' },
    ],
  });
  const [
    name,
    symbol,
    decimals,
    collateralReserves,
    tokenReserves,
    feeBPS,
    firstBuyCompleted,
    firstBuyFee,
    tradingStopped,
    sendingToPairForbidden,
  ] = multicallResults.map((r) => {
    if (r.status === 'failure') throw r.error;
    return r.result;
  });

  const phase = deriveTokenPhase({ tradingStopped, sendingToPairForbidden });

  return {
    token: tokenAddress,
    coinVersion,
    bondingCurve: curveAddress,
    name,
    symbol,
    decimals,
    virtualCollateralReserves: collateralReserves.toString(),
    virtualTokenReserves: tokenReserves.toString(),
    feeBPS: Number(feeBPS),
    firstBuyCompleted,
    firstBuyFee: firstBuyFee.toString(),
    phase,
    isGraduated: phase !== 'curve',
    isMigrated: phase === 'dex',
  };
}

// Commander instance — lets test/e2e/helpers.js's `runCommander('tokenInfo', ...)`
// resolve a Command via runtime spread (mirrors buy/sell/etc convention). The
// product CLI in src/index.js still wires this via its own
// `program.command('token-info').action(...)` registration, so adding this
// instance does not double-register.
export const tokenInfo = new Command('tokenInfo')
  .description('On-chain token info (name, symbol, reserves, fees)')
  .argument('<tokenAddress>', 'Token contract address')
  .action(async (tokenAddress) => {
    try {
      const result = await tokenInfoCommand(tokenAddress);
      console.log(JSON.stringify({ success: true, data: result }, null, 2));
    } catch (err) {
      console.error(JSON.stringify({ success: false, error: err.message }));
      process.exit(1);
    }
  });
