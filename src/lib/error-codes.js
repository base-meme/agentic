/**
 * Stable, programmatic error codes / labels used by the trade commands.
 *
 * Public contract:
 *   - `error.code` on a thrown trade error will be `RECEIPT_TIMEOUT_CODE`
 *     when viem's `waitForTransactionReceipt` exceeded its timeout window
 *     but the in-flight tx may still mine. Callers should poll
 *     `getTransactionReceipt(error.txHash)` with their own deadline
 *     instead of resubmitting (avoids double-execution).
 *   - `error.txLabel` is one of `TX_LABELS` and identifies which step in
 *     the trade pipeline timed out (allowance-reset → approve → buy/sell).
 *
 * These constants are exported so external consumers (wallet UIs,
 * agent harnesses) can match programmatically rather than parsing
 * the human-readable error message.
 */

export const RECEIPT_TIMEOUT_CODE = 'RECEIPT_TIMEOUT';

export const TX_LABELS = Object.freeze({
  ALLOWANCE_RESET: 'allowance-reset',
  APPROVE: 'approve',
  PERMIT2_APPROVE: 'permit2-approve',
  BUY: 'buy',
  SELL: 'sell',
});

const TRADE_ERROR_CODES = new Set([RECEIPT_TIMEOUT_CODE]);

/**
 * Whitelist filter: only forward error.code values that this CLI declares.
 * Without this, viem's `RpcRequestError.code` (numeric like `-32603`) would
 * leak into the JSON error payload alongside our string codes and confuse
 * any caller using `code` as a discriminator.
 */
export function pickStableErrorCode(code) {
  return TRADE_ERROR_CODES.has(code) ? code : undefined;
}
