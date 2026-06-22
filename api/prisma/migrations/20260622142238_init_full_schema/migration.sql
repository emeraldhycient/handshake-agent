-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "setting_scope" AS ENUM ('global', 'tier', 'provider');

-- CreateEnum
CREATE TYPE "outbox_message_status" AS ENUM ('pending', 'processing', 'published', 'failed');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('propose', 'confirm', 'authorize', 'execute', 'admin_update', 'admin_review', 'admin_override', 'sanctions_hit', 'aml_flag', 'rule_violation', 'kyc_state_change', 'beneficiary_add', 'beneficiary_remove', 'device_bind', 'pin_set', 'pin_reset', 'session_create', 'session_revoke', 'step_up_challenge', 'step_up_passed', 'config_change', 'audit_chain_check');

-- CreateEnum
CREATE TYPE "compliance_event_type" AS ENUM ('sanctions_hit', 'aml_rule_triggered', 'velocity_limit_exceeded', 'travel_rule_required', 'policy_override', 'kyc_escalation', 'fraud_signal', 'unusual_pattern');

-- CreateEnum
CREATE TYPE "severity" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "compliance_status" AS ENUM ('flagged', 'under_review', 'approved', 'blocked', 'dismissed');

-- CreateEnum
CREATE TYPE "screening_type" AS ENUM ('beneficiary_add', 'transaction_counterparty', 'identity_verification', 'periodic_recheck');

-- CreateEnum
CREATE TYPE "screening_provider" AS ENUM ('open_sanctions', 'trm');

-- CreateEnum
CREATE TYPE "screening_verdict" AS ENUM ('clear', 'hit', 'inconclusive');

-- CreateEnum
CREATE TYPE "aml_rule_type" AS ENUM ('velocity_amount', 'velocity_count', 'behavior_pattern', 'kyc_gate', 'rate_limit');

-- CreateEnum
CREATE TYPE "aml_rule_action" AS ENUM ('flag', 'block');

-- CreateEnum
CREATE TYPE "aml_rule_outcome" AS ENUM ('allowed', 'flagged', 'blocked');

-- CreateEnum
CREATE TYPE "travel_rule_party_type" AS ENUM ('individual', 'business', 'unknown');

-- CreateEnum
CREATE TYPE "travel_rule_trigger" AS ENUM ('amount_threshold', 'jurisdiction', 'policy_requirement', 'beneficiary_risk', 'other');

-- CreateEnum
CREATE TYPE "velocity_counter_type" AS ENUM ('amount_24h', 'amount_30d', 'count_24h', 'count_30d', 'first_use_24h');

-- CreateEnum
CREATE TYPE "compliance_report_type" AS ENUM ('sar', 'str');

-- CreateEnum
CREATE TYPE "compliance_report_status" AS ENUM ('draft', 'submitted', 'rejected', 'closed');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('provisional', 'active', 'suspended', 'deactivated');

-- CreateEnum
CREATE TYPE "kyc_status" AS ENUM ('not_started', 'pending', 'pending_review', 'verified', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "kyc_tier" AS ENUM ('unverified', 'tier_1', 'tier_2', 'tier_3');

-- CreateEnum
CREATE TYPE "id_document_type" AS ENUM ('passport', 'drivers_license', 'national_id');

-- CreateEnum
CREATE TYPE "liveness_check_result" AS ENUM ('not_attempted', 'pending', 'passed', 'failed');

-- CreateEnum
CREATE TYPE "device_trust_state" AS ENUM ('unbound', 'bound', 'revoked');

-- CreateEnum
CREATE TYPE "beneficiary_type" AS ENUM ('bank_account', 'crypto_address');

-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('pending', 'verified', 'failed', 'unverified', 'suspected_swap');

-- CreateEnum
CREATE TYPE "contact_status" AS ENUM ('active', 'blocked', 'undeliverable', 'unlinked');

-- CreateEnum
CREATE TYPE "admin_status" AS ENUM ('pending', 'active', 'suspended', 'offboarded');

-- CreateEnum
CREATE TYPE "resource_type" AS ENUM ('api_route', 'web_page', 'menu_item');

-- CreateEnum
CREATE TYPE "permission_action" AS ENUM ('read', 'write', 'delete', 'execute');

-- CreateEnum
CREATE TYPE "wallet_status" AS ENUM ('provisioning', 'active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "balance_source" AS ENUM ('provider_sync', 'deposit_webhook', 'manual_audit');

-- CreateEnum
CREATE TYPE "deposit_status" AS ENUM ('pending', 'confirmed', 'failed', 'disputed');

-- CreateEnum
CREATE TYPE "allow_list_mode" AS ENUM ('allow_all', 'allow_list_only', 'deny_list');

-- CreateEnum
CREATE TYPE "wallet_sync_status" AS ENUM ('success', 'timeout', 'error', 'rate_limited');

-- CreateEnum
CREATE TYPE "quote_type" AS ENUM ('buy', 'sell', 'swap');

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('valid', 'locked', 'expired', 'settled', 'rejected');

-- CreateEnum
CREATE TYPE "exposure_status" AS ENUM ('safe', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "treasury_snapshot_type" AS ENUM ('real_time', 'daily_snapshot');

-- CreateEnum
CREATE TYPE "alert_severity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "proposal_type" AS ENUM ('buy', 'sell', 'send', 'swap', 'ticket_purchase', 'add_beneficiary');

-- CreateEnum
CREATE TYPE "proposal_status" AS ENUM ('pending', 'confirmed', 'executing', 'executed', 'rejected', 'cancelled', 'expired', 'failed');

-- CreateEnum
CREATE TYPE "transaction_type" AS ENUM ('buy', 'sell', 'send', 'swap', 'ticket_purchase', 'reward', 'refund');

-- CreateEnum
CREATE TYPE "transaction_status" AS ENUM ('pending', 'validating', 'confirmed', 'settling', 'completed', 'failed', 'rolled_back', 'cancelled');

-- CreateEnum
CREATE TYPE "ledger_direction" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "ledger_account_type" AS ENUM ('user_wallet', 'platform_float', 'processor_settlement', 'treasury_reserve', 'clearing', 'compensation');

-- CreateEnum
CREATE TYPE "settlement_type" AS ENUM ('processor_collection', 'processor_payout', 'onchain_send', 'compensation');

-- CreateEnum
CREATE TYPE "settlement_outbox_status" AS ENUM ('pending', 'enqueued', 'in_progress', 'completed', 'failed', 'compensated', 'cancelled');

-- CreateEnum
CREATE TYPE "compensation_reason" AS ENUM ('settlement_failed', 'processor_error', 'duplicate_debit', 'operator_adjustment', 'promotion_reward');

-- CreateEnum
CREATE TYPE "compensation_status" AS ENUM ('pending', 'approved', 'issued', 'declined', 'cancelled');

-- CreateEnum
CREATE TYPE "directive_grant_status" AS ENUM ('issued', 'consumed', 'expired', 'failed', 'revoked', 'cancelled');

-- CreateEnum
CREATE TYPE "ui_component_ref" AS ENUM ('show_confirmation', 'request_pin', 'request_step_up', 'show_info_card', 'show_balance_card', 'show_receive_address_card', 'show_beneficiary_picker', 'show_kyc_wizard', 'show_quote_card', 'show_receipt_card');

-- CreateEnum
CREATE TYPE "directive_origin" AS ENUM ('engine', 'core', 'agent');

-- CreateEnum
CREATE TYPE "receipt_delivery_status" AS ENUM ('pending', 'sent', 'failed', 'delivered');

-- CreateEnum
CREATE TYPE "conversation_status" AS ENUM ('active', 'archived', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "message_processing_status" AS ENUM ('received', 'processing', 'processed', 'failed', 'duplicated');

-- CreateEnum
CREATE TYPE "intent_action" AS ENUM ('buy_crypto', 'sell_crypto', 'send_crypto', 'receive_crypto', 'swap', 'buy_ticket', 'check_balance', 'none');

-- CreateEnum
CREATE TYPE "reply_status" AS ENUM ('created', 'queued', 'sent', 'failed', 'delivered');

-- CreateEnum
CREATE TYPE "dispatch_status" AS ENUM ('queued', 'sent', 'delivered', 'failed', 'bounced');

-- CreateEnum
CREATE TYPE "handoff_purpose" AS ENUM ('kyc', 'confirmation', 'pin_reset', 'device_binding');

-- CreateEnum
CREATE TYPE "handoff_token_status" AS ENUM ('issued', 'redeemed', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "notification_event_type" AS ENUM ('transaction_pending', 'transaction_completed', 'transaction_failed', 'kyc_approved', 'kyc_rejected', 'kyc_pending_review', 'compliance_flag', 'compliance_resolved', 'receipt_ready', 'balance_update', 'beneficiary_added', 'beneficiary_verified', 'ticket_delivered', 'refund_issued', 'refund_pending', 'deposit_confirmed', 'withdrawal_initiated', 'pin_reset_initiated', 'device_added', 'suspicious_activity_alert');

-- CreateEnum
CREATE TYPE "ticket_payment_status" AS ENUM ('pending', 'collecting', 'collected', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "ticket_settlement_status" AS ENUM ('pending', 'settling', 'settled', 'settlement_failed', 'chargeback');

-- CreateEnum
CREATE TYPE "ticket_delivery_status" AS ENUM ('pending', 'delivering', 'delivered', 'delivery_failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ticket_refund_reason" AS ENUM ('user_requested', 'event_cancelled', 'delivery_failed', 'vendor_error', 'chargeback');

-- CreateEnum
CREATE TYPE "ticket_refund_status" AS ENUM ('pending', 'processing', 'completed', 'failed', 'disputed');

-- CreateEnum
CREATE TYPE "ticket_refund_method" AS ENUM ('wallet_credit', 'bank_transfer', 'original_method');

-- CreateEnum
CREATE TYPE "supported_asset" AS ENUM ('USDT', 'BTC');

-- CreateEnum
CREATE TYPE "fiat_currency" AS ENUM ('NGN');

-- CreateEnum
CREATE TYPE "network" AS ENUM ('TRON');

-- CreateEnum
CREATE TYPE "channel" AS ENUM ('whatsapp', 'web', 'email', 'sms', 'in_app');

-- CreateTable
CREATE TABLE "app_settings" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "scope" "setting_scope" NOT NULL DEFAULT 'global',
    "scopeValue" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "isEditable" BOOLEAN NOT NULL DEFAULT true,
    "updatedByAdminId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "id" UUID NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "outbox_message_status" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "correlationId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "actorUserId" UUID,
    "actorAdminId" UUID,
    "subject" TEXT NOT NULL,
    "action" "audit_action" NOT NULL,
    "details" JSONB NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "prevHash" CHAR(64) NOT NULL,
    "currentHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_events" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "transactionId" UUID,
    "eventType" "compliance_event_type" NOT NULL,
    "severity" "severity" NOT NULL,
    "screeningProvider" TEXT NOT NULL,
    "ruleOrHit" TEXT,
    "details" JSONB NOT NULL,
    "status" "compliance_status" NOT NULL DEFAULT 'flagged',
    "dispositionComment" TEXT,
    "dispositionAdminId" UUID,
    "dispositionAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "compliance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanctions_records" (
    "id" UUID NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "userId" UUID,
    "beneficiaryId" UUID,
    "screeningType" "screening_type" NOT NULL,
    "provider" "screening_provider" NOT NULL,
    "query" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "verdict" "screening_verdict" NOT NULL,
    "screeningCorrelationId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctions_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aml_rules" (
    "id" UUID NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "ruleType" "aml_rule_type" NOT NULL,
    "action" "aml_rule_action" NOT NULL,
    "parameters" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdByAdminId" UUID,
    "updatedByAdminId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "aml_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aml_rule_evaluations" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "triggered" BOOLEAN NOT NULL,
    "context" JSONB NOT NULL,
    "outcome" "aml_rule_outcome" NOT NULL,
    "evaluatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aml_rule_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_rule_data" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "originatorType" "travel_rule_party_type" NOT NULL,
    "originatorId" UUID,
    "originatorName" TEXT NOT NULL,
    "originatorAddress" TEXT NOT NULL,
    "originatorAccountNumber" TEXT NOT NULL,
    "beneficiaryType" "travel_rule_party_type" NOT NULL,
    "beneficiaryId" UUID,
    "beneficiaryName" TEXT,
    "beneficiaryAddress" TEXT,
    "beneficiaryAccountNumber" TEXT NOT NULL,
    "asset" "supported_asset" NOT NULL,
    "amount" TEXT NOT NULL,
    "amountFiat" DECIMAL(38,2) NOT NULL,
    "triggeringFactor" "travel_rule_trigger" NOT NULL,
    "capturedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedAt" TIMESTAMPTZ,

    CONSTRAINT "travel_rule_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "velocity_counters" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "counterType" "velocity_counter_type" NOT NULL,
    "currentValue" DECIMAL(38,18) NOT NULL,
    "windowStart" TIMESTAMPTZ NOT NULL,
    "windowEnd" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "velocity_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_reports" (
    "id" UUID NOT NULL,
    "reportType" "compliance_report_type" NOT NULL,
    "relatedEvents" TEXT[],
    "content" JSONB NOT NULL,
    "status" "compliance_report_status" NOT NULL DEFAULT 'draft',
    "submittedAt" TIMESTAMPTZ,
    "submissionRef" TEXT,
    "createdByAdminId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "compliance_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'provisional',
    "kycStatus" "kyc_status" NOT NULL DEFAULT 'not_started',
    "kycTier" "kyc_tier" NOT NULL DEFAULT 'unverified',
    "pinnedDeviceId" UUID,
    "pinHash" TEXT,
    "pinFailureCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMPTZ,
    "verifiedEmail" TEXT,
    "verifiedBackupPhone" TEXT,
    "simSwapDetectedAt" TIMESTAMPTZ,
    "lastTransactionAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_profiles" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "kyc_status" NOT NULL DEFAULT 'not_started',
    "tier" "kyc_tier" NOT NULL DEFAULT 'unverified',
    "nin" TEXT,
    "bvn" TEXT,
    "idDocumentType" "id_document_type",
    "idDocumentReference" TEXT,
    "livenessCheckResult" "liveness_check_result" NOT NULL DEFAULT 'not_attempted',
    "livenessCheckProviderId" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" DATE,
    "address" TEXT,
    "verifiedAt" TIMESTAMPTZ,
    "expiresAt" TIMESTAMPTZ,
    "rejectionReason" TEXT,
    "reviewedByAdminId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kyc_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "trustState" "device_trust_state" NOT NULL DEFAULT 'unbound',
    "userAgent" TEXT,
    "ipAddressAtBinding" TEXT,
    "boundAt" TIMESTAMPTZ,
    "lastUsedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "accessTokenHash" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceId" UUID,
    "channel" "channel" NOT NULL DEFAULT 'web',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "lastActivityAt" TIMESTAMPTZ,
    "revokedAt" TIMESTAMPTZ,
    "revokedReason" TEXT,
    "stepUpCompletedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beneficiaries" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "beneficiary_type" NOT NULL,
    "label" TEXT NOT NULL,
    "accountNumber" TEXT,
    "accountHolderName" TEXT,
    "bankCode" TEXT,
    "cryptoAddress" TEXT,
    "cryptoAsset" "supported_asset",
    "cryptoNetwork" "network",
    "verificationStatus" "verification_status" NOT NULL DEFAULT 'pending',
    "firstUseLockedUntil" TIMESTAMPTZ,
    "verifiedAt" TIMESTAMPTZ,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "beneficiaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "primaryChannel" "channel" NOT NULL,
    "primaryAddress" TEXT NOT NULL,
    "status" "contact_status" NOT NULL DEFAULT 'active',
    "linkedUserId" UUID,
    "fallbackEmail" TEXT,
    "fallbackPhoneAlt" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "lastSeenAt" TIMESTAMPTZ,
    "unsubscribedAt" TIMESTAMPTZ,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_identities" (
    "id" UUID NOT NULL,
    "channel" "channel" NOT NULL,
    "channelAddress" TEXT NOT NULL,
    "normalizedPhone" TEXT,
    "contactId" UUID,
    "userId" UUID,
    "verificationStatus" "verification_status" NOT NULL DEFAULT 'pending',
    "verifiedAt" TIMESTAMPTZ,
    "lastInboundAt" TIMESTAMPTZ,
    "simSwapDetectedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "channel_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "admin_status" NOT NULL DEFAULT 'pending',
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaRecoveryCodes" TEXT[],
    "roleId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMPTZ,
    "lastLoginAt" TIMESTAMPTZ,
    "suspendedAt" TIMESTAMPTZ,
    "offboardedAt" TIMESTAMPTZ,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" UUID NOT NULL,
    "adminUserId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "resourceType" "resource_type" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "action" "permission_action" NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission_assignments" (
    "id" UUID NOT NULL,
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permission_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_invitations" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "roleId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "acceptedAt" TIMESTAMPTZ,
    "createdByAdminId" UUID NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "asset" "supported_asset" NOT NULL,
    "network" "network" NOT NULL,
    "address" TEXT NOT NULL,
    "providerReference" TEXT NOT NULL,
    "status" "wallet_status" NOT NULL DEFAULT 'provisioning',
    "provisionedAt" TIMESTAMPTZ,
    "lastSyncedAt" TIMESTAMPTZ,
    "suspendedAt" TIMESTAMPTZ,
    "closedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_balances" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "assetDecimals" INTEGER NOT NULL,
    "source" "balance_source" NOT NULL,
    "syncedAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_confirmations" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "txHash" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "assetDecimals" INTEGER NOT NULL,
    "sourceAddress" TEXT,
    "status" "deposit_status" NOT NULL DEFAULT 'pending',
    "blockHeight" BIGINT,
    "confirmations" INTEGER NOT NULL DEFAULT 0,
    "webhookId" TEXT,
    "notificationId" UUID,
    "auditLogId" UUID,
    "detectedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_policies" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "maxWithdrawalPerTx" DECIMAL(38,18),
    "maxWithdrawalPerDay" DECIMAL(38,18),
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "allowListMode" "allow_list_mode" NOT NULL DEFAULT 'allow_all',
    "description" TEXT,
    "enabledAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disabledAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "withdrawal_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_sync_logs" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ NOT NULL,
    "respondedAt" TIMESTAMPTZ,
    "latencyMs" INTEGER,
    "status" "wallet_sync_status" NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "fetchedBalance" DECIMAL(38,18),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "quote_type" NOT NULL,
    "asset" "supported_asset" NOT NULL,
    "fiatCurrency" "fiat_currency" NOT NULL DEFAULT 'NGN',
    "fiatAmount" DECIMAL(38,2) NOT NULL,
    "cryptoAmount" TEXT NOT NULL,
    "fxRate" TEXT NOT NULL,
    "baseRate" TEXT NOT NULL,
    "networkFeeCrypto" TEXT,
    "spreadBps" INTEGER NOT NULL,
    "processingFeeBps" INTEGER NOT NULL,
    "processingFeeAmount" DECIMAL(38,2) NOT NULL,
    "rateSource" TEXT,
    "quotedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "status" "quote_status" NOT NULL DEFAULT 'valid',
    "lockedAt" TIMESTAMPTZ,
    "lockedUntil" TIMESTAMPTZ,
    "idempotencyKey" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" UUID NOT NULL,
    "asset" "supported_asset" NOT NULL,
    "fiatCurrency" "fiat_currency" NOT NULL,
    "baseRate" TEXT NOT NULL,
    "spreadBps" INTEGER NOT NULL,
    "processingFeeBps" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "capturedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_exposures" (
    "id" UUID NOT NULL,
    "asset" "supported_asset" NOT NULL,
    "fiatCurrency" "fiat_currency" NOT NULL,
    "cryptoHeld" TEXT NOT NULL,
    "fiatEquivalent" DECIMAL(38,2) NOT NULL,
    "fiatReserve" DECIMAL(38,2) NOT NULL,
    "netExposure" DECIMAL(38,2) NOT NULL,
    "exposureLimitBps" INTEGER NOT NULL,
    "alertThresholdBps" INTEGER NOT NULL,
    "status" "exposure_status" NOT NULL DEFAULT 'safe',
    "snapshotType" "treasury_snapshot_type" NOT NULL DEFAULT 'real_time',
    "lastAlertAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "treasury_exposures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "treasury_alerts" (
    "id" UUID NOT NULL,
    "exposureId" UUID NOT NULL,
    "asset" "supported_asset" NOT NULL,
    "severity" "alert_severity" NOT NULL,
    "message" TEXT NOT NULL,
    "netExposure" DECIMAL(38,2) NOT NULL,
    "exposureLimit" DECIMAL(38,2) NOT NULL,
    "triggeredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMPTZ,
    "acknowledgedByAdminId" UUID,
    "acknowledgmentNote" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treasury_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "conversationId" UUID,
    "intentId" UUID,
    "type" "proposal_type" NOT NULL,
    "status" "proposal_status" NOT NULL DEFAULT 'pending',
    "parameters" JSONB NOT NULL,
    "parametersChecksum" TEXT NOT NULL,
    "quoteId" UUID,
    "idempotencyKey" UUID,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "confirmedAt" TIMESTAMPTZ,
    "executedAt" TIMESTAMPTZ,
    "rejectedAt" TIMESTAMPTZ,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "proposalId" UUID,
    "userId" UUID NOT NULL,
    "type" "transaction_type" NOT NULL,
    "status" "transaction_status" NOT NULL DEFAULT 'pending',
    "idempotencyKey" UUID NOT NULL,
    "requestChecksum" TEXT NOT NULL,
    "balanceChecksum" TEXT,
    "fxRateSnapshot" DECIMAL(38,18),
    "metadata" JSONB NOT NULL,
    "onChainTxHash" TEXT,
    "processorTxRef" TEXT,
    "pinVerifiedAt" TIMESTAMPTZ,
    "stepUpVerifiedAt" TIMESTAMPTZ,
    "executedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "failedAt" TIMESTAMPTZ,
    "failureReason" TEXT,
    "failureRecoveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountType" "ledger_account_type" NOT NULL,
    "accountId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "direction" "ledger_direction" NOT NULL,
    "description" TEXT NOT NULL,
    "balanceAfter" DECIMAL(38,18) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "postedAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_outbox" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "settlementType" "settlement_type" NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" UUID,
    "status" "settlement_outbox_status" NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "processorRef" TEXT,
    "webhookVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastAttemptAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compensation_records" (
    "id" UUID NOT NULL,
    "originatingTransactionId" UUID NOT NULL,
    "compensationTransactionId" UUID,
    "userId" UUID NOT NULL,
    "reason" "compensation_reason" NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "compensation_status" NOT NULL DEFAULT 'pending',
    "approvedByAdminId" UUID,
    "approvalComment" TEXT,
    "issuedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "compensation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "directive_grants" (
    "id" UUID NOT NULL,
    "directiveId" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "directiveRef" "ui_component_ref" NOT NULL,
    "origin" "directive_origin" NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "signatureValue" TEXT NOT NULL,
    "status" "directive_grant_status" NOT NULL DEFAULT 'issued',
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,
    "consumedProposalId" UUID,
    "failureReason" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "directive_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "itemized" JSONB NOT NULL,
    "htmlContent" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "pdfBlob" BYTEA,
    "contentHash" TEXT NOT NULL,
    "signatureHash" TEXT NOT NULL,
    "auditLogId" UUID,
    "deliveryStatus" "receipt_delivery_status" NOT NULL DEFAULT 'pending',
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "contactId" UUID,
    "userId" UUID,
    "language" TEXT NOT NULL DEFAULT 'en',
    "status" "conversation_status" NOT NULL DEFAULT 'active',
    "lastMessageAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rawUserText" TEXT NOT NULL,
    "language" TEXT,
    "processingStatus" "message_processing_status" NOT NULL DEFAULT 'received',
    "processedAt" TIMESTAMPTZ,
    "errorReason" TEXT,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correlationId" TEXT NOT NULL,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_intents" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "action" "intent_action" NOT NULL,
    "payload" JSONB NOT NULL,
    "language" TEXT,
    "extractionConfidence" DECIMAL(3,2),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_replies" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "messageId" UUID,
    "text" TEXT NOT NULL,
    "directives" JSONB[],
    "handoffTokenId" UUID,
    "templateRef" TEXT,
    "status" "reply_status" NOT NULL DEFAULT 'created',
    "sentAt" TIMESTAMPTZ,
    "deliveredAt" TIMESTAMPTZ,
    "failureReason" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_outbound_dispatches" (
    "id" UUID NOT NULL,
    "replyId" UUID NOT NULL,
    "channel" "channel" NOT NULL,
    "externalMessageId" TEXT,
    "status" "dispatch_status" NOT NULL DEFAULT 'queued',
    "queuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ,
    "deliveredAt" TIMESTAMPTZ,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "nextRetryAt" TIMESTAMPTZ,
    "failoverTriggeredAt" TIMESTAMPTZ,
    "failoverTriggeredByDispatchId" UUID,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_outbound_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handoff_tokens" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "conversationId" UUID,
    "purpose" "handoff_purpose" NOT NULL,
    "status" "handoff_token_status" NOT NULL DEFAULT 'issued',
    "issuedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "redeemedAt" TIMESTAMPTZ,
    "redeemedIp" TEXT,
    "redeemedUserAgent" TEXT,

    CONSTRAINT "handoff_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventType" "notification_event_type" NOT NULL,
    "eventRef" TEXT NOT NULL,
    "primaryChannel" "channel" NOT NULL DEFAULT 'whatsapp',
    "templateKey" TEXT,
    "templateVars" JSONB NOT NULL,
    "deliveryLog" JSONB NOT NULL DEFAULT '[]',
    "isDisableable" BOOLEAN NOT NULL DEFAULT true,
    "isSent" BOOLEAN NOT NULL DEFAULT false,
    "isFailed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventType" "notification_event_type" NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "preferredChannels" JSONB NOT NULL DEFAULT '["whatsapp","email"]',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "templateKey" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "channel" "channel" NOT NULL,
    "subject" TEXT,
    "contentText" TEXT NOT NULL,
    "contentHtml" TEXT,
    "whatsappTemplateId" TEXT,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "updatedByAdminId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_orders" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "eventId" TEXT NOT NULL,
    "vendorKey" TEXT NOT NULL,
    "ticketType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(38,2) NOT NULL,
    "platformFee" DECIMAL(38,2) NOT NULL,
    "totalAmount" DECIMAL(38,2) NOT NULL,
    "quoteId" UUID,
    "paymentStatus" "ticket_payment_status" NOT NULL DEFAULT 'pending',
    "settlementStatus" "ticket_settlement_status" NOT NULL DEFAULT 'pending',
    "deliveryStatus" "ticket_delivery_status" NOT NULL DEFAULT 'pending',
    "vendorOrderId" TEXT,
    "providerResponse" JSONB,
    "ticketDelivery" JSONB,
    "idempotencyKey" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedAt" TIMESTAMPTZ,
    "settledAt" TIMESTAMPTZ,
    "deliveredAt" TIMESTAMPTZ,

    CONSTRAINT "ticket_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_refunds" (
    "id" UUID NOT NULL,
    "ticketOrderId" UUID NOT NULL,
    "reason" "ticket_refund_reason" NOT NULL,
    "status" "ticket_refund_status" NOT NULL DEFAULT 'pending',
    "refundAmount" DECIMAL(38,2) NOT NULL,
    "refundReason" TEXT NOT NULL,
    "vendorRefundId" TEXT,
    "userRefundMethod" "ticket_refund_method" NOT NULL DEFAULT 'wallet_credit',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ,

    CONSTRAINT "ticket_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_settings_key_isEditable_idx" ON "app_settings"("key", "isEditable");

-- CreateIndex
CREATE UNIQUE INDEX "app_settings_key_scope_scopeValue_key" ON "app_settings"("key", "scope", "scopeValue");

-- CreateIndex
CREATE INDEX "outbox_messages_status_availableAt_idx" ON "outbox_messages"("status", "availableAt");

-- CreateIndex
CREATE INDEX "outbox_messages_aggregateType_aggregateId_idx" ON "outbox_messages"("aggregateType", "aggregateId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_currentHash_key" ON "audit_logs"("currentHash");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorAdminId_createdAt_idx" ON "audit_logs"("actorAdminId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_subject_action_createdAt_idx" ON "audit_logs"("subject", "action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_correlationId_action_currentHash_key" ON "audit_logs"("correlationId", "action", "currentHash");

-- CreateIndex
CREATE INDEX "compliance_events_userId_status_createdAt_idx" ON "compliance_events"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "compliance_events_status_severity_createdAt_idx" ON "compliance_events"("status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "compliance_events_eventType_dispositionAt_idx" ON "compliance_events"("eventType", "dispositionAt");

-- CreateIndex
CREATE INDEX "sanctions_records_counterpartyId_createdAt_idx" ON "sanctions_records"("counterpartyId", "createdAt");

-- CreateIndex
CREATE INDEX "sanctions_records_verdict_createdAt_idx" ON "sanctions_records"("verdict", "createdAt");

-- CreateIndex
CREATE INDEX "sanctions_records_provider_createdAt_idx" ON "sanctions_records"("provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "aml_rules_ruleKey_key" ON "aml_rules"("ruleKey");

-- CreateIndex
CREATE INDEX "aml_rules_enabled_ruleType_idx" ON "aml_rules"("enabled", "ruleType");

-- CreateIndex
CREATE INDEX "aml_rule_evaluations_transactionId_ruleId_idx" ON "aml_rule_evaluations"("transactionId", "ruleId");

-- CreateIndex
CREATE INDEX "aml_rule_evaluations_userId_evaluatedAt_idx" ON "aml_rule_evaluations"("userId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "aml_rule_evaluations_ruleId_outcome_evaluatedAt_idx" ON "aml_rule_evaluations"("ruleId", "outcome", "evaluatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "travel_rule_data_transactionId_key" ON "travel_rule_data"("transactionId");

-- CreateIndex
CREATE INDEX "travel_rule_data_originatorId_capturedAt_idx" ON "travel_rule_data"("originatorId", "capturedAt");

-- CreateIndex
CREATE INDEX "travel_rule_data_beneficiaryAccountNumber_idx" ON "travel_rule_data"("beneficiaryAccountNumber");

-- CreateIndex
CREATE INDEX "travel_rule_data_reportedAt_idx" ON "travel_rule_data"("reportedAt");

-- CreateIndex
CREATE INDEX "velocity_counters_userId_windowEnd_idx" ON "velocity_counters"("userId", "windowEnd");

-- CreateIndex
CREATE INDEX "velocity_counters_updatedAt_idx" ON "velocity_counters"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "velocity_counters_userId_counterType_key" ON "velocity_counters"("userId", "counterType");

-- CreateIndex
CREATE INDEX "compliance_reports_reportType_status_submittedAt_idx" ON "compliance_reports"("reportType", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "compliance_reports_createdAt_idx" ON "compliance_reports"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_pinnedDeviceId_key" ON "users"("pinnedDeviceId");

-- CreateIndex
CREATE UNIQUE INDEX "users_verifiedEmail_key" ON "users"("verifiedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "users_verifiedBackupPhone_key" ON "users"("verifiedBackupPhone");

-- CreateIndex
CREATE INDEX "users_status_createdAt_idx" ON "users"("status", "createdAt");

-- CreateIndex
CREATE INDEX "users_kycStatus_kycTier_idx" ON "users"("kycStatus", "kycTier");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_profiles_userId_key" ON "kyc_profiles"("userId");

-- CreateIndex
CREATE INDEX "kyc_profiles_status_tier_idx" ON "kyc_profiles"("status", "tier");

-- CreateIndex
CREATE INDEX "kyc_profiles_expiresAt_idx" ON "kyc_profiles"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "devices_fingerprint_key" ON "devices"("fingerprint");

-- CreateIndex
CREATE INDEX "devices_userId_trustState_idx" ON "devices"("userId", "trustState");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_accessTokenHash_key" ON "sessions"("accessTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_isActive_idx" ON "sessions"("userId", "isActive");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "beneficiaries_userId_deletedAt_idx" ON "beneficiaries"("userId", "deletedAt");

-- CreateIndex
CREATE INDEX "beneficiaries_userId_type_isDefault_deletedAt_idx" ON "beneficiaries"("userId", "type", "isDefault", "deletedAt");

-- CreateIndex
CREATE INDEX "beneficiaries_firstUseLockedUntil_idx" ON "beneficiaries"("firstUseLockedUntil");

-- CreateIndex
CREATE INDEX "contacts_linkedUserId_idx" ON "contacts"("linkedUserId");

-- CreateIndex
CREATE INDEX "contacts_lastSeenAt_idx" ON "contacts"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_primaryChannel_primaryAddress_key" ON "contacts"("primaryChannel", "primaryAddress");

-- CreateIndex
CREATE INDEX "channel_identities_channel_channelAddress_deletedAt_idx" ON "channel_identities"("channel", "channelAddress", "deletedAt");

-- CreateIndex
CREATE INDEX "channel_identities_userId_channel_deletedAt_idx" ON "channel_identities"("userId", "channel", "deletedAt");

-- CreateIndex
CREATE INDEX "channel_identities_normalizedPhone_channel_deletedAt_idx" ON "channel_identities"("normalizedPhone", "channel", "deletedAt");

-- CreateIndex
CREATE INDEX "channel_identities_simSwapDetectedAt_idx" ON "channel_identities"("simSwapDetectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_status_idx" ON "admin_users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_tokenHash_key" ON "admin_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "admin_sessions_adminUserId_idx" ON "admin_sessions"("adminUserId");

-- CreateIndex
CREATE INDEX "admin_sessions_expiresAt_idx" ON "admin_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE INDEX "roles_isBuiltin_idx" ON "roles"("isBuiltin");

-- CreateIndex
CREATE INDEX "permissions_resourceType_resourceId_idx" ON "permissions"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "permissions_category_idx" ON "permissions"("category");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_resourceType_resourceId_action_key" ON "permissions"("resourceType", "resourceId", "action");

-- CreateIndex
CREATE INDEX "role_permission_assignments_roleId_idx" ON "role_permission_assignments"("roleId");

-- CreateIndex
CREATE INDEX "role_permission_assignments_permissionId_idx" ON "role_permission_assignments"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_assignments_roleId_permissionId_key" ON "role_permission_assignments"("roleId", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_invitations_tokenHash_key" ON "admin_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "admin_invitations_email_idx" ON "admin_invitations"("email");

-- CreateIndex
CREATE INDEX "admin_invitations_expiresAt_idx" ON "admin_invitations"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_address_key" ON "wallets"("address");

-- CreateIndex
CREATE INDEX "wallets_userId_idx" ON "wallets"("userId");

-- CreateIndex
CREATE INDEX "wallets_asset_network_status_idx" ON "wallets"("asset", "network", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_asset_network_key" ON "wallets"("userId", "asset", "network");

-- CreateIndex
CREATE INDEX "wallet_balances_walletId_syncedAt_idx" ON "wallet_balances"("walletId", "syncedAt");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_confirmations_txHash_key" ON "deposit_confirmations"("txHash");

-- CreateIndex
CREATE INDEX "deposit_confirmations_walletId_confirmedAt_idx" ON "deposit_confirmations"("walletId", "confirmedAt");

-- CreateIndex
CREATE INDEX "deposit_confirmations_webhookId_idx" ON "deposit_confirmations"("webhookId");

-- CreateIndex
CREATE INDEX "deposit_confirmations_status_idx" ON "deposit_confirmations"("status");

-- CreateIndex
CREATE INDEX "withdrawal_policies_walletId_disabledAt_idx" ON "withdrawal_policies"("walletId", "disabledAt");

-- CreateIndex
CREATE INDEX "wallet_sync_logs_walletId_requestedAt_idx" ON "wallet_sync_logs"("walletId", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_idempotencyKey_key" ON "quotes"("idempotencyKey");

-- CreateIndex
CREATE INDEX "quotes_userId_status_createdAt_idx" ON "quotes"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "quotes_status_expiresAt_idx" ON "quotes"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "price_snapshots_asset_fiatCurrency_capturedAt_idx" ON "price_snapshots"("asset", "fiatCurrency", "capturedAt");

-- CreateIndex
CREATE INDEX "price_snapshots_source_capturedAt_idx" ON "price_snapshots"("source", "capturedAt");

-- CreateIndex
CREATE INDEX "treasury_exposures_asset_fiatCurrency_updatedAt_idx" ON "treasury_exposures"("asset", "fiatCurrency", "updatedAt");

-- CreateIndex
CREATE INDEX "treasury_exposures_status_updatedAt_idx" ON "treasury_exposures"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "treasury_exposures_asset_fiatCurrency_snapshotType_key" ON "treasury_exposures"("asset", "fiatCurrency", "snapshotType");

-- CreateIndex
CREATE INDEX "treasury_alerts_severity_triggeredAt_idx" ON "treasury_alerts"("severity", "triggeredAt");

-- CreateIndex
CREATE INDEX "treasury_alerts_asset_triggeredAt_idx" ON "treasury_alerts"("asset", "triggeredAt");

-- CreateIndex
CREATE INDEX "treasury_alerts_acknowledgedAt_idx" ON "treasury_alerts"("acknowledgedAt");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_intentId_key" ON "proposals"("intentId");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_quoteId_key" ON "proposals"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_idempotencyKey_key" ON "proposals"("idempotencyKey");

-- CreateIndex
CREATE INDEX "proposals_userId_status_createdAt_idx" ON "proposals"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "proposals_status_expiresAt_idx" ON "proposals"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "proposals_conversationId_createdAt_idx" ON "proposals"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_proposalId_key" ON "transactions"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_idempotencyKey_key" ON "transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "transactions_userId_status_createdAt_idx" ON "transactions"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_status_createdAt_idx" ON "transactions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_proposalId_idx" ON "transactions"("proposalId");

-- CreateIndex
CREATE INDEX "ledger_entries_accountType_accountId_postedAt_idx" ON "ledger_entries"("accountType", "accountId", "postedAt");

-- CreateIndex
CREATE INDEX "ledger_entries_transactionId_idx" ON "ledger_entries"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_accountType_accountId_sequence_key" ON "ledger_entries"("accountType", "accountId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_outbox_idempotencyKey_key" ON "settlement_outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "settlement_outbox_status_createdAt_idx" ON "settlement_outbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "settlement_outbox_processorRef_idx" ON "settlement_outbox"("processorRef");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_outbox_transactionId_settlementType_key" ON "settlement_outbox"("transactionId", "settlementType");

-- CreateIndex
CREATE UNIQUE INDEX "compensation_records_compensationTransactionId_key" ON "compensation_records"("compensationTransactionId");

-- CreateIndex
CREATE INDEX "compensation_records_userId_issuedAt_idx" ON "compensation_records"("userId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "compensation_records_originatingTransactionId_key" ON "compensation_records"("originatingTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "directive_grants_directiveId_key" ON "directive_grants"("directiveId");

-- CreateIndex
CREATE UNIQUE INDEX "directive_grants_nonceHash_key" ON "directive_grants"("nonceHash");

-- CreateIndex
CREATE INDEX "directive_grants_userId_status_idx" ON "directive_grants"("userId", "status");

-- CreateIndex
CREATE INDEX "directive_grants_expiresAt_idx" ON "directive_grants"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "directive_grants_proposalId_directiveRef_key" ON "directive_grants"("proposalId", "directiveRef");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_transactionId_key" ON "receipts"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_receiptNumber_key" ON "receipts"("receiptNumber");

-- CreateIndex
CREATE INDEX "receipts_userId_issuedAt_idx" ON "receipts"("userId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_contactId_key" ON "conversations"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_userId_key" ON "conversations"("userId");

-- CreateIndex
CREATE INDEX "conversations_lastMessageAt_idx" ON "conversations"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_externalMessageId_key" ON "conversation_messages"("externalMessageId");

-- CreateIndex
CREATE INDEX "conversation_messages_conversationId_processingStatus_idx" ON "conversation_messages"("conversationId", "processingStatus");

-- CreateIndex
CREATE INDEX "conversation_messages_receivedAt_idx" ON "conversation_messages"("receivedAt");

-- CreateIndex
CREATE INDEX "conversation_messages_correlationId_idx" ON "conversation_messages"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "message_intents_messageId_key" ON "message_intents"("messageId");

-- CreateIndex
CREATE INDEX "message_intents_conversationId_idx" ON "message_intents"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_replies_messageId_key" ON "conversation_replies"("messageId");

-- CreateIndex
CREATE INDEX "conversation_replies_conversationId_createdAt_idx" ON "conversation_replies"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "conversation_replies_correlationId_idx" ON "conversation_replies"("correlationId");

-- CreateIndex
CREATE INDEX "channel_outbound_dispatches_status_nextRetryAt_idx" ON "channel_outbound_dispatches"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "channel_outbound_dispatches_replyId_channel_idx" ON "channel_outbound_dispatches"("replyId", "channel");

-- CreateIndex
CREATE INDEX "channel_outbound_dispatches_correlationId_idx" ON "channel_outbound_dispatches"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "handoff_tokens_tokenHash_key" ON "handoff_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "handoff_tokens_userId_status_idx" ON "handoff_tokens"("userId", "status");

-- CreateIndex
CREATE INDEX "handoff_tokens_expiresAt_idx" ON "handoff_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "notifications_userId_eventType_idx" ON "notifications"("userId", "eventType");

-- CreateIndex
CREATE INDEX "notifications_createdAt_isSent_isFailed_idx" ON "notifications"("createdAt", "isSent", "isFailed");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_eventRef_eventType_key" ON "notifications"("eventRef", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_eventType_key" ON "notification_preferences"("userId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_templateKey_language_channel_key" ON "notification_templates"("templateKey", "language", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_orders_idempotencyKey_key" ON "ticket_orders"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ticket_orders_userId_createdAt_idx" ON "ticket_orders"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_orders_vendorKey_vendorOrderId_idx" ON "ticket_orders"("vendorKey", "vendorOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_refunds_ticketOrderId_key" ON "ticket_refunds"("ticketOrderId");

-- AddForeignKey
ALTER TABLE "compliance_events" ADD CONSTRAINT "compliance_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_events" ADD CONSTRAINT "compliance_events_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aml_rule_evaluations" ADD CONSTRAINT "aml_rule_evaluations_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "aml_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_rule_data" ADD CONSTRAINT "travel_rule_data_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "velocity_counters" ADD CONSTRAINT "velocity_counters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_pinnedDeviceId_fkey" FOREIGN KEY ("pinnedDeviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_profiles" ADD CONSTRAINT "kyc_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_identities" ADD CONSTRAINT "channel_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission_assignments" ADD CONSTRAINT "role_permission_assignments_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission_assignments" ADD CONSTRAINT "role_permission_assignments_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_invitations" ADD CONSTRAINT "admin_invitations_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_balances" ADD CONSTRAINT "wallet_balances_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_confirmations" ADD CONSTRAINT "deposit_confirmations_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_policies" ADD CONSTRAINT "withdrawal_policies_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_sync_logs" ADD CONSTRAINT "wallet_sync_logs_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treasury_alerts" ADD CONSTRAINT "treasury_alerts_exposureId_fkey" FOREIGN KEY ("exposureId") REFERENCES "treasury_exposures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "message_intents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_outbox" ADD CONSTRAINT "settlement_outbox_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation_records" ADD CONSTRAINT "compensation_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation_records" ADD CONSTRAINT "compensation_records_originatingTransactionId_fkey" FOREIGN KEY ("originatingTransactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compensation_records" ADD CONSTRAINT "compensation_records_compensationTransactionId_fkey" FOREIGN KEY ("compensationTransactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directive_grants" ADD CONSTRAINT "directive_grants_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "directive_grants" ADD CONSTRAINT "directive_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_intents" ADD CONSTRAINT "message_intents_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "conversation_messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_replies" ADD CONSTRAINT "conversation_replies_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_replies" ADD CONSTRAINT "conversation_replies_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "conversation_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_outbound_dispatches" ADD CONSTRAINT "channel_outbound_dispatches_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "conversation_replies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_tokens" ADD CONSTRAINT "handoff_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_tokens" ADD CONSTRAINT "handoff_tokens_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_orders" ADD CONSTRAINT "ticket_orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_refunds" ADD CONSTRAINT "ticket_refunds_ticketOrderId_fkey" FOREIGN KEY ("ticketOrderId") REFERENCES "ticket_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Hand-added constraints Prisma cannot express in schema.prisma (see schema NOTEs).
-- ============================================================================

-- Partial UNIQUE: exactly one ACTIVE ChannelIdentity per (channel, channelAddress).
-- A composite unique including the nullable "deletedAt" would be defeated by
-- NULL-distinctness in Postgres, so the active-row guarantee is a partial index.
CREATE UNIQUE INDEX "channel_identities_active_channel_address_key"
  ON "channel_identities" ("channel", "channelAddress")
  WHERE "deletedAt" IS NULL;

-- Partial UNIQUE: a user cannot save the same crypto address twice among active rows.
CREATE UNIQUE INDEX "beneficiaries_active_user_crypto_address_key"
  ON "beneficiaries" ("userId", "cryptoAddress")
  WHERE "type" = 'crypto_address' AND "deletedAt" IS NULL AND "cryptoAddress" IS NOT NULL;

-- A Conversation is keyed on exactly one resolved identity: Contact XOR User
-- (ADR-0004 identity-keyed thread).
ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_contact_xor_user"
  CHECK (("contactId" IS NOT NULL AND "userId" IS NULL)
      OR ("contactId" IS NULL AND "userId" IS NOT NULL));
