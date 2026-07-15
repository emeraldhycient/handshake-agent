-- Add the fiat-currency dimension to ticket orders (multi-currency hardening).
-- `totalAmount`/`unitPrice`/`platformFee` have always been valued in the
-- catalog's historical settlement fiat (NGN) — the only live fiat before this
-- migration, and there is no writer yet (the tickets module is future; only the
-- admin read-only oversight surface exists). Default every row (existing and
-- any test/seed inserts still made without stating a currency) to 'NGN' so the
-- column is safe to add without a backfill script. A future tickets-module
-- writer should state the currency explicitly at order-creation time.
ALTER TABLE "ticket_orders" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'NGN';
