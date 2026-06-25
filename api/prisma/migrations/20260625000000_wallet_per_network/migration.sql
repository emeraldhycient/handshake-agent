-- WN-1: Model custodial wallet per network, not per asset.
--
-- A Blockradar child address is per master-wallet = per NETWORK and receives
-- ALL assets/tokens on that chain. One address per (user, network); per-asset
-- balances move to WalletBalance.asset.
--
-- No prod data exists — clean migration. (ADR-0006, CLAUDE.md §3.1)

-- DropIndex
DROP INDEX "wallet_balances_walletId_syncedAt_idx";

-- DropIndex
DROP INDEX "wallets_asset_network_status_idx";

-- DropIndex
DROP INDEX "wallets_userId_asset_network_key";

-- AlterTable: add asset to WalletBalance (balance is per-asset on the network wallet)
ALTER TABLE "wallet_balances" ADD COLUMN     "asset" "supported_asset" NOT NULL;

-- AlterTable: remove asset from Wallet (wallet is now per (user, network))
ALTER TABLE "wallets" DROP COLUMN "asset";

-- CreateIndex
CREATE INDEX "wallet_balances_walletId_asset_syncedAt_idx" ON "wallet_balances"("walletId", "asset", "syncedAt");

-- CreateIndex
CREATE INDEX "wallets_network_status_idx" ON "wallets"("network", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_network_key" ON "wallets"("userId", "network");
