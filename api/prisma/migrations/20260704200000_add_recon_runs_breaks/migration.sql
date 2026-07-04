-- CreateEnum
CREATE TYPE "recon_run_type" AS ENUM ('settlement_outbox', 'wallet_deposit');

-- CreateEnum
CREATE TYPE "recon_run_status" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "recon_break_type" AS ENUM ('balance_mismatch', 'over_credit', 'settlement_failure');

-- CreateEnum
CREATE TYPE "recon_break_status" AS ENUM ('detected', 'acknowledged', 'resolved', 'rejected');

-- CreateTable
CREATE TABLE "recon_runs" (
    "id" UUID NOT NULL,
    "runType" "recon_run_type" NOT NULL,
    "status" "recon_run_status" NOT NULL DEFAULT 'running',
    "totalChecked" INTEGER NOT NULL DEFAULT 0,
    "breaksDetected" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ NOT NULL,
    "completedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recon_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recon_breaks" (
    "id" UUID NOT NULL,
    "reconRunId" UUID NOT NULL,
    "breakType" "recon_break_type" NOT NULL,
    "userId" UUID,
    "walletId" UUID,
    "outboxId" UUID,
    "currency" TEXT NOT NULL,
    "delta" DECIMAL(38,18) NOT NULL,
    "status" "recon_break_status" NOT NULL DEFAULT 'detected',
    "approvedByAdminId" UUID,
    "reason" TEXT,
    "actionAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "recon_breaks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recon_runs_status_createdAt_idx" ON "recon_runs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "recon_breaks_reconRunId_status_idx" ON "recon_breaks"("reconRunId", "status");

-- CreateIndex
CREATE INDEX "recon_breaks_userId_status_idx" ON "recon_breaks"("userId", "status");

-- AddForeignKey
ALTER TABLE "recon_breaks" ADD CONSTRAINT "recon_breaks_reconRunId_fkey" FOREIGN KEY ("reconRunId") REFERENCES "recon_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
