-- Phase 8 (CSV exports): a new audit action for PII-minimised list exports.
--   audit_action += 'admin_export'
--
-- Every Users/Ledger/Audit CSV export records an immutable `admin_export` event
-- (who exported what list, when, rowCount + filters) — never the exported data,
-- and the rows carry last-4 PII only (root CLAUDE.md §3.4). Additive enum value
-- only; no data migration. Stands alone (Postgres cannot add an enum value inside
-- a transaction that later uses it); `IF NOT EXISTS` makes re-runs safe.
ALTER TYPE "audit_action" ADD VALUE IF NOT EXISTS 'admin_export';
