-- AlterEnum
-- Add the read-only rate-discovery intent actions the agent already emits
-- (get_rate / list_rates, contracts IntentSchema) to the DB enum. Without
-- these, persisting a resolved rate intent throws PrismaClientValidationError
-- and 500s the whole chat turn ("the rates tool doesn't work").
ALTER TYPE "intent_action" ADD VALUE IF NOT EXISTS 'get_rate';
ALTER TYPE "intent_action" ADD VALUE IF NOT EXISTS 'list_rates';
