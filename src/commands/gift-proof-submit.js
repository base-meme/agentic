// `basememe gift-proof-submit <tokenAddress> <tweetUrl> [--token <bearer>]
//                             [--poll-interval <sec>] [--timeout <sec>] [--skip-poll]`
//
// Submits a gift vault ownership proof tweet to the backend for server-side
// verification, then (default) polls `/gift_vault/proof_status` until
// status=confirmed/failed or `--timeout` expires.
//
// Auth: bearer token (from `--token` or `BASEMEME_AUTH_TOKEN` env). There
// is no login flow in Phase 5 — operator obtains the token out-of-band.

import { Command } from 'commander';

import { getChainId } from '../lib/chain.js';
import { getTokenInfo, submitGiftProof, getGiftProofStatus } from '../lib/api.js';
import { assertTaxToken } from '../lib/dividend-helpers.js';
import { resolveVaultData } from '../lib/vault-helpers.js';
import {
  parseTweetId,
  resolveBasememeApiToken,
  classifyProofStatus,
} from '../lib/gift-proof-helpers.js';

function safeJsonParse(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function unwrapApiResponse(response) {
  if (response && typeof response === 'object' && 'data' in response) {
    return response.data;
  }
  return response;
}

function unwrapCodedResponse(resp) {
  // Backend business-code envelope: { code: 0|!=0, data, msg }
  // SECURITY · no bearer leak: we only surface `resp.msg` / `resp.message`
  // / `code=<n>`. The bearer header never lives on the response body —
  // keep this function output narrow so axios-style request/config leaks
  // stay impossible via this path.
  if (resp && typeof resp === 'object' && 'code' in resp) {
    if (resp.code !== 0) {
      const msg = resp.msg || resp.message || `code=${resp.code}`;
      throw new Error(msg);
    }
    return resp.data ?? resp;
  }
  return resp;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pollProofStatus({
  vaultAddress,
  tweetId,
  intervalMs,
  timeoutMs,
  now = () => Date.now(),
}) {
  const deadline = now() + timeoutMs;
  let lastStatus = null;
  while (now() < deadline) {
    const resp = await getGiftProofStatus({ vaultAddress, tweetId });
    // B1: the backend may return HTTP 200 with a business-code failure
    // (`{code:1, msg:"..."}`) on `/proof_status` too — not just on submit.
    // Previously `classifyProofStatus` saw no `.status` key, defaulted to
    // 'pending', and the poll loop waited until --timeout (default 300s),
    // dropping the actionable `msg` on the floor. `unwrapCodedResponse`
    // throws immediately on `code !== 0`, else returns the inner payload
    // (or the body itself when no `data` wrapper is present) so
    // `classifyProofStatus` sees the expected `{status:...}` shape.
    const body = unwrapCodedResponse(unwrapApiResponse(resp) ?? resp);
    const classified = classifyProofStatus(body);
    lastStatus = classified;
    if (classified.state === 'confirmed') return classified;
    if (classified.state === 'failed') {
      // SECURITY · no bearer leak: `classified.reason` is a string from
      // the backend body, never from the axios error shape.
      throw new Error(
        `Gift proof failed: ${classified.reason || 'server reported failed status'}`,
      );
    }
    // 'pending' (or unknown) → wait and retry.
    await sleep(intervalMs);
  }
  throw new Error(
    `Gift proof still pending after ${Math.round(timeoutMs / 1000)}s (last: ${lastStatus?.state || 'unknown'})`,
  );
}

export async function giftProofSubmitCommand(tokenAddress, tweetUrl, options = {}) {
  const chainId = getChainId();
  const tweetId = parseTweetId(tweetUrl);

  const bearer = resolveBasememeApiToken(options);

  const infoResp = await getTokenInfo(tokenAddress);
  const coin = unwrapApiResponse(infoResp);
  if (!coin || !coin.contract_address) {
    throw new Error(`Token info not found for ${tokenAddress}`);
  }

  const extraData = safeJsonParse(coin.extra_data) || {};
  const coinVersion = coin.coin_version || extraData?.coin_version;
  assertTaxToken(coinVersion);

  const coinWithExtra = { ...coin, extra_data: extraData };
  const { vaultType, vaultAddress } = resolveVaultData(coinWithExtra);
  if (vaultType !== 'gift') {
    throw new Error(
      `gift-proof-submit only applies to gift vaults (this token has vault_type=${vaultType})`,
    );
  }

  // 1. Submit.
  const submitResp = await submitGiftProof({
    vaultAddress,
    tweetId,
    bearer,
  });
  unwrapCodedResponse(submitResp); // throws on code !== 0 (incl. rate-limit)

  if (options.skipPoll) {
    // Top-level keys alphabetized — keep in order when adding fields
    // (Polish Fix R1 · L3 #2 convention; see vault-info.js for details).
    return {
      action: 'gift-proof-submit',
      chainId,
      mode: 'tax',
      status: 'pending',
      submitted: true,
      token: tokenAddress,
      tweetId,
      vault: vaultAddress,
    };
  }

  // 2. Poll.
  const pollIntervalSec = Number(options.pollInterval ?? 15);
  const timeoutSec = Number(options.timeout ?? 300);
  if (!Number.isFinite(pollIntervalSec) || pollIntervalSec <= 0) {
    throw new Error('--poll-interval must be a positive number (seconds)');
  }
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    throw new Error('--timeout must be a positive number (seconds)');
  }

  const classified = await pollProofStatus({
    vaultAddress,
    tweetId,
    intervalMs: pollIntervalSec * 1000,
    timeoutMs: timeoutSec * 1000,
    now: options.__now,
  });

  // Top-level keys alphabetized — keep in order when adding fields
  // (Polish Fix R1 · L3 #2 convention; see vault-info.js for details).
  return {
    action: 'gift-proof-submit',
    chainId,
    mode: 'tax',
    status: classified.state,
    token: tokenAddress,
    tweetId,
    txHash: classified.txHash || null,
    vault: vaultAddress,
  };
}

export const giftProofSubmit = new Command('gift-proof-submit')
  .description('Submit a Gift vault ownership proof tweet and poll for confirmation')
  .argument('<tokenAddress>', 'Tax token contract address (coin_version >= 11.2.0, gift vault)')
  .argument('<tweetUrl>', 'Proof tweet URL (twitter.com/x.com) or numeric tweet id')
  .option('--token <bearer>', 'Bearer auth token (else BASEMEME_AUTH_TOKEN env)')
  .option('--poll-interval <sec>', 'Poll interval in seconds (default 15)', '15')
  .option('--timeout <sec>', 'Total poll timeout in seconds (default 300)', '300')
  .option('--skip-poll', 'Submit only — do not wait for confirmation')
  /*
   * SECURITY · bearer token leak hazard (Polish Commit 6 · L1 preventive).
   *
   * The error handler below only surfaces `error.message` (or the
   * stringified error when `.message` is missing). DO NOT expand this to
   * `JSON.stringify(error)` or include `error.config` / `error.request`
   * / `error.response.config` — those axios-style properties carry the
   * `Authorization: Bearer <token>` header verbatim and would leak the
   * bearer into stdout/stderr every time the backend returns an error.
   *
   * The bearer comes from `--token <bearer>` or `BASEMEME_AUTH_TOKEN` env
   * and is resolved once in `resolveBasememeApiToken(options)` at the top of
   * `giftProofSubmitCommand`. It's passed to `submitGiftProof` only; if
   * you add a new field that carries it, make sure it stays out of the
   * thrown error shape.
   *
   * Current surface area:
   *   - `submitGiftProof` response error → caught by `unwrapCodedResponse`,
   *     only `msg` / `message` / `code=<n>` surfaces (no bearer leak).
   *   - `getGiftProofStatus` poll error → same `unwrapCodedResponse` path.
   *   - tweet-URL parse / auth-missing / V4 token → local throws with
   *     human messages; no network-layer error shape.
   */
  .action(async (tokenAddress, tweetUrl, options) => {
    try {
      const result = await giftProofSubmitCommand(tokenAddress, tweetUrl, options);
      console.log(JSON.stringify({ success: true, data: result }, null, 2));
    } catch (error) {
      // SECURITY · see block comment above: `.message` only, never the
      // full error object (no bearer leak from axios `error.config`).
      console.error(
        JSON.stringify({ success: false, error: error?.message || String(error) }),
      );
      process.exit(1);
    }
  });
