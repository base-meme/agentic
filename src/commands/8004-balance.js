import { isAddress } from 'viem';
import { getPublicClient } from '../lib/chain.js';
import { ERC8004_NFT_ADDRESS, erc8004ABI } from '../lib/contracts.js';
import { getAccount } from '../lib/wallet.js';

export async function erc8004BalanceCommand(address) {
  const resolvedAddress = address || getAccount().address;

  if (!isAddress(resolvedAddress)) {
    throw new Error(`Invalid address: ${resolvedAddress}`);
  }

  const publicClient = getPublicClient();

  const balance = await publicClient.readContract({
    address: ERC8004_NFT_ADDRESS(),
    abi: erc8004ABI,
    functionName: 'balanceOf',
    args: [resolvedAddress],
  });

  return {
    address: resolvedAddress,
    balance: Number(balance),
    isAgent: balance > 0n,
  };
}
