-- Comms BROADCAST SEND (ADM Phase 7, WRITES). An operator dispatches a message to
-- an audience cohort through the notifications outbox; a LARGE audience is deferred
-- to a second admin via the maker-checker change-request subsystem (§3.5). A
-- broadcast moves no money (§3.1). Two additive enum values back this:
--   change_request_kind += 'notification_broadcast'  (the deferred-blast approval kind)
--   notification_event_type += 'broadcast'           (the per-recipient outbox rows)
--
-- Note: Postgres cannot add an enum value inside a transaction that also uses it, so
-- the ALTER TYPE statements stand alone (Prisma runs each migration statement-wise).

-- AlterEnum
ALTER TYPE "change_request_kind" ADD VALUE IF NOT EXISTS 'notification_broadcast';

-- AlterEnum
ALTER TYPE "notification_event_type" ADD VALUE IF NOT EXISTS 'broadcast';
