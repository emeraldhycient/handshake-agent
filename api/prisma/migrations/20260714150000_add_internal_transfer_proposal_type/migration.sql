-- AlterEnum
-- Internal (user→user, PayID) ledger transfer proposal type (Spec 2, Task 6).
-- The engine settles these off-chain as a double-entry; there is no on-chain send.
ALTER TYPE "proposal_type" ADD VALUE 'internal_transfer';
