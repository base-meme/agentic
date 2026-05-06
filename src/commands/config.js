import { getConfig } from '../lib/chain.js';
import { getAddresses } from '../lib/contracts.js';

export async function configCommand() {
  const config = getConfig();
  const addrs = getAddresses();
  return {
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    apiUrl: config.apiUrl,
    contracts: addrs,
  };
}
