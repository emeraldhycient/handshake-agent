-- LedgerEntry.sequence is allocated PER (accountType, accountId, currency): each
-- asset sub-ledger has its own running balance + monotonic counter. But the unique
-- index omitted `currency`, so the FIRST time an account received a 2nd asset its
-- per-currency sequence (1) collided with the first asset's sequence (1) on the
-- (accountType, accountId, sequence) index — a DETERMINISTIC P2002 that blocked
-- every multi-asset user (e.g. a wallet holding TRX could never be credited USDT).
--
-- Add `currency` to the unique index. The new index is a column SUPERSET of the old
-- one, i.e. strictly LOOSER: any row set that was unique under (accountType,
-- accountId, sequence) is necessarily unique under (accountType, accountId,
-- currency, sequence), so no existing data can violate it.
DROP INDEX "ledger_entries_accountType_accountId_sequence_key";
CREATE UNIQUE INDEX "ledger_entries_accountType_accountId_currency_sequence_key" ON "ledger_entries"("accountType", "accountId", "currency", "sequence");
