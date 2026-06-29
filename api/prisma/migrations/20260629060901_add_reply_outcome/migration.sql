-- AlterTable: persist the rendered AgentTurnOutcome on web-chat replies so the
-- web thread can be reconstructed on reload (GET /chat/messages).
ALTER TABLE "conversation_replies" ADD COLUMN     "outcome" JSONB;
