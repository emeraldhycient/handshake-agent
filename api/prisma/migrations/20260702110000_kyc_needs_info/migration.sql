-- Phase 9 (KYC "Request info"): a new KYC status the operator can set to ask a user
-- for more information. Additive enum value only; stands alone (Postgres cannot add
-- an enum value inside a transaction that later uses it); IF NOT EXISTS is idempotent.
ALTER TYPE "kyc_status" ADD VALUE IF NOT EXISTS 'needs_info';
