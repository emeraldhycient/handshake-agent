-- Operator-applied TAG on an end user (Users directory bulk bar, ADM Phase 7). A
-- pure annotation: it moves NO money and confers NO authorization (§3.1). Tag
-- application is idempotent on the (userId, tag) unique; the full trail (who/when/
-- reason) lives in the hash-chained AuditLog. Cascade-deletes with the user.

-- CreateTable
CREATE TABLE "user_tags" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "appliedByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_tags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_tags_tag_idx" ON "user_tags"("tag");

-- CreateIndex
CREATE UNIQUE INDEX "user_tags_userId_tag_key" ON "user_tags"("userId", "tag");

-- AddForeignKey
ALTER TABLE "user_tags" ADD CONSTRAINT "user_tags_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
