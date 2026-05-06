import { Buffer } from 'buffer';
import { decodeEventLog } from 'viem';
import { getPublicClient } from '../lib/chain.js';
import { ERC8004_NFT_ADDRESS, erc8004ABI, erc8004Events } from '../lib/contracts.js';
import { getAccount, getWalletClient } from '../lib/wallet.js';

export async function erc8004RegisterCommand(name, options) {
  if (!name || !name.trim()) {
    throw new Error('Name is required');
  }

  const account = getAccount();
  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const description = options?.description || "I'm a Base.Meme trading agent";
  const image = options?.image || '';
  const payload = {
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: name.trim(),
    description,
    image,
    active: true,
    supportedTrust: [''],
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const agentURI = `data:application/json;base64,${encodedPayload}`;

  const txHash = await walletClient.writeContract({
    address: ERC8004_NFT_ADDRESS(),
    abi: erc8004ABI,
    functionName: 'register',
    args: [agentURI],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === 'reverted') {
    throw new Error(`Transaction reverted (tx: ${receipt.transactionHash})`);
  }

  let agentId = null;

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: erc8004Events,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === 'Registered') {
        agentId = decoded.args.agentId;
        break;
      }
    } catch {
      // Ignore unrelated logs.
    }
  }

  if (agentId == null) {
    throw new Error(`Registered event not found in transaction receipt: ${txHash}`);
  }

  return {
    txHash,
    agentId: Number(agentId),
    agentURI,
    address: account.address,
    receipt: {
      status: receipt.status,
      blockNumber: Number(receipt.blockNumber),
      gasUsed: receipt.gasUsed.toString(),
    },
  };
}
