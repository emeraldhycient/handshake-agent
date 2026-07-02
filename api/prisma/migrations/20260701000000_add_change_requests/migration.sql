-- Maker-checker change-request subsystem (ADM Phase 7). A sensitive platform
-- mutation is captured as a PENDING request by one admin and must be approved by a
-- DIFFERENT admin before it is applied through the target service's existing atomic,
-- idempotent, audited path (never a raw write). This table records the request +
-- its decision; the full decision trail lives in the hash-chained AuditLog.

-- CreateEnum
CREATE TYPE "change_request_kind" AS ENUM ('pricing_change', 'capability_flip', 'tier_override', 'refund');

-- CreateEnum
CREATE TYPE "change_request_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL,
    "kind" "change_request_kind" NOT NULL,
    "resource" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "change_request_status" NOT NULL DEFAULT 'pending',
    "reason" TEXT NOT NULL,
    "requestedByAdminId" UUID NOT NULL,
    "decidedByAdminId" UUID,
    "decisionReason" TEXT,
    "decidedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "change_requests_status_idx" ON "change_requests"("status");

-- CreateIndex
CREATE INDEX "change_requests_requestedByAdminId_idx" ON "change_requests"("requestedByAdminId");
