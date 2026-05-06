import { quoteSell } from '../lib/quote.js';

export async function quoteSellCommand(tokenAddress, tokenAmount, options) {
  return quoteSell(tokenAddress, {
    tokenAmount,
    slippageBps: options?.slippage,
    ...(options?.pair ? { pair: options.pair } : {}),
  });
}
