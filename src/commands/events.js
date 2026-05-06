import { createPublicClient, http } from 'viem';
import { getChain, getConfig } from '../lib/chain.js';
import { getAddresses, basememeFactoryEvents } from '../lib/contracts.js';

const DEFAULT_CHUNK = 1000n;
const MIN_CHUNK = 50n;
const DEFAULT_LOOKBACK = 10000n;

const LOGS_RPC = {
  8453: 'https://mainnet.base.org',
};

function getLogsClient() {
  const { chainId, rpcUrl } = getConfig();
  const rpc = LOGS_RPC[chainId] || rpcUrl;
  const chain = getChain();
  return createPublicClient({ chain, transport: http(rpc) });
}

export async function eventsCommand(fromBlock, options) {
  const client = getLogsClient();
  const addrs = getAddresses();
  const latestBlock = await client.getBlockNumber();
  const from = fromBlock ? BigInt(fromBlock) : latestBlock - DEFAULT_LOOKBACK;
  const to = options.toBlock ? BigInt(options.toBlock) : latestBlock;

  const chunk = options.chunk ? BigInt(options.chunk) : DEFAULT_CHUNK;
  const allLogs = [];

  let chunkSize = chunk;
  for (let start = from; start <= to; ) {
    const end = start + chunkSize - 1n > to ? to : start + chunkSize - 1n;
    try {
      const logs = await client.getLogs({
        address: addrs.basememeFactory,
        events: basememeFactoryEvents,
        fromBlock: start,
        toBlock: end,
      });
      allLogs.push(...logs);
      start = end + 1n;
      // Restore chunk size on success
      chunkSize = chunk;
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('limit exceeded') && chunkSize > MIN_CHUNK) {
        // Halve chunk and retry same start
        chunkSize = chunkSize / 2n;
        continue;
      }
      if (msg.includes('pruned') || msg.includes('limit exceeded')) {
        allLogs.push({ _skipped: true, fromBlock: Number(start), toBlock: Number(end), reason: msg.split('\n')[0] });
        start = end + 1n;
        continue;
      }
      throw e;
    }
  }

  return allLogs.map((log) => {
    if (log._skipped) return log;
    return {
      eventName: log.eventName,
      blockNumber: Number(log.blockNumber),
      transactionHash: log.transactionHash,
      args: Object.fromEntries(
        Object.entries(log.args || {}).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])
      ),
    };
  });
}
