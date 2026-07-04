-- Widen the fiat_currency enum from NGN-only to the 8 configured launch/near-term
-- fiats (go-readiness #8). Non-destructive: existing NGN rows are untouched; the
-- new values are inert until a market is enabled server-side (§3.3). `ADD VALUE IF
-- NOT EXISTS` is idempotent. A Quote / price snapshot / treasury exposure could not
-- be inserted in any non-NGN currency before this.
ALTER TYPE "fiat_currency" ADD VALUE IF NOT EXISTS 'GHS';
ALTER TYPE "fiat_currency" ADD VALUE IF NOT EXISTS 'KES';
ALTER TYPE "fiat_currency" ADD VALUE IF NOT EXISTS 'UGX';
ALTER TYPE "fiat_currency" ADD VALUE IF NOT EXISTS 'TZS';
ALTER TYPE "fiat_currency" ADD VALUE IF NOT EXISTS 'RWF';
ALTER TYPE "fiat_currency" ADD VALUE IF NOT EXISTS 'ZAR';
ALTER TYPE "fiat_currency" ADD VALUE IF NOT EXISTS 'USD';
