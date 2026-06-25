-- WN: velocity counters gain a per-currency dimension (no cross-currency aggregation).
-- No prod data exists — existing rows backfill to NGN via the column default.
ALTER TABLE "velocity_counters" ADD COLUMN "fiatCurrency" "fiat_currency" NOT NULL DEFAULT 'NGN';
DROP INDEX "velocity_counters_userId_counterType_key";
CREATE UNIQUE INDEX "velocity_counters_userId_counterType_fiatCurrency_key" ON "velocity_counters"("userId", "counterType", "fiatCurrency");
