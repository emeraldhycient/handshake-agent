-- AlterTable
ALTER TABLE "users" ADD COLUMN     "preferredFiatCurrency" TEXT,
ADD COLUMN     "profilePhone" TEXT;

-- CreateTable
CREATE TABLE "personal_access_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMPTZ,
    "expiresAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "personal_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "personal_access_tokens_tokenHash_key" ON "personal_access_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "personal_access_tokens_userId_revokedAt_idx" ON "personal_access_tokens"("userId", "revokedAt");

-- AddForeignKey
ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
