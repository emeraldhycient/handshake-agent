-- Sanctions match disposition (ADM Phase 7). The immutable SanctionsRecord captures
-- the screener's finding (`verdict`); an operator additionally DISPOSITIONS the match
-- (cleared / escalated / blocked) from the admin compliance console. The disposition
-- is an ANNOTATION applied through the audited service path (never a raw write, §3.1)
-- — the screener verdict is never mutated. The full before/after decision trail lives
-- in the hash-chained AuditLog.

-- CreateEnum
CREATE TYPE "sanctions_disposition" AS ENUM ('cleared', 'escalated', 'blocked');

-- AlterTable
ALTER TABLE "sanctions_records"
  ADD COLUMN "disposition" "sanctions_disposition",
  ADD COLUMN "dispositionAdminId" UUID,
  ADD COLUMN "dispositionComment" TEXT,
  ADD COLUMN "dispositionAt" TIMESTAMPTZ;
