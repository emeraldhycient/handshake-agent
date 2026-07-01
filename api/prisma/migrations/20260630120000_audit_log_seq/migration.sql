-- AuditLog gains a monotonic chain-order column (BIGSERIAL). Tie-free total
-- order for the tamper-evident hash chain (append reads max(seq); verifyChain
-- walks seq asc). Not part of the hash itself.

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_seq_key" ON "audit_logs"("seq");
