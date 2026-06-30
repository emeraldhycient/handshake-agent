import { Module, type OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

import { WalletsModule } from '../wallets/wallets.module';
import { IdentityModule } from '../identity/identity.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { BeneficiariesModule } from '../beneficiaries/beneficiaries.module';
import { ComplianceModule } from '../compliance/compliance.module';
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
import { AdminKycReviewService } from './application/admin-kyc-review.service';
import { AdminTxnOversightService } from './application/admin-txn-oversight.service';
import { AdminTxnTriageService } from './application/admin-txn-triage.service';
import { AdminLedgerService } from './application/admin-ledger.service';
import { AdminComplianceService } from './application/admin-compliance.service';
import { AdminTreasuryService } from './application/admin-treasury.service';
import { AdminBeneficiaryService } from './application/admin-beneficiary.service';
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
    // AdminTokenService injects JwtService for admin session-token sign/verify.
    JwtModule.register({}),
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
  ],
  providers: [
    AdminTokenGuard,
    BullBoardBasicAuthMiddleware,
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
  ],
})
export class AdminModule implements OnModuleInit {
  constructor(
    private readonly catalog: PermissionCatalogService,
    private readonly roles: RoleService,
  ) {}

  /**
   * Idempotently sync the permission catalog and seed the built-in roles on boot,
   * so a fresh deployment always has the canonical RBAC surface present (the
   * bootstrap path also runs these, but seeding here keeps every environment in
   * lock-step with the contracts catalog without requiring a bootstrap call).
   */
  async onModuleInit(): Promise<void> {
    await this.catalog.syncCatalog();
    await this.roles.seedBuiltins();
  }
}
