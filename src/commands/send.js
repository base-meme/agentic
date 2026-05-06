import { isAddress, parseEther, parseUnits } from 'viem';
import { getPublicClient } from '../lib/chain.js';
import { erc20ABI, basememeFactoryABI, bondingCurveABI, getAddresses } from '../lib/contracts.js';
import { getAccount, getWalletClient } from '../lib/wallet.js';

export async function sendCommand(toAddress, amount, options) {
  if (!toAddress || !isAddress(toAddress)) {
    throw new Error(`Invalid recipient address: ${toAddress}`);
  }
  const parsedAmount = parseFloat(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new Error(`Invalid amount: ${amount}. Must be a positive number.`);
  }
  if (options?.token && !isAddress(options.token)) {
    throw new Error(`Invalid token address: ${options.token}`);
  }

  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const account = getAccount();
  const tokenAddress = options?.token;

  let hash;
  let isNative = !tokenAddress;

  if (isNative) {
    const valueWei = parseEther(String(amount));
    hash = await walletClient.sendTransaction({
      to: toAddress,
      value: valueWei,
    });
  } else {
    // Check if token is on bonding curve (transfers restricted before graduation)
    try {
      const addrs = getAddresses();
      const bondingCurve = await publicClient.readContract({
        address: addrs.basememeFactory,
        abi: basememeFactoryABI,
        functionName: 'tokenToBondingCurve',
        args: [tokenAddress],
      });
      if (bondingCurve && bondingCurve !== '0x0000000000000000000000000000000000000000') {
        const tradingStopped = await publicClient.readContract({
          address: bondingCurve,
          abi: bondingCurveABI,
          functionName: 'tradingStopped',
        });
        if (!tradingStopped) {
          throw new Error('Token is in bonding curve phase — transfers are restricted until graduation. Use "sell" to exit your position instead.');
        }
      }
    } catch (e) {
      // If the error is our phase check, re-throw; otherwise ignore (might not be a basememe token)
      if (e.message?.includes('bonding curve phase')) throw e;
    }

    // Get token decimals
    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: erc20ABI,
      functionName: 'decimals',
    });
    const valueWei = parseUnits(String(amount), Number(decimals));

    hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: erc20ABI,
      functionName: 'transfer',
      args: [toAddress, valueWei],
    });
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') {
    throw new Error(`Transaction reverted (tx: ${receipt.transactionHash})`);
  }

  return {
    txHash: hash,
    action: 'send',
    from: account.address,
    to: toAddress,
    amount,
    native: isNative,
    token: tokenAddress || 'ETH',
    receipt: {
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    },
  };
}
