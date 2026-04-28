import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { nonceManager } from 'viem/nonce';
import { getChain, getConfig } from './chain.js';

let cachedAccount = null;
let cachedWalletClient = null;

function getPrivateKey() {
  const value = process.env.PRIVATE_KEY;
  if (!value) {
    throw new Error('PRIVATE_KEY environment variable is required for this command.');
  }
  const key = value.startsWith('0x') ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('PRIVATE_KEY must be a 64-character hex string (with or without 0x prefix).');
  }
  return key;
}

export function getAccount() {
  if (!cachedAccount) {
    cachedAccount = privateKeyToAccount(getPrivateKey(), { nonceManager });
  }
  return cachedAccount;
}

export function getWalletClient() {
  if (!cachedWalletClient) {
    const config = getConfig();
    cachedWalletClient = createWalletClient({
      account: getAccount(),
      chain: getChain(),
      transport: http(config.rpcUrl),
    });
  }
  return cachedWalletClient;
}

export function resetWalletClient() {
  if (cachedAccount) {
    nonceManager.reset({
      address: cachedAccount.address,
      chainId: getChain().id,
    });
  }
  cachedAccount = null;
  cachedWalletClient = null;
}
