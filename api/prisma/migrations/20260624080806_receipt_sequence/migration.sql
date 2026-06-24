-- CreateSequence
-- Global monotonic sequence for receipt numbers. Using a Postgres SEQUENCE
-- eliminates the COUNT(*)+1 race and makes the UNIQUE constraint on
-- receipts.receiptNumber a safety net rather than a concurrency gate.
-- The sequence starts at 1 and increments by 1 with no upper bound.
-- NO CYCLE ensures it never wraps (receipt numbers are permanent audit records).
CREATE SEQUENCE IF NOT EXISTS "hs_receipt_seq"
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  NO CYCLE;
