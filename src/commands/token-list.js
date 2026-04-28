import { getTokenList } from '../lib/api.js';

// Map user-friendly aliases to actual API sort values
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

export async function tokenListCommand(options) {
  const { sort = 'block_create_time', kw = '', offset = 0, limit = 30 } = options;
  const resolvedSort = resolveSort(sort);
  const res = await getTokenList({ sort: resolvedSort, kw, offset: Number(offset), limit: Number(limit) });
  return res.data;
}
