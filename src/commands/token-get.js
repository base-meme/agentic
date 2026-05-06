import { getTokenInfo, getTokenTradeData } from '../lib/api.js';

export async function tokenGetCommand(address) {
  const [info, trade] = await Promise.allSettled([
    getTokenInfo(address),
    getTokenTradeData(address),
  ]);

  const result = {};
  if (info.status === 'fulfilled') result.info = info.value?.data;
  if (trade.status === 'fulfilled') result.tradeData = trade.value?.data;
  return result;
}
