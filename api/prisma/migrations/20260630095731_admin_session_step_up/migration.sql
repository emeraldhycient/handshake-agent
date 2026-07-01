-- AlterTable
ALTER TABLE "admin_sessions" ADD COLUMN     "stepUpCompletedAt" TIMESTAMPTZ;

-- AlterTable
ALTER TABLE "backfill_runs" ALTER COLUMN "id" DROP DEFAULT;
