-- Task 3.6: Sumsub webhook (verify -> persist -> handle) needs its own
-- WebhookEvent.provider value alongside blockradar/flutterwave/whatsapp.
--   webhook_provider += 'sumsub'
--
-- Additive enum value only; no data migration. `ADD VALUE IF NOT EXISTS` is
-- idempotent so re-running is safe; it stands alone (Postgres cannot add an
-- enum value inside a transaction that later uses it).
ALTER TYPE "webhook_provider" ADD VALUE IF NOT EXISTS 'sumsub';
