import { Module, type OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { WalletsModule } from '../wallets/wallets.module';
import { IdentityModule } from '../identity/identity.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationTemplateSeedService } from '../notifications/application/notification-template-seed.service';
import { ConversationsModule } from '../conversations/conversations.module';
import { AuthModule } from '../../core/auth/auth.module';
import { PIN_REPOSITORY } from '../../core/auth/ports/pin.repository.port';
import { PinPrismaRepository } from '../../core/auth/infrastructure/pin.prisma.repository';
import { AdminTokenGuard } from './guards/admin-token.guard';
import { AdminWalletsController } from './presentation/admin-wallets.controller';
import { WalletBackfillService } from '../wallets/application/wallet-backfill.service';
import { WalletReconciliationService } from '../wallets/application/wallet-reconciliation.service';
import { BullBoardBasicAuthMiddleware } from './bull-board.middleware';
import { ECHO_QUEUE_NAME } from '../../core/jobs/echo-queue.constants';
import { WALLET_BACKFILL_QUEUE_NAME } from '../wallets/application/wallet-backfill-queue.constants';
import { DEPOSIT_SETTLEMENT_REPOSITORY } from '../wallets/application/ports/deposit-settlement.repository.port';
import { DepositSettlementPrismaRepository } from '../wallets/infrastructure/deposit-settlement.prisma.repository';
import { LEDGER_REPOSITORY } from '../transactions/application/ports/ledger.repository.port';
import { LedgerPrismaRepository } from '../transactions/infrastructure/ledger.prisma.repository';
import { TREASURY_READ_REPOSITORY } from '../treasury/application/ports/treasury-read.repository.port';
import { TreasuryReadPrismaRepository } from '../treasury/infrastructure/treasury-read.prisma.repository';
import { BENEFICIARY_REPOSITORY } from '../beneficiaries/application/ports/beneficiary.repository.port';
import { BeneficiaryPrismaRepository } from '../beneficiaries/infrastructure/beneficiary.prisma.repository';

// ── Admin RBAC console (Task 11) ──────────────────────────────────────────────
import { AdminAuthController } from './presentation/admin-auth.controller';
import { AdminUsersController } from './presentation/admin-users.controller';
import { AdminRolesController } from './presentation/admin-roles.controller';
import { AdminAuditController } from './presentation/admin-audit.controller';
import { AdminSessionsController } from './presentation/admin-sessions.controller';
import { AdminSettingsController } from './presentation/admin-settings.controller';
import { AdminEndUsersController } from './presentation/admin-end-users.controller';
import { AdminKycReviewController } from './presentation/admin-kyc-review.controller';
import { AdminTransactionsController } from './presentation/admin-transactions.controller';
import { AdminTxnTriageController } from './presentation/admin-txn-triage.controller';
import { AdminLedgerController } from './presentation/admin-ledger.controller';
import { AdminComplianceController } from './presentation/admin-compliance.controller';
import { AdminTreasuryController } from './presentation/admin-treasury.controller';
import { AdminBeneficiariesController } from './presentation/admin-beneficiaries.controller';
import { AdminNotificationsController } from './presentation/admin-notifications.controller';
import { AdminWhatsAppController } from './presentation/admin-whatsapp.controller';
import { AdminTicketsController } from './presentation/admin-tickets.controller';
import { AdminAgentController } from './presentation/admin-agent.controller';
import { AdminMetricsController } from './presentation/admin-metrics.controller';
import { AdminMetricsOpsController } from './presentation/admin-metrics-ops.controller';
import { AdminCatalogController } from './presentation/admin-catalog.controller';
import { AdminProvidersController } from './presentation/admin-providers.controller';
import { AdminReconciliationController } from './presentation/admin-reconciliation.controller';
import { AdminApprovalsController } from './presentation/admin-approvals.controller';
import { AdminPreferencesController } from './presentation/admin-preferences.controller';
import { AdminPreferencesService } from './application/admin-preferences.service';
import { ADMIN_PREFERENCES_REPOSITORY } from './application/ports/admin-preferences.repository.port';
import { AdminPreferencesPrismaRepository } from './infrastructure/admin-preferences.prisma.repository';
// Phase 9 — deferred-write backends (blocked list, user notes, resend verification).
import { AdminBlockedController } from './presentation/admin-blocked.controller';
import { AdminBlockedListService } from './application/admin-blocked-list.service';
import { BLOCKED_LIST_REPOSITORY } from './application/ports/blocked-list.repository.port';
import { BlockedListPrismaRepository } from './infrastructure/blocked-list.prisma.repository';
import { AdminUserNoteService } from './application/admin-user-note.service';
import { ADMIN_USER_NOTE_REPOSITORY } from './application/ports/admin-user-note.repository.port';
import { AdminUserNotePrismaRepository } from './infrastructure/admin-user-note.prisma.repository';
import { AdminResendVerificationService } from './application/admin-resend-verification.service';
import { VERIFICATION_OUTBOX_REPOSITORY } from './application/ports/verification-outbox.repository.port';
import { VerificationOutboxPrismaRepository } from './infrastructure/verification-outbox.prisma.repository';
// Runtime "Add currency" (custom fiats).
import { AdminCurrencyController } from './presentation/admin-currency.controller';
import { AdminCurrencyService } from './application/admin-currency.service';
import { CustomFiatSyncService } from './application/custom-fiat-sync.service';
import { CUSTOM_FIAT_REPOSITORY } from './application/ports/custom-fiat.repository.port';
import { CustomFiatPrismaRepository } from './infrastructure/custom-fiat.prisma.repository';
import { AdminSessionGuard } from './presentation/admin-session.guard';
import { PermissionGuard } from './presentation/permission.guard';
import { AdminStepUpGuard } from './presentation/admin-step-up.guard';
import { AdminTokenService } from './application/admin-token.service';
import { AdminAuthService } from './application/admin-auth.service';
import { AdminMfaService } from './application/admin-mfa.service';
import { AdminStepUpService } from './application/admin-step-up.service';
import { AuthorizationService } from './application/authorization.service';
import { PermissionCatalogService } from './application/permission-catalog.service';
import { RoleService } from './application/role.service';
import { AdminInvitationService } from './application/admin-invitation.service';
import { AdminUserService } from './application/admin-user.service';
import { AdminBootstrapService } from './application/admin-bootstrap.service';
import { AdminSettingsService } from './application/admin-settings.service';
import { AdminEndUserService } from './application/admin-end-user.service';
import { AdminUserSecurityService } from './application/admin-user-security.service';
import { AdminUserBulkService } from './application/admin-user-bulk.service';
import { USER_BULK_REPOSITORY } from './application/ports/user-bulk.repository.port';
import { UserBulkPrismaRepository } from './infrastructure/user-bulk.prisma.repository';
import { AdminAuditService } from './application/admin-audit.service';
import { AdminKycReviewService } from './application/admin-kyc-review.service';
import { USER_SESSION_READ_REPOSITORY } from './application/ports/user-session-read.repository.port';
import { UserSessionReadPrismaRepository } from './infrastructure/user-session-read.prisma.repository';
import { VELOCITY_REPOSITORY } from '../identity/application/ports/velocity.repository.port';
import { VelocityPrismaRepository } from '../identity/infrastructure/velocity.prisma.repository';
import { AdminTxnOversightService } from './application/admin-txn-oversight.service';
import { AdminTxnTriageService } from './application/admin-txn-triage.service';
import { AdminLedgerService } from './application/admin-ledger.service';
import { AdminComplianceService } from './application/admin-compliance.service';
import { AdminTreasuryService } from './application/admin-treasury.service';
import { AdminBeneficiaryService } from './application/admin-beneficiary.service';
import { AdminNotificationTemplateService } from './application/admin-notification-template.service';
import { AdminNotificationDeliveryService } from './application/admin-notification-delivery.service';
import { NOTIFICATION_DELIVERY_READ_REPOSITORY } from './application/ports/notification-delivery-read.repository.port';
import { NotificationDeliveryReadPrismaRepository } from './infrastructure/notification-delivery-read.prisma.repository';
import { AdminNotificationBroadcastService } from './application/admin-notification-broadcast.service';
import { BROADCAST_DISPATCH_REPOSITORY } from './application/ports/broadcast-dispatch.repository.port';
import { BroadcastDispatchPrismaRepository } from './infrastructure/broadcast-dispatch.prisma.repository';
import { AdminWhatsAppConfigService } from './application/admin-whatsapp-config.service';
import { AdminTicketService } from './application/admin-ticket.service';
import { AdminAgentService } from './application/admin-agent.service';
import { AdminMetricsService } from './application/admin-metrics.service';
import { AdminCatalogService } from './application/admin-catalog.service';
import { AdminProvidersService } from './application/admin-providers.service';
import { METRICS_READ_REPOSITORY } from './application/ports/metrics-read.repository.port';
import { MetricsReadPrismaRepository } from './infrastructure/metrics-read.prisma.repository';
import { AdminMetricsOpsService } from './application/admin-metrics-ops.service';
import { METRICS_OPS_READ_REPOSITORY } from './application/ports/metrics-ops-read.repository.port';
import { MetricsOpsReadPrismaRepository } from './infrastructure/metrics-ops-read.prisma.repository';
import { AdminReconciliationService } from './application/admin-reconciliation.service';
import { AdminReconciliationActionService } from './application/admin-reconciliation-action.service';
import { RECONCILIATION_READ_REPOSITORY } from './application/ports/reconciliation-read.repository.port';
import { ReconciliationReadPrismaRepository } from './infrastructure/reconciliation-read.prisma.repository';
// Phase 7 WRITES (Ops / Recon / Treasury / Providers): the engine-brokered ops run,
// the reconciliation resolve/accept dispositions, the payout maker-checker approval,
// and the provider liveness probe (port + HttpService adapter).
import { AdminOpsRunService } from './application/admin-ops-run.service';
import { AdminTreasuryPayoutService } from './application/admin-treasury-payout.service';
import { AdminProviderProbeService } from './application/admin-provider-probe.service';
import { PROVIDER_PROBE } from './application/ports/provider-probe.port';
import { HttpProviderProbeAdapter } from './infrastructure/http-provider-probe.adapter';
import { AdminApprovalsService } from './application/admin-approvals.service';
import { AdminManualCreditService } from './application/admin-manual-credit.service';
import { CHANGE_REQUEST_REPOSITORY } from './application/ports/change-request.repository.port';
import { ChangeRequestPrismaRepository } from './infrastructure/change-request.prisma.repository';
import { AdminOpsController } from './presentation/admin-ops.controller';
import { AdminOpsService } from './application/admin-ops.service';
import { OPS_READ_REPOSITORY } from './application/ports/ops-read.repository.port';
import { OpsReadPrismaRepository } from './infrastructure/ops-read.prisma.repository';
import { TICKET_ORDER_READ_REPOSITORY } from './application/ports/ticket-order-read.repository.port';
import { TicketOrderReadPrismaRepository } from './infrastructure/ticket-order-read.prisma.repository';
import { ADMIN_TXN_READ_REPOSITORY } from './application/ports/admin-txn-read.repository.port';
import { AdminTxnReadPrismaRepository } from './infrastructure/admin-txn-read.prisma.repository';
import { AGENT_USAGE_READ_REPOSITORY } from './application/ports/agent-usage-read.repository.port';
import { AgentUsageReadPrismaRepository } from './infrastructure/agent-usage-read.prisma.repository';
import { ADMIN_USER_REPOSITORY } from './application/ports/admin-user.repository.port';
import { ADMIN_SESSION_REPOSITORY } from './application/ports/admin-session.repository.port';
import { ROLE_REPOSITORY } from './application/ports/role.repository.port';
import { PERMISSION_REPOSITORY } from './application/ports/permission.repository.port';
import { ADMIN_INVITATION_REPOSITORY } from './application/ports/admin-invitation.repository.port';
import { PASSWORD_HASHER } from './application/ports/password-hasher.port';
import { TOTP_PROVIDER } from './application/ports/totp.port';
import { MFA_CIPHER } from './application/ports/mfa-cipher.port';
import { AdminUserPrismaRepository } from './infrastructure/admin-user.prisma.repository';
import { AdminSessionPrismaRepository } from './infrastructure/admin-session.prisma.repository';
import { RolePrismaRepository } from './infrastructure/role.prisma.repository';
import { PermissionPrismaRepository } from './infrastructure/permission.prisma.repository';
import { AdminInvitationPrismaRepository } from './infrastructure/admin-invitation.prisma.repository';
import { Argon2PasswordHasher } from './infrastructure/argon2-password.hasher';
import { OtplibTotpAdapter } from './infrastructure/otplib-totp.adapter';
import { MfaSecretCipher } from './infrastructure/mfa-secret.cipher';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../core/config/env.schema';

/**
 * Admin feature module (WN-5, BQ-1, BQ-2, CLAUDE.md §4 — listed as a planned module).
 *
 * Provides the internal admin surface for operator/ops tasks:
 *   - POST /admin/wallets/backfill-networks — enqueue async backfill (BQ-2).
 *   - GET  /admin/wallets/backfill-runs/:id — poll BackfillRun status (BQ-2).
 *   - GET  /admin/queues (Bull Board dashboard, BQ-1) — queue monitoring.
 *
 * Why WalletBackfillService lives here (not in WalletsModule):
 *   WalletBackfillService requires USER_LISTER (IUserLister) — the port whose
 *   adapter lives in identity/infrastructure. Registering it in WalletsModule
 *   would require WalletsModule to import IdentityModule, creating a cycle
 *   (IdentityModule already imports WalletsModule for WN-3). AdminModule is
 *   the composition root that safely imports both and provides all dependencies.
 *
 * Bull Board (BQ-1, BQ-2):
 *   Mounted at /admin/queues via @bull-board/nestjs + ExpressAdapter. Protected
 *   by BullBoardBasicAuthMiddleware (HTTP Basic auth, password = ADMIN_API_TOKEN).
 *   Both the echo queue and the wallet-backfill queue are registered.
 *
 * DI wiring:
 *   - WalletsModule: exports WalletService, WALLET_PROVIDER, WALLET_REPOSITORY,
 *     BACKFILL_RUN_REPOSITORY.
 *   - IdentityModule: exports USER_LISTER (ActiveUserListerPrismaAdapter).
 *   - CatalogModule is global — AssetRegistry available without import.
 *   - ConfigModule is global — ConfigService available for guards and middleware.
 *   - PrismaModule is global — PrismaService available without import.
 *   - JobsModule is imported at AppModule level with BullModule re-exported —
 *     BullBoardModule.forFeature() and @InjectQueue() resolve queues from BullModule.
 */
@Module({
  imports: [
    WalletsModule,
    IdentityModule,
    // Phase 2, Task 5 (ADM-02): the end-user detail aggregate injects
    // TRANSACTION_READ_REPOSITORY (recent transactions) and BeneficiaryService
    // (linked beneficiaries); AuthModule provides PinService, and PIN_REPOSITORY
    // is re-bound locally below (AuthModule does not export the token).
    TransactionsModule,
    BeneficiariesModule,
    AuthModule,
    // Phase 3, sub-area C: ComplianceModule exports the compliance repository
    // tokens (events/sanctions/aml-rules/travel-rule/reports) that
    // AdminComplianceService injects. AuditService is global.
    ComplianceModule,
    // Phase 4, wave 1 (Comms): NotificationsModule exports the
    // NOTIFICATION_TEMPLATE_REPOSITORY token that AdminNotificationTemplateService
    // injects for the template console. AuditService + ConfigService are global.
    NotificationsModule,
    // Phase 4, wave 2 (Agent): ConversationsModule exports
    // CONVERSATION_LOG_READ_REPOSITORY for the agent conversation-log surfaces.
    // EffectiveConfigService is global (agent.modelId / agent.enabled). The ticket
    // read repo is bound locally below (no tickets module exists yet).
    ConversationsModule,
    // AdminTokenService injects JwtService for admin session-token sign/verify.
    JwtModule.register({}),
    // Phase 7 (Providers "Test connection"): the HttpService used by the liveness
    // probe adapter for a bounded, credential-free reachability round-trip.
    HttpModule.register({}),
    // Register the wallet-backfill queue in AdminModule so @InjectQueue resolves
    // for AdminWalletsController. BullModule.forRoot() is already set up by
    // JobsModule (imported at AppModule level); this registerQueue call adds the
    // Queue instance to AdminModule's DI scope without duplicating the connection.
    BullModule.registerQueue({ name: WALLET_BACKFILL_QUEUE_NAME }),
    // Bull Board root: ExpressAdapter + fail-closed Basic-auth middleware.
    BullBoardModule.forRoot({
      route: '/admin/queues',
      adapter: ExpressAdapter,
      middleware: BullBoardBasicAuthMiddleware,
    }),
    // Register all queues with Bull Board so they appear in the dashboard.
    BullBoardModule.forFeature({
      name: ECHO_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
    BullBoardModule.forFeature({
      name: WALLET_BACKFILL_QUEUE_NAME,
      adapter: BullMQAdapter,
    }),
  ],
  controllers: [
    AdminWalletsController,
    AdminAuthController,
    AdminUsersController,
    AdminRolesController,
    AdminAuditController,
    AdminSessionsController,
    AdminSettingsController,
    AdminEndUsersController,
    AdminKycReviewController,
    AdminTransactionsController,
    AdminTxnTriageController,
    AdminLedgerController,
    AdminComplianceController,
    AdminTreasuryController,
    AdminBeneficiariesController,
    AdminNotificationsController,
    AdminWhatsAppController,
    AdminTicketsController,
    AdminAgentController,
    AdminMetricsController,
    AdminMetricsOpsController,
    AdminOpsController,
    AdminCatalogController,
    AdminProvidersController,
    AdminReconciliationController,
    AdminApprovalsController,
    AdminPreferencesController,
    AdminBlockedController,
    AdminCurrencyController,
  ],
  providers: [
    AdminTokenGuard,
    BullBoardBasicAuthMiddleware,
    // ── Admin notification preferences (Phase 8): self-scoped GET/PATCH /me/preferences ──
    AdminPreferencesService,
    {
      provide: ADMIN_PREFERENCES_REPOSITORY,
      useClass: AdminPreferencesPrismaRepository,
    },
    // ── Phase 9 deferred-write backends ──
    AdminBlockedListService,
    { provide: BLOCKED_LIST_REPOSITORY, useClass: BlockedListPrismaRepository },
    AdminUserNoteService,
    {
      provide: ADMIN_USER_NOTE_REPOSITORY,
      useClass: AdminUserNotePrismaRepository,
    },
    AdminResendVerificationService,
    {
      provide: VERIFICATION_OUTBOX_REPOSITORY,
      useClass: VerificationOutboxPrismaRepository,
    },
    // ── Runtime "Add currency" (custom fiats) ──
    AdminCurrencyService,
    CustomFiatSyncService,
    { provide: CUSTOM_FIAT_REPOSITORY, useClass: CustomFiatPrismaRepository },
    // ── Admin RBAC console (Task 11): repo bindings, adapters, services, guards ──
    { provide: ADMIN_USER_REPOSITORY, useClass: AdminUserPrismaRepository },
    {
      provide: ADMIN_SESSION_REPOSITORY,
      useClass: AdminSessionPrismaRepository,
    },
    { provide: ROLE_REPOSITORY, useClass: RolePrismaRepository },
    { provide: PERMISSION_REPOSITORY, useClass: PermissionPrismaRepository },
    {
      provide: ADMIN_INVITATION_REPOSITORY,
      useClass: AdminInvitationPrismaRepository,
    },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: TOTP_PROVIDER, useClass: OtplibTotpAdapter },
    // The AES-256-GCM MFA cipher is infrastructure; bind it behind MFA_CIPHER so
    // the application layer depends only on the port (§4). Key from env.
    {
      provide: MFA_CIPHER,
      useFactory: (config: ConfigService<Env, true>) =>
        new MfaSecretCipher(config.get('ADMIN_MFA_ENC_KEY', { infer: true })),
      inject: [ConfigService],
    },
    AdminTokenService,
    AdminAuthService,
    AdminMfaService,
    AdminStepUpService,
    AuthorizationService,
    PermissionCatalogService,
    RoleService,
    AdminInvitationService,
    AdminUserService,
    AdminBootstrapService,
    AdminSettingsService,
    // Phase 2, Task 5 (ADM-02 / ADM-03): platform end-user management + KYC review.
    AdminEndUserService,
    // Phase 6b (ADM-02 READ): user-detail Security (sessions) / Limits (effective
    // caps + live velocity) / Profile timeline (audit-log by subject). Read-only
    // (§3.1); USER_SESSION_READ_REPOSITORY + VELOCITY_REPOSITORY are bound locally
    // below (mirrors the LEDGER_REPOSITORY / PIN_REPOSITORY local binds).
    AdminUserSecurityService,
    // Phase 7 (WRITES): the Users-directory BULK service — bulk tag + bulk message
    // over an EXPLICIT selected id set. Neither moves money (§3.1): tags are pure
    // annotations; messages enqueue onto the notifications outbox (never a direct
    // send). USER_BULK_REPOSITORY is bound locally below (PrismaService is global);
    // AuditService + EffectiveConfigService are global. The large-set gate is
    // re-checked server-side. Both actions are idempotent + immutably audited.
    AdminUserBulkService,
    // Phase 6b (READ enrichment): the audit-log read service wraps the global
    // AuditService and projects per-actor role (resolved via ADMIN_USER_REPOSITORY,
    // already bound below) + a first-class `reason` (from details.reason). Read-only
    // (§3.1); both fields are computed on read, never part of the hashed row.
    AdminAuditService,
    AdminKycReviewService,
    // Phase 3, sub-area A (READ-ONLY): transactions + ledger oversight.
    // TRANSACTION_REPOSITORY comes from the imported TransactionsModule;
    // LEDGER_REPOSITORY is bound locally below.
    AdminTxnOversightService,
    // Phase 3, sub-area B (ENGINE-BROKERED): transaction triage — mark-failed +
    // refund (via SETTLEMENT_REPOSITORY refund methods) and retry (re-enqueue the
    // SETTLEMENT_OUTBOX_REPOSITORY row). Both tokens + CLOCK come from the imported
    // TransactionsModule (exported there); AuditService is global.
    AdminTxnTriageService,
    AdminLedgerService,
    // Phase 3, sub-area C (COMPLIANCE CONSOLE): flagged-event disposition,
    // AML-rule CRUD, Travel-Rule + sanctions reads, SAR/STR reports. Its
    // compliance repository ports come from the imported ComplianceModule;
    // AuditService is global. Never moves money (§3.1).
    AdminComplianceService,
    // Phase 3, sub-area D (READ-ONLY oversight + one step-up write each):
    //   - AdminTreasuryService: aggregated balances, exposure snapshots, alerts
    //     (acknowledge = the write), withdrawal policies. Reaches data via the
    //     locally-bound TREASURY_READ_REPOSITORY below.
    //   - AdminBeneficiaryService: beneficiary listing + cooling-off override
    //     (the write). Reaches data via the locally-bound BENEFICIARY_REPOSITORY
    //     below (BeneficiariesModule does not export the token). Neither service
    //     moves money (§3.1); both audit their write as admin_override.
    AdminTreasuryService,
    AdminBeneficiaryService,
    // Phase 4, wave 1 (Comms): notification-template CRUD/preview +
    // read-only WhatsApp config view. The template repo token comes from the
    // imported NotificationsModule; ConfigService + AuditService are global.
    // Neither service moves money (§3.1).
    AdminNotificationTemplateService,
    // Phase 6b (Comms READ enrichment): the read-only delivery log (recent issued
    // notifications + aggregate bounce/complaint rates). Reads the locally-bound
    // NOTIFICATION_DELIVERY_READ_REPOSITORY below (PrismaService is global). Never
    // moves money (§3.1).
    AdminNotificationDeliveryService,
    // Phase 7 (WRITES): the broadcast-send service. Resolves the cohort size
    // server-side and either dispatches through the outbox (small audience) or
    // captures a maker-checker ChangeRequest (large audience, §3.5). Reads the
    // locally-bound BROADCAST_DISPATCH_REPOSITORY below; defers dual-control to
    // AdminApprovalsService. Moves no money (§3.1).
    AdminNotificationBroadcastService,
    AdminWhatsAppConfigService,
    // Phase 4, wave 2 (READ-ONLY): tickets oversight + agent config/conversation
    // logs. AdminTicketService reads the locally-bound TICKET_ORDER_READ_REPOSITORY
    // (no tickets module exists). AdminAgentService reads CONVERSATION_LOG_READ_REPOSITORY
    // from the imported ConversationsModule + the global EffectiveConfigService.
    // Neither service moves money (§3.1); the agent system prompt stays read-only (§6).
    AdminTicketService,
    AdminAgentService,
    // Phase 5, FINAL (READ-ONLY): operational dashboard / metrics. AdminMetricsService
    // reaches data via the locally-bound METRICS_READ_REPOSITORY below (PrismaService
    // is global). All date-ranged aggregations — never moves money (§3.1).
    AdminMetricsService,
    // Phase 6b (READ-ONLY): operational-health panels (system health, activity feed,
    // open-compliance count). AdminMetricsOpsService reads the locally-bound
    // METRICS_OPS_READ_REPOSITORY below. Never moves money (§3.1).
    AdminMetricsOpsService,
    // Phase 6b (READ-ONLY): the "System / ops" board (provider status, webhook
    // queues, background-jobs / cron registry). AdminOpsService reads the
    // locally-bound OPS_READ_REPOSITORY below. Never moves money (§3.1).
    AdminOpsService,
    // Phase 6b (READ-ONLY): the provider-vs-ledger Reconciliation surface. The
    // break list + cron status bar are projected from unresolved compensations +
    // stuck settlements via the locally-bound RECONCILIATION_READ_REPOSITORY below.
    // Never moves money (§3.1); the resolve/accept/escalate/run-now WRITES are Phase 7.
    AdminReconciliationService,
    // Phase 7 (WRITES): the reconciliation dispositions. RESOLVE is engine-brokered —
    // it re-drives the offending txn's settlement via AdminTxnTriageService.retry
    // (re-enqueue; no money moves, §3.1) — and ACCEPT records a no-debit disposition.
    // The break's transactionId is derived server-side from the read projection; both
    // are step-up-gated + immutably audited.
    AdminReconciliationActionService,
    // Phase 7 (WRITE): the "Run now" manual-run trigger. Re-drives the reconciler's
    // tick() (exported by TransactionsModule) — an engine-brokered re-drive that moves
    // no money (§3.1). Step-up-gated + audited.
    AdminOpsRunService,
    // Phase 7 (WRITE — maker-checker): approving a queued payout raises a
    // `payout_release` change request via AdminApprovalsService (four-eyes) — it
    // releases NO money here; a second admin's approval re-drives settlement via the
    // engine's atomic path (§3.1). Reaches the payout via TREASURY_READ_REPOSITORY.
    AdminTreasuryPayoutService,
    // Phase 6b (READ-ONLY): full asset + fiat catalog view (Config group's Asset /
    // Currency screens). AdminCatalogService reads the merged catalog via the global
    // EffectiveConfigService — no repo, no Prisma, never moves money (§3.1/§3.2).
    AdminCatalogService,
    // Phase 6b (READ-ONLY): the provider-registry view (design §6.27). AdminProvidersService
    // derives per-provider status/mock-mode/secret-presence/bound-capabilities + the
    // mock→live readiness checklist from the layered env (ConfigService) + capability
    // flags (global EffectiveConfigService) — no repo, no Prisma, no secret values,
    // never moves money (§3.1/§3.2/§3.4).
    AdminProvidersService,
    // Phase 7 (WRITE-adjacent): the provider "Test connection" liveness probe. Runs a
    // real, credential-free reachability round-trip via the HttpService-backed
    // PROVIDER_PROBE adapter (bound below) — it exposes NO secret (§3.4/§3.5) and moves
    // NO money (§3.1). Execute-gated + step-up-gated at the controller.
    AdminProviderProbeService,
    { provide: PROVIDER_PROBE, useClass: HttpProviderProbeAdapter },
    // Phase 7 (WRITES — maker-checker): the APPROVALS change-request engine. A
    // pending request raised by one admin is applied ONLY on a DIFFERENT admin's
    // approval, and the apply RE-EXECUTES through the target service's atomic path
    // (AdminSettingsService for pricing/capability/tier config; AdminTxnTriageService
    // for engine-brokered refunds) — never a raw ledger write (§3.1). CHANGE_REQUEST_
    // REPOSITORY is bound locally below (PrismaService is global); AuditService + CLOCK
    // are global; both target services are already provided in this module.
    AdminApprovalsService,
    // Phase 7 (WRITES — engine-brokered): the manual-credit APPLIER. Invoked only
    // by AdminApprovalsService on an approved `manual_credit` request (four-eyes),
    // it credits an end user's wallet through the engine's atomic
    // settleManualCreditAtomic (SETTLEMENT_REPOSITORY, from the imported
    // TransactionsModule) after a server-side status/sanctions re-check via
    // IDENTITY_REPOSITORY + WALLET_REPOSITORY — never a raw ledger write (§3.1/§3.3).
    // AssetRegistry + AuditService + CLOCK are global.
    AdminManualCreditService,
    AdminSessionGuard,
    PermissionGuard,
    AdminStepUpGuard,
    // WalletBackfillService is provided here (not in WalletsModule) so it can
    // receive USER_LISTER from IdentityModule without creating a cycle.
    // Still needed by the coordinator processor via WorkerModule.
    WalletBackfillService,
    // WalletReconciliationService: registered here (not in WalletsModule) so it
    // can be wired alongside the existing DEPOSIT_SETTLEMENT_REPOSITORY and
    // LEDGER_REPOSITORY bindings without creating a cycle. Both repositories are
    // bound locally — PrismaService is global so they have no unmet dependencies.
    WalletReconciliationService,
    {
      provide: DEPOSIT_SETTLEMENT_REPOSITORY,
      useClass: DepositSettlementPrismaRepository,
    },
    {
      provide: LEDGER_REPOSITORY,
      useClass: LedgerPrismaRepository,
    },
    // PIN_REPOSITORY: re-bound locally so AdminEndUserService can force-reset a
    // user's PIN (ADM-02). AuthModule (imported above) provides PinService but
    // does not export the underlying PIN_REPOSITORY token — mirrors the local
    // LEDGER_REPOSITORY / DEPOSIT_SETTLEMENT_REPOSITORY bindings. PrismaService
    // is global, so the repository has no unmet dependency.
    {
      provide: PIN_REPOSITORY,
      useClass: PinPrismaRepository,
    },
    // Phase 3, sub-area D: TREASURY_READ_REPOSITORY + BENEFICIARY_REPOSITORY are
    // bound locally here (PrismaService is global). The treasury read repo has no
    // home module yet; the beneficiary repo lives in BeneficiariesModule but that
    // module does not export the token (it exports the service). Mirrors the local
    // LEDGER_REPOSITORY / PIN_REPOSITORY bindings above.
    {
      provide: TREASURY_READ_REPOSITORY,
      useClass: TreasuryReadPrismaRepository,
    },
    {
      provide: BENEFICIARY_REPOSITORY,
      useClass: BeneficiaryPrismaRepository,
    },
    // Phase 4, wave 2: TICKET_ORDER_READ_REPOSITORY is bound locally — there is no
    // tickets module yet, so the admin layer owns this read (PrismaService is
    // global). Mirrors the local LEDGER_REPOSITORY / TREASURY_READ_REPOSITORY binds.
    {
      provide: TICKET_ORDER_READ_REPOSITORY,
      useClass: TicketOrderReadPrismaRepository,
    },
    // Phase 5, FINAL: METRICS_READ_REPOSITORY is bound locally — the metrics
    // aggregations have no home module, so the admin layer owns this read
    // (PrismaService is global). Mirrors the local LEDGER_REPOSITORY /
    // TREASURY_READ_REPOSITORY / TICKET_ORDER_READ_REPOSITORY binds above.
    {
      provide: METRICS_READ_REPOSITORY,
      useClass: MetricsReadPrismaRepository,
    },
    // Phase 6b: METRICS_OPS_READ_REPOSITORY is bound locally — the operational-health
    // panels (system health, activity feed, open-compliance count) have no home
    // module, so the admin layer owns this read (PrismaService is global). Mirrors
    // the METRICS_READ_REPOSITORY bind above. Feeds AdminMetricsOpsService.
    {
      provide: METRICS_OPS_READ_REPOSITORY,
      useClass: MetricsOpsReadPrismaRepository,
    },
    // Phase 6b: OPS_READ_REPOSITORY is bound locally — the "System / ops" board
    // (provider status / webhook queues / cron registry) projects real
    // SettlementOutbox rows + the declared cron registry. Feeds AdminOpsService.
    {
      provide: OPS_READ_REPOSITORY,
      useClass: OpsReadPrismaRepository,
    },
    // Phase 6b: RECONCILIATION_READ_REPOSITORY is bound locally — the provider-vs-
    // ledger break projection (unresolved compensations + stuck settlements) + the
    // cron-status timeline have no home module, so the admin layer owns this read
    // (PrismaService is global). Mirrors the METRICS_OPS_READ_REPOSITORY bind above.
    // Feeds AdminReconciliationService. Read-only (§3.1).
    {
      provide: RECONCILIATION_READ_REPOSITORY,
      useClass: ReconciliationReadPrismaRepository,
    },
    // Phase 7: CHANGE_REQUEST_REPOSITORY is bound locally — the maker-checker
    // change-request store has no home module, so the admin layer owns this write
    // (PrismaService is global). Mirrors the RECONCILIATION_READ_REPOSITORY bind
    // above. Feeds AdminApprovalsService. Stores the request envelope only — never
    // applies the change and never touches the ledger (§3.1).
    {
      provide: CHANGE_REQUEST_REPOSITORY,
      useClass: ChangeRequestPrismaRepository,
    },
    // Phase 6b (Comms): NOTIFICATION_DELIVERY_READ_REPOSITORY is bound locally —
    // the delivery-log read (recent notifications + bounce/complaint stats) has no
    // home module, so the admin layer owns it (PrismaService is global). Mirrors
    // the METRICS_OPS_READ_REPOSITORY bind above. Feeds AdminNotificationDeliveryService.
    {
      provide: NOTIFICATION_DELIVERY_READ_REPOSITORY,
      useClass: NotificationDeliveryReadPrismaRepository,
    },
    // Phase 7 (Comms WRITES): BROADCAST_DISPATCH_REPOSITORY is bound locally — it
    // resolves an audience cohort and enqueues the broadcast into the notifications
    // outbox (idempotent, no PII leaves the DB). PrismaService is global, so it has
    // no unmet dependency. Feeds AdminNotificationBroadcastService + the approvals
    // applier's notification_broadcast re-run. Moves no money (§3.1).
    {
      provide: BROADCAST_DISPATCH_REPOSITORY,
      useClass: BroadcastDispatchPrismaRepository,
    },
    // Phase 7 (Users bulk bar): USER_BULK_REPOSITORY is bound locally — the bulk
    // tag write (UserTag) + the explicit-id message enqueue onto the notifications
    // outbox. PrismaService is global, so it has no unmet dependency. Feeds
    // AdminUserBulkService. Moves no money (§3.1).
    {
      provide: USER_BULK_REPOSITORY,
      useClass: UserBulkPrismaRepository,
    },
    // Phase 6b: ADMIN_TXN_READ_REPOSITORY is bound locally — the admin-owned
    // transaction read (free-text q search, view-tab counts, userId→email join)
    // that the base transactions port does not model. PrismaService is global, so
    // it has no unmet dependency. Feeds AdminTxnOversightService.
    {
      provide: ADMIN_TXN_READ_REPOSITORY,
      useClass: AdminTxnReadPrismaRepository,
    },
    // Phase 6b: AGENT_USAGE_READ_REPOSITORY is bound locally — the admin-owned
    // rolling-24h usage read (conversation/message/reply counts) that backs the
    // Agent console's "Cost & usage (24h)" card. No token/cost is read — the schema
    // stores none (§3.6). PrismaService is global, so it has no unmet dependency.
    // Feeds AdminAgentService.getInsights().
    {
      provide: AGENT_USAGE_READ_REPOSITORY,
      useClass: AgentUsageReadPrismaRepository,
    },
    // Phase 6b: USER_SESSION_READ_REPOSITORY (admin-owned read of the end user's
    // `sessions` rows) + VELOCITY_REPOSITORY (IdentityModule provides the adapter
    // but does not export the token) are bound locally here. PrismaService is
    // global, so neither has an unmet dependency. Both feed AdminUserSecurityService.
    {
      provide: USER_SESSION_READ_REPOSITORY,
      useClass: UserSessionReadPrismaRepository,
    },
    {
      provide: VELOCITY_REPOSITORY,
      useClass: VelocityPrismaRepository,
    },
  ],
})
export class AdminModule implements OnModuleInit {
  constructor(
    private readonly catalog: PermissionCatalogService,
    private readonly roles: RoleService,
    private readonly notificationTemplates: NotificationTemplateSeedService,
  ) {}

  /**
   * Idempotently sync the permission catalog, seed the built-in roles, and seed
   * the platform's default notification templates on boot, so a fresh deployment
   * always has the canonical RBAC surface + Comms templates present (the bootstrap
   * path also runs the RBAC seeds; seeding here keeps every environment in
   * lock-step with the contracts catalog without requiring a bootstrap call). The
   * template seed skips any key an admin has already authored/edited (§3.6).
   */
  async onModuleInit(): Promise<void> {
    await this.catalog.syncCatalog();
    await this.roles.seedBuiltins();
    await this.notificationTemplates.seedDefaults();
  }
}
