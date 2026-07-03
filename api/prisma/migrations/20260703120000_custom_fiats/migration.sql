-- Runtime admin-added fiat currencies (the "Add currency" feature). Layered over the
-- JSON-default catalog via the AssetRegistry overlay; enabling stays fail-closed
-- (requires pricing, re-checked server-side). A custom fiat moves no money itself.
CREATE TABLE "custom_fiats" (
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL DEFAULT 2,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "addedByAdminId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "custom_fiats_pkey" PRIMARY KEY ("code")
);
