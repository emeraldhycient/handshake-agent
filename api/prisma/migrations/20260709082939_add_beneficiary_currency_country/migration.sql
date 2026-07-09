-- AlterTable
ALTER TABLE "beneficiaries" ADD COLUMN     "bankCountry" TEXT,
ADD COLUMN     "payoutCurrency" TEXT;

-- Backfill: every existing bank-account beneficiary predates the currency/country
-- dimension and was NGN-only (Flutterwave NUBAN). Set them to NG / NGN so the sell
-- currency-match guard and name-enquiry country-gating treat them consistently
-- (post-backfill no bank row is null; crypto rows stay null on both columns).
UPDATE "beneficiaries"
SET "bankCountry" = 'NG', "payoutCurrency" = 'NGN'
WHERE "type" = 'bank_account';
