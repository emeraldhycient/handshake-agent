-- AlterEnum
-- Internal (user→user, PayID) off-chain ledger transfer transaction type
-- (Spec 2, Task 7). The engine settles it as a single-phase double-entry
-- between two user_wallet ledger accounts — no on-chain send.
ALTER TYPE "transaction_type" ADD VALUE 'internal_transfer';
