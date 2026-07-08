-- Add the fiat-currency snapshot to Travel Rule captures (Wave D multi-currency
-- correctness). `amountFiat` has always been valued in the platform default fiat at
-- capture time; from this migration on the writer snapshots that currency explicitly.
--
-- BACKFILL SEMANTICS (explicit, for compliance export): every EXISTING row predates
-- currency capture and was valued in NGN — the only live settlement fiat before this
-- migration (catalog default). We backfill 'NGN' via a column DEFAULT and then DROP
-- the default so all FUTURE rows must state their currency explicitly (fail-closed at
-- the application layer). A wrong-but-explicit historical default beats NULLs for a
-- compliance record.
ALTER TABLE "travel_rule_data" ADD COLUMN "fiatCurrency" TEXT NOT NULL DEFAULT 'NGN';
ALTER TABLE "travel_rule_data" ALTER COLUMN "fiatCurrency" DROP DEFAULT;
