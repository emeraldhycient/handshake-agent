-- CreateEnum
CREATE TYPE "auth_challenge_type" AS ENUM ('email_verification', 'otp_email');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email" TEXT,
ADD COLUMN     "emailVerifiedAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "auth_challenges" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "auth_challenge_type" NOT NULL,
    "challengeHash" TEXT NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "verifiedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "auth_challenges_expiresAt_idx" ON "auth_challenges"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_challenges_userId_type_key" ON "auth_challenges"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "auth_challenges" ADD CONSTRAINT "auth_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
