-- Migration: asset_columns_text_dynamic_catalog
--
-- PURPOSE: Convert all `supported_asset` enum columns to TEXT (varchar) so that
-- any asset discovered from the Blockradar catalog (USDT, BTC, TRX, and future
-- assets) can be persisted without a DB schema migration.
--
-- Before this migration, inserting a TRX deposit caused:
--   "Invalid value for argument 'asset'. Expected SupportedAsset."
-- because TRX was not a member of the Postgres `supported_asset` enum.
--
-- Validation now lives entirely at the app layer: AssetRegistry /
-- contracts SupportedAssetSchema validate the value before it reaches the DB.
-- The `supported_asset` enum type is dropped once all referencing columns are
-- converted.
--
-- The USING ::text cast preserves existing enum values (e.g. 'USDT', 'BTC') as
-- their string equivalents — no data loss.

-- 1. Drop default expressions that reference the enum type (prevents alter errors)
ALTER TABLE "quotes" ALTER COLUMN "asset" DROP DEFAULT;
ALTER TABLE "wallet_balances" ALTER COLUMN "asset" DROP DEFAULT;
ALTER TABLE "price_snapshots" ALTER COLUMN "asset" DROP DEFAULT;
ALTER TABLE "travel_rule_data" ALTER COLUMN "asset" DROP DEFAULT;
ALTER TABLE "treasury_alerts" ALTER COLUMN "asset" DROP DEFAULT;
ALTER TABLE "treasury_exposures" ALTER COLUMN "asset" DROP DEFAULT;
ALTER TABLE "beneficiaries" ALTER COLUMN "cryptoAsset" DROP DEFAULT;

-- 2. Alter columns: enum → text (preserves existing values via ::text cast)
ALTER TABLE "wallet_balances"    ALTER COLUMN "asset"       TYPE TEXT USING "asset"::text;
ALTER TABLE "quotes"             ALTER COLUMN "asset"       TYPE TEXT USING "asset"::text;
ALTER TABLE "price_snapshots"    ALTER COLUMN "asset"       TYPE TEXT USING "asset"::text;
ALTER TABLE "travel_rule_data"   ALTER COLUMN "asset"       TYPE TEXT USING "asset"::text;
ALTER TABLE "treasury_alerts"    ALTER COLUMN "asset"       TYPE TEXT USING "asset"::text;
ALTER TABLE "treasury_exposures" ALTER COLUMN "asset"       TYPE TEXT USING "asset"::text;
ALTER TABLE "beneficiaries"      ALTER COLUMN "cryptoAsset" TYPE TEXT USING "cryptoAsset"::text;

-- 3. Drop the now-unused enum type
DROP TYPE "supported_asset";
