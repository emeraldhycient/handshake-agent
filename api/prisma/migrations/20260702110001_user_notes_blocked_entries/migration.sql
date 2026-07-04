-- Phase 9: operator user-notes (append-only timeline annotations) + the append-only
-- blocked list (users/addresses/banks; lifted by supersession, never deleted).
CREATE TYPE "BlockedEntryKind" AS ENUM ('user', 'address', 'bank');

CREATE TABLE "admin_user_notes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "authorAdminId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_user_notes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "admin_user_notes_userId_idx" ON "admin_user_notes"("userId");

CREATE TABLE "blocked_entries" (
    "id" UUID NOT NULL,
    "kind" "BlockedEntryKind" NOT NULL,
    "value" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "addedByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ,
    "supersededByAdminId" UUID,
    CONSTRAINT "blocked_entries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "blocked_entries_kind_idx" ON "blocked_entries"("kind");
CREATE INDEX "blocked_entries_supersededAt_idx" ON "blocked_entries"("supersededAt");
