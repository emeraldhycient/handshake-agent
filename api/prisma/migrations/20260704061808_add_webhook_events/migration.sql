-- CreateEnum
CREATE TYPE "webhook_provider" AS ENUM ('blockradar', 'flutterwave', 'whatsapp');

-- CreateEnum
CREATE TYPE "webhook_event_status" AS ENUM ('received', 'processing', 'succeeded', 'failed', 'dead');

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" "webhook_provider" NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL,
    "signature" TEXT,
    "status" "webhook_event_status" NOT NULL DEFAULT 'received',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMPTZ,
    "processedAt" TIMESTAMPTZ,
    "deadAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_events_status_receivedAt_idx" ON "webhook_events"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "webhook_events_provider_status_receivedAt_idx" ON "webhook_events"("provider", "status", "receivedAt");

-- CreateIndex
CREATE INDEX "webhook_events_receivedAt_id_idx" ON "webhook_events"("receivedAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_providerEventId_key" ON "webhook_events"("provider", "providerEventId");
