import { getPublicClient, getConfig } from '../lib/chain.js';
import { getAddresses, basememeFactoryABI } from '../lib/contracts.js';
import { get } from '../lib/api.js';

export async function verifyCommand() {
  const config = getConfig();
  const addrs = getAddresses();
  const checks = {};

  // 1. RPC connectivity
  try {
    const client = getPublicClient();
    const blockNumber = await client.getBlockNumber();
    checks.rpc = { status: 'pass', blockNumber: Number(blockNumber) };
  } catch (e) {
    checks.rpc = { status: 'fail', error: e.message };
  }

  // 2. API connectivity
  try {
    const res = await get('/coin/list', { sort: 'now_trending', offset: 0, limit: 1 });
    checks.api = { status: res.code === 0 ? 'pass' : 'fail', response: res.code };
  } catch (e) {
    checks.api = { status: 'fail', error: e.message };
  }

  // 3. Contract check
  try {
    const client = getPublicClient();
    // Try reading a zero-address mapping — should return 0x0 without error
    await client.readContract({
      address: addrs.basememeFactory,
      abi: basememeFactoryABI,
      functionName: 'tokenToBondingCurve',
      args: ['0x0000000000000000000000000000000000000001'],
    });
    checks.contract = { status: 'pass', factory: addrs.basememeFactory };
  } catch (e) {
    checks.contract = { status: 'fail', error: e.message };
  }

  // 4. Wallet (optional)
  if (process.env.PRIVATE_KEY) {
    try {
      const { privateKeyToAccount } = await import('viem/accounts');
      const key = process.env.PRIVATE_KEY.startsWith('0x') ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`;
      const account = privateKeyToAccount(key);
      const client = getPublicClient();
      const balance = await client.getBalance({ address: account.address });
      const { formatEther } = await import('viem');
      checks.wallet = { status: 'pass', address: account.address, balanceETH: formatEther(balance) };
    } catch (e) {
      checks.wallet = { status: 'fail', error: e.message };
    }
  } else {
    checks.wallet = { status: 'skip', reason: 'PRIVATE_KEY not set' };
  }

  return { config: { chainId: config.chainId, apiUrl: config.apiUrl }, checks };
}
