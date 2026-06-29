-- AlterEnum
-- Adds the read-only `query_transactions` intent action so MessageIntent rows
-- can record transaction-history queries (mirrors @handshake-agent/contracts IntentSchema).
ALTER TYPE "intent_action" ADD VALUE 'query_transactions';
