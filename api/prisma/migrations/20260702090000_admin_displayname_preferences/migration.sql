-- AdminUser.displayName (optional; defaults to email local-part in app code).
ALTER TABLE "admin_users" ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '';

-- Per-admin notification preferences (self-scoped; audited on change).
CREATE TABLE "admin_preferences" (
    "adminId" UUID NOT NULL,
    "emailAlerts" BOOLEAN NOT NULL DEFAULT true,
    "approvalMentions" BOOLEAN NOT NULL DEFAULT true,
    "weeklyDigest" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "admin_preferences_pkey" PRIMARY KEY ("adminId")
);

ALTER TABLE "admin_preferences" ADD CONSTRAINT "admin_preferences_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
