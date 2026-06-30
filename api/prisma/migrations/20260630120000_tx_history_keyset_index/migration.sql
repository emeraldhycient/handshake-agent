-- Keyset pagination index for transaction history.
-- Supports the seek query in TransactionPrismaRepository.listByUserInRange:
--   WHERE "userId" = $1 AND "createdAt" BETWEEN $2 AND $3
--   ORDER BY "createdAt" DESC, "id" DESC
-- The existing (userId, status, createdAt) index leads with status and lacks id,
-- so it cannot serve this ordered keyset seek.
CREATE INDEX "transactions_userId_createdAt_id_idx" ON "transactions"("userId", "createdAt" DESC, "id" DESC);
