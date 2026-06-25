-- CreateEnum
CREATE TYPE "backfill_run_status" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "backfill_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "status" "backfill_run_status" NOT NULL DEFAULT 'queued',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "totalUsers" INTEGER NOT NULL DEFAULT 0,
    "scannedUsers" INTEGER NOT NULL DEFAULT 0,
    "perNetwork" JSONB NOT NULL DEFAULT '{}',
    "failures" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,

    CONSTRAINT "backfill_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backfill_runs_status_idx" ON "backfill_runs"("status");

-- CreateIndex
CREATE INDEX "backfill_runs_createdAt_idx" ON "backfill_runs"("createdAt");
