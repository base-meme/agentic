// Pure helpers for `basememe gift-proof-submit`.
//
// Responsibilities:
//  - Parse tweet URL (twitter.com / x.com / direct numeric id) → tweet_id
//  - Resolve auth token from CLI flag / env var with a clear error path
//  - Classify proof-status polling results (confirmed / failed / pending)
//
// Rate limits + error semantics: backend returns business codes
//   {code: 0, data: ...}  → success
//   {code: !=0, msg: ...} → failure (including rate-limit messages)
// Callers surface `msg` verbatim so operators get the server's wording.

const TWEET_URL_PATTERN = /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i;

/**
 * Extract a numeric tweet_id from either a URL or a direct numeric string.
 * Throws on malformed input.
 */
export function parseTweetId(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('tweetUrl is required (URL or numeric tweet id)');
  }
  const trimmed = input.trim();

  // Case 1: direct numeric id (10+ digits is the current minimum observed).
  if (/^\d{10,}$/.test(trimmed)) return trimmed;

  // Case 2: URL. Both twitter.com and x.com are accepted by the backend.
  const match = trimmed.match(TWEET_URL_PATTERN);
  if (match) return match[1];

  throw new Error(
    `Could not parse tweet id from "${input}" — expected a twitter.com/x.com status URL or a numeric id`,
  );
}

/**
 * Resolve the bearer auth token in priority order:
 *   1. `--token <token>` CLI flag
 *   2. `BASEMEME_AUTH_TOKEN` env var
 * No login flow in Phase 5 — the operator is expected to obtain a token
 * out-of-band (frontend login / api docs) and pass it in. A clear error
 * beats a silent 401 here because the backend rate-limits by user.
 */
export function resolveAuthToken(options = {}, env = process.env) {
  const tok = options.token || env.BASEMEME_AUTH_TOKEN;
  if (!tok || typeof tok !== 'string' || !tok.trim()) {
    throw new Error(
      'Missing auth token — pass --token <bearer> or set BASEMEME_AUTH_TOKEN',
    );
  }
  return tok.trim();
}

/**
 * Prefer the backend's `{code, msg}` body over axios's generic
 * "Request failed with status code N" — the backend's wording carries
 * rate-limit specifics (e.g. "rate limit exceeded (user 5/60s)") that the
 * operator needs to see. Safe-by-construction: on missing/null/undefined
 * input we fall back to `String(input)` so callers can use this inside a
 * `throw new Error(extractBackendMsg(e))` without guarding.
 *
 * Resolution order: response.data.msg → .message → String(input)
 */
export function extractBackendMsg(error) {
  const fromBody = error?.response?.data?.msg;
  if (typeof fromBody === 'string' && fromBody.length > 0) return fromBody;
  const fromMessage = error?.message;
  if (typeof fromMessage === 'string' && fromMessage.length > 0) return fromMessage;
  return String(error);
}

/**
 * Classify a `/gift_vault/proof_status` response body.
 *
 * Expected shapes (aligned with frontend `gift-proof-dialog/index.tsx:200-224`):
 *   { status: { status: 'pending' | 'confirmed' | 'failed', reason?, tx_hash? } }
 * or a flat `{ status: 'confirmed', tx_hash: '0x...' }`
 */
export function classifyProofStatus(body) {
  const inner = body?.status ?? body;
  const state = typeof inner === 'string' ? inner : inner?.status;
  const reason = inner?.reason || body?.msg || null;
  const txHash = inner?.tx_hash || inner?.txHash || body?.tx_hash || null;
  return {
    state: state || 'pending',
    reason,
    txHash,
    raw: body,
  };
}
