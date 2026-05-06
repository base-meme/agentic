import { quoteBuy } from '../lib/quote.js';

export async function quoteBuyCommand(tokenAddress, ethAmount, options) {
  return quoteBuy(tokenAddress, {
    ethAmount,
    slippageBps: options?.slippage,
    ...(options?.pair ? { pair: options.pair } : {}),
  });
}
