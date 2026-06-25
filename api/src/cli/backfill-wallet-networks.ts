/**
 * CLI entrypoint: backfill missing wallet network addresses for existing users.
 *
 * Usage (after `pnpm --filter @handshake-agent/api build`):
 *   pnpm --filter @handshake-agent/api backfill:wallet-networks
 *
 * Environment variables:
 *   DRY_RUN   — set to 'true' for a report-only run (no wallets created).
 *               Highly recommended before the first live run on a new network.
 *   BATCH_SIZE — number of user IDs fetched per DB page (default 100).
 *
 * Exit codes:
 *   0 — success (zero failures)
 *   1 — one or more per-user failures (batch completed but some users failed)
 *   2 — fatal error before/during startup
 *
 * Runbook: docs/runbooks/adding-assets-and-networks.md
 *   - New network:   run with DRY_RUN=true first, then DRY_RUN=false.
 *   - New asset on existing network: NO backfill needed.
 *
 * Architecture: NestFactory.createApplicationContext boots the full DI
 * container (incl. Config, Prisma, Blockradar adapter) without starting the
 * HTTP server. No HTTP/auth surface is exposed. WalletBackfillService is
 * resolved from the context and run with the options from env/argv.
 */

import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';

import { AppModule } from '../app.module';
import { WalletBackfillService } from '../modules/wallets/application/wallet-backfill.service';

const logger = new Logger('BackfillCLI');

async function main(): Promise<void> {
  const dryRun = process.env['DRY_RUN'] === 'true';
  const batchSizeRaw = process.env['BATCH_SIZE'];
  const batchSize = batchSizeRaw ? parseInt(batchSizeRaw, 10) : undefined;

  if (batchSize !== undefined && (isNaN(batchSize) || batchSize <= 0)) {
    logger.error(
      `Invalid BATCH_SIZE="${batchSizeRaw}" — must be a positive integer.`,
    );
    process.exit(2);
  }

  logger.log(
    `Starting wallet network backfill CLI (dryRun=${dryRun}, batchSize=${batchSize ?? 'default'})`,
  );

  // Boot NestJS application context — wires DI without starting the HTTP server.
  // This gives us the full ConfigModule, PrismaModule, WalletsModule, IdentityModule,
  // and AdminModule (which provides WalletBackfillService with USER_LISTER).
  const app = await NestFactory.createApplicationContext(AppModule, {
    // Suppress Nest's banner in CLI output.
    logger: ['error', 'warn', 'log'],
  });

  // Resolve WalletBackfillService from the DI container.
  const backfillService = app.get(WalletBackfillService);

  let exitCode = 0;
  try {
    const report = await backfillService.backfillMissingNetworkAddresses({
      batchSize,
      dryRun,
    });

    // Pretty-print the report to stdout.
    console.log('\n=== Wallet Network Backfill Report ===');
    console.log(
      `Mode        : ${dryRun ? 'DRY RUN (no wallets created)' : 'LIVE'}`,
    );
    console.log(`Users scanned: ${report.usersScanned}`);
    console.log('\nPer-network breakdown:');
    for (const [network, tally] of Object.entries(report.perNetwork)) {
      console.log(
        `  ${network}: alreadyHad=${tally.alreadyHad}, provisioned=${tally.provisioned}`,
      );
    }

    if (report.failures.length > 0) {
      console.log(`\nFailures (${report.failures.length}):`);
      for (const failure of report.failures) {
        console.log(`  userId=${failure.userId}: ${failure.error}`);
      }
      exitCode = 1;
    } else {
      console.log('\nNo failures.');
    }

    console.log('======================================\n');
  } catch (err) {
    logger.error(
      `Fatal error during backfill: ${err instanceof Error ? err.message : String(err)}`,
    );
    exitCode = 2;
  } finally {
    await app.close();
  }

  process.exit(exitCode);
}

void main();
