import { Command } from 'commander';
import { readFileSync } from 'fs';
import { configCommand } from './commands/config.js';
import { tokenInfoCommand } from './commands/token-info.js';
import { tokenListCommand } from './commands/token-list.js';
import { tokenGetCommand } from './commands/token-get.js';
import { rankingsCommand } from './commands/rankings.js';
import { quoteBuyCommand } from './commands/quote-buy.js';
import { quoteSellCommand } from './commands/quote-sell.js';
import { eventsCommand } from './commands/events.js';
import { verifyCommand } from './commands/verify.js';
import { buy as buyCommandInstance } from './commands/buy.js';
import { sell as sellCommandInstance } from './commands/sell.js';
import { sendCommand } from './commands/send.js';
import { erc8004BalanceCommand } from './commands/8004-balance.js';
import { erc8004RegisterCommand } from './commands/8004-register.js';
import { create as createCommand } from './commands/create.js';
import { taxInfo as taxInfoCommandInstance } from './commands/tax-info.js';
import { dividendInfo as dividendInfoCommandInstance } from './commands/dividend-info.js';
import { dividendClaim as dividendClaimCommandInstance } from './commands/dividend-claim.js';
import { vaultInfo as vaultInfoCommandInstance } from './commands/vault-info.js';
import { vaultClaim as vaultClaimCommandInstance } from './commands/vault-claim.js';
import { vaultBurn as vaultBurnCommandInstance } from './commands/vault-burn.js';
import { vaultClaimReward as vaultClaimRewardCommandInstance } from './commands/vault-claim-reward.js';
import { giftProofSubmit as giftProofSubmitCommandInstance } from './commands/gift-proof-submit.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function output(data) {
  console.log(JSON.stringify({ success: true, data }, null, 2));
}

function outputError(error) {
  console.error(JSON.stringify({ success: false, error: error.message || String(error) }));
  process.exit(1);
}

async function run(fn, ...args) {
  try {
    const result = await fn(...args);
    output(result);
  } catch (e) {
    outputError(e);
  }
}

const program = new Command();
program.name('basememe').description('CLI for Basememe on Base').version(pkg.version);

program.command('config').description('Show chain config and contract addresses').action(() => run(configCommand));

program
  .command('token-info <tokenAddress>')
  .description('On-chain token info (name, symbol, reserves, fees)')
  .action((addr) => run(tokenInfoCommand, addr));

program
  .command('token-list')
  .description('List tokens from API')
  .option('--sort <sort>', 'Sort: now_trending|market_cap|newest|24h_volume (default: block_create_time)', 'block_create_time')
  .option('--kw <keyword>', 'Search keyword', '')
  .option('--offset <n>', 'Offset', '0')
  .option('--limit <n>', 'Limit', '30')
  .action((opts) => run(tokenListCommand, opts));

program
  .command('token-get <tokenAddress>')
  .description('Token detail + trade data from API')
  .action((addr) => run(tokenGetCommand, addr));

program
  .command('rankings <orderBy>')
  .description('Rankings: now_trending|market_cap|24h_volume|newest')
  .option('--limit <n>', 'Limit', '30')
  .action((orderBy, opts) => run(rankingsCommand, orderBy, opts));

program
  .command('quote-buy <tokenAddress> <ethAmount>')
  .description('Estimate buy price (ETH -> tokens)')
  .option('--slippage <bps>', 'Slippage tolerance in bps (default: 500 = 5%)')
  .option('--pair <type>', 'Collateral pair (ETH|USDC|SOL)')
  .action((addr, amount, opts) => run(quoteBuyCommand, addr, amount, opts));

program
  .command('quote-sell <tokenAddress> <tokenAmount>')
  .description('Estimate sell price (tokens -> ETH)')
  .option('--slippage <bps>', 'Slippage tolerance in bps (default: 500 = 5%)')
  .option('--pair <type>', 'Collateral pair (ETH|USDC|SOL)')
  .action((addr, amount, opts) => run(quoteSellCommand, addr, amount, opts));

program
  .command('events [fromBlock]')
  .description('Basememe factory on-chain events (default: last 10000 blocks)')
  .option('--toBlock <block>', 'End block (default: latest)')
  .option('--chunk <n>', 'Blocks per RPC request (default: 1000)', '1000')
  .action((from, opts) => run(eventsCommand, from, opts));

program.command('verify').description('Check RPC, API, and contract connectivity').action(() => run(verifyCommand));

// buy / sell Commander instances are defined inside their command files so
// the E2E harness can `runtime.buy.parseAsync(...)`. Flag help text + default
// slippage live there; this file just registers them on the root program.
program.addCommand(buyCommandInstance);
program.addCommand(sellCommandInstance);

program
  .command('send <toAddress> <amount>')
  .description('Send ETH or tokens')
  .option('--token <tokenAddress>', 'ERC20 token address (omit for native ETH)')
  .action((to, amount, opts) => run(sendCommand, to, amount, opts));

program
  .command('8004-balance [address]')
  .description('Query ERC-8004 Identity NFT balance')
  .action((addr) => run(erc8004BalanceCommand, addr));

program
  .command('8004-register <name>')
  .description('Register (mint) an ERC-8004 Identity NFT')
  .option('--image <url>', 'Image URL for agent profile')
  .option('--description <text>', 'Agent description')
  .action((name, opts) => run(erc8004RegisterCommand, name, opts));

program.addCommand(createCommand);

// Phase 4 · Dividend (dividendBps bucket + per-token dividend contract).
// NOT the BurnDividend vault path — that's Phase 5 via `vault-burn`.
program.addCommand(taxInfoCommandInstance);
program.addCommand(dividendInfoCommandInstance);
program.addCommand(dividendClaimCommandInstance);
program.addCommand(vaultInfoCommandInstance);
program.addCommand(vaultClaimCommandInstance);
program.addCommand(vaultBurnCommandInstance);
program.addCommand(vaultClaimRewardCommandInstance);
program.addCommand(giftProofSubmitCommandInstance);

program.parse();
