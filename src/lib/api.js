import axios from 'axios';
import { getApiUrl, getChainId } from './chain.js';
import { extractBackendMsg } from './gift-proof-helpers.js';

const DEFAULT_TIMEOUT = 30000;

function createAxiosInstance(baseURL) {
  return axios.create({
    baseURL,
    timeout: DEFAULT_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

let api = null;
let currentApiUrl = null;

function getApiClient() {
  const apiUrl = getApiUrl();
  if (!api || currentApiUrl !== apiUrl) {
    api = createAxiosInstance(apiUrl);
    currentApiUrl = apiUrl;
  }
  return api;
}

// Re-create instance if API URL changes
export function resetApi() {
  api = null;
  currentApiUrl = null;
}

export async function get(endpoint, params = {}) {
  const chainId = getChainId();
  const queryParams = { ...params, chain_id: chainId };

  const response = await getApiClient().get(endpoint, { params: queryParams });
  return response.data;
}

export async function post(endpoint, data = {}) {
  const chainId = getChainId();
  const body = { ...data, chain_id: chainId };

  const response = await getApiClient().post(endpoint, body);
  return response.data;
}

// Token list API
export async function getTokenList(options = {}) {
  const { sort = 'block_create_time', kw = '', offset = 0, limit = 30 } = options;
  return get('/coin/list', { sort, kw, offset, limit });
}

// Token info API
export async function getTokenInfo(contractAddress) {
  return get('/coin/info', { contract_address: contractAddress });
}

// Token trade data API
export async function getTokenTradeData(contractAddresses) {
  const addressList = Array.isArray(contractAddresses)
    ? contractAddresses.join(',')
    : contractAddresses;
  return post('/coin/get_coin_trade_data', {
    contract_address_list: addressList,
  });
}

// Tax info API. Backend `/coin/tax_info` handler (see
// server-basememe/web_api/route/coin.py:1745) requires `chain_id` +
// `contract_address`. Frontend `tax-dialog/index.tsx:334` uses the same
// param shape — previous `{coin_id}` shape 400'd silently.
export async function getTaxInfo(tokenAddress, chainId, userAddress) {
  const params = {
    chain_id: chainId,
    contract_address: tokenAddress,
  };
  if (userAddress) params.user_address = userAddress;
  return get('/coin/tax_info', params);
}

// Gift Vault proof submit — POST /gift_vault/submit_proof.
// Requires `Authorization: Bearer <token>` (backend maps token → user).
// Rate-limited server-side (user 5/60s + IP 20/60s + global 300/60s);
// limits come back as business-code `{code: 1, msg: "rate limit..."}`
// NOT HTTP 429, so the caller treats `code !== 0` as failure uniformly.
// L2🟡 R1-A3: HTTP-level failures (401/403/429 etc.) land here as
// AxiosError whose `.message` is "Request failed with status code N".
// Unwrap the backend's `{code, msg}` body via `extractBackendMsg` so the
// operator sees the actual reason, and preserve the original via
// Error `cause` for debugging.
export async function submitGiftProof({
  vaultAddress,
  tweetId,
  authToken,
}) {
  // L3 #5 polish: body mirrors frontend `gift-proof-dialog:176-180` — just
  // `{chain_id, vault_address, tweet_id}`. Server `/gift_vault/submit_proof`
  // (server-basememe/web_api/route/gift_vault.py:99-105) never reads a
  // `contract_address`; the previous CLI payload included one which the
  // backend silently dropped. Dropped for wire-compat cleanliness.
  const chainId = getChainId();
  try {
    const response = await getApiClient().post(
      '/gift_vault/submit_proof',
      {
        chain_id: chainId,
        vault_address: vaultAddress,
        tweet_id: tweetId,
      },
      {
        headers: { Authorization: `Bearer ${authToken}` },
      },
    );
    return response.data;
  } catch (error) {
    throw new Error(extractBackendMsg(error), { cause: error });
  }
}

// Gift Vault proof status — GET /gift_vault/proof_status.
// Read-only; the frontend polls every 15s. No auth required for status
// reads (the frontend doesn't send a bearer on this endpoint either).
// Same `{code, msg}` unwrap as submitGiftProof — matters for poll-loops
// that otherwise drop the backend's rate-limit wording on the floor.
export async function getGiftProofStatus({ vaultAddress, tweetId }) {
  try {
    return await get('/gift_vault/proof_status', {
      vault_address: vaultAddress,
      tweet_id: tweetId,
    });
  } catch (error) {
    throw new Error(extractBackendMsg(error), { cause: error });
  }
}

// Gift Vault info — GET /gift_vault/info.
// Read-only snapshot of a gift vault: returns `{proofs: [...], ...}`
// where each proof has `{tweet_id, target_address, x_handle?}`. Frontend
// `vault-detail/index.tsx:936` uses this to render the proof history
// table; vault-info CLI merges it into the gift stats so operators can
// see the list of individual proofs (not just a count). `chain_id` is
// auto-injected by `get()`.
export async function getGiftVaultInfo({ vaultAddress }) {
  return get('/gift_vault/info', { vault_address: vaultAddress });
}

// Rankings API (same as token list with different sort)
export async function getRankings(orderBy, limit = 30) {
  return get('/coin/list', { sort: orderBy, offset: 0, limit });
}

export default getApiClient;
