-- DropForeignKey
ALTER TABLE "handoff_tokens" DROP CONSTRAINT "handoff_tokens_userId_fkey";

-- AlterTable
ALTER TABLE "handoff_tokens" ADD COLUMN     "channelAddress" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "handoff_tokens_channelAddress_status_idx" ON "handoff_tokens"("channelAddress", "status");

-- AddForeignKey
ALTER TABLE "handoff_tokens" ADD CONSTRAINT "handoff_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
