-- Per-account admin-login lockout (CLAUDE.md §3.3): a credential-stuffing /
-- password-spray guard. failedLoginCount is incremented atomically before the
-- password verify; loginLockedUntil refuses login while in the future.
ALTER TABLE "admin_users" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "admin_users" ADD COLUMN     "loginLockedUntil" TIMESTAMPTZ;
