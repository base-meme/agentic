import { getRankings } from '../lib/api.js';

const SORT_ALIASES = {
  newest: 'block_create_time',
  new: 'block_create_time',
  trending: 'now_trending',
  volume: 'trade_volume_24h',
  '24h_volume': 'trade_volume_24h',
  progress: 'bonding_curve_progress',
  last_traded: 'latest_trade_time',
};

function resolveSort(sort) {
  return SORT_ALIASES[sort] || sort;
}

export async function rankingsCommand(orderBy, options) {
  const limit = Number(options.limit || 30);
  const res = await getRankings(resolveSort(orderBy), limit);
  return res.data;
}
