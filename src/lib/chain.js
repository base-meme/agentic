import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const DEFAULT_RPC_URLS = {
  8453: 'https://mainnet.base.org',
};
const DEFAULT_API_URLS = {
  8453: 'https://api.base.meme/',
};
const DEFAULT_CHAIN_ID = 8453; // Base mainnet

const chainId = parseInt(process.env.BASEMEME_CHAIN_ID || String(DEFAULT_CHAIN_ID), 10);

let config = {
  rpcUrl: process.env.BASE_RPC_URL || DEFAULT_RPC_URLS[chainId] || DEFAULT_RPC_URLS[8453],
  chainId,
  apiUrl: DEFAULT_API_URLS[chainId] || DEFAULT_API_URLS[8453],
};

export function getConfig() {
  return { ...config };
}

export function setConfig(newConfig) {
  config = { ...config, ...newConfig };
  resetClient();
}

// Chain configuration map
const chains = {
  8453: base,
};

export function getChain() {
  const chain = chains[config.chainId];
  if (!chain) {
    throw new Error(`Unsupported chain ID: ${config.chainId}`);
  }
  return chain;
}

let publicClient = null;

export function getPublicClient() {
  if (!publicClient) {
    const chain = getChain();
    publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });
  }
  return publicClient;
}

export function getChainId() {
  return config.chainId;
}

export function getApiUrl() {
  return config.apiUrl;
}

// For testing - reset the client when config changes
export function resetClient() {
  publicClient = null;
}
