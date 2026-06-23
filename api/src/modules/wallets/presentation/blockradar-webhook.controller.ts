/**
 * BlockradarWebhookController — receives Blockradar deposit webhooks and
 * atomically credits the user's USDT wallet + sends a WhatsApp receipt (R2).
 *
 * Flow (CLAUDE.md §3.1 preserved — no LLM output moves money):
 *   1. Verify authenticity: HMAC-SHA512 of raw body keyed by BLOCKRADAR_API_KEY.
 *      Invalid → 401. No downstream processing.
 *   2. Parse body defensively. Only act on event=deposit.success with
 *      hash/amount/recipientAddress. Anything else → 200 (ack).
 *   3. Resolve the wallet by recipientAddress (WalletRepository.findByAddress).
 *      Not found → 200 + log.
 *   4. settleDepositAtomic: atomic credit (ledger + WalletBalance + DepositConfirmation
 *      + signed Receipt). deposited:false means duplicate txHash — 200, no receipt.
 *   5. deposited:true → resolve WhatsApp address (IdentityService) + sendText receipt
 *      referencing the receiptNumber from the signed Receipt.
 *   6. ALWAYS respond 200 except 401. Downstream errors swallowed + logged.
 */

import { timingSafeEqual } from 'node:crypto';

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { hmacHex } from '../../../core/crypto/hmac';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { IdentityService } from '../../identity/application/identity.service';
import {
  WHATSAPP_SENDER,
  type IWhatsAppSender,
} from '../../whatsapp/application/ports/whatsapp-sender.port';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
} from '../application/ports/wallet.repository.port';
import {
  DEPOSIT_SETTLEMENT_REPOSITORY,
  type IDepositSettlementRepository,
} from '../application/ports/deposit-settlement.repository.port';

// ---------------------------------------------------------------------------
// Ack response
// ---------------------------------------------------------------------------

type AckResponse = { status: 'ok' };

// ---------------------------------------------------------------------------
// Blockradar deposit webhook body shape (defensive)
// ---------------------------------------------------------------------------

interface BlockradarWebhookBody {
  event?: unknown;
  data?: {
    hash?: unknown;
    amount?: unknown;
    recipientAddress?: unknown;
    senderAddress?: unknown;
    asset?: {
      symbol?: unknown;
      network?: { name?: unknown };
    };
    confirmations?: unknown;
    status?: unknown;
    id?: unknown;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

@Controller('webhooks')
export class BlockradarWebhookController {
  private readonly logger = new Logger(BlockradarWebhookController.name);
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepo: IWalletRepository,
    @Inject(DEPOSIT_SETTLEMENT_REPOSITORY)
    private readonly settlementRepo: IDepositSettlementRepository,
    private readonly identityService: IdentityService,
    @Inject(WHATSAPP_SENDER)
    private readonly sender: IWhatsAppSender,
    private readonly assetRegistry: AssetRegistry,
  ) {
    this.apiKey = this.config.get<string>('BLOCKRADAR_API_KEY') ?? '';
  }

  /**
   * POST /webhooks/blockradar
   *
   * Blockradar calls this when a deposit lands on a user's child address.
   * We verify the HMAC-SHA512 signature, then atomically settle + notify.
   *
   * The signature header is `x-blockradar-signature` = lowercase hex HMAC-SHA512
   * of the raw body keyed by BLOCKRADAR_API_KEY (no prefix, unlike GitHub/WhatsApp).
   *
   * We accept the raw body buffer from the `req.rawBody` field populated by
   * the `rawBody: true` option in main.ts (NestJS Express adapter).
   *
   * Unit tests call this method directly, passing rawBody as the second arg and
   * sigHeader as the third — the NestJS decorators are only metadata at runtime.
   */
  @Post('blockradar')
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() body: unknown,
    @Req() req: Request | Buffer,
    @Headers('x-blockradar-signature') sigHeader?: string,
  ): Promise<AckResponse> {
    // Allow unit tests to pass rawBody directly as the second argument.
    // In production, rawBody is attached to the Express Request by NestJS.
    const rawBody: Buffer | undefined =
      req instanceof Buffer
        ? req
        : (req as Request & { rawBody?: Buffer }).rawBody;

    // ── Step 1: Authenticate ─────────────────────────────────────────────────
    if (!this.verifySignature(rawBody, sigHeader)) {
      this.logger.warn('Blockradar webhook signature invalid — rejecting');
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    // ── Step 2: Defensive parse ──────────────────────────────────────────────
    const payload = body as BlockradarWebhookBody;

    if (payload?.event !== 'deposit.success') {
      this.logger.log(
        { event: payload?.event },
        'Blockradar webhook: not deposit.success — acking without processing',
      );
      return { status: 'ok' };
    }

    const data = payload.data;
    const hash = typeof data?.hash === 'string' ? data.hash : undefined;
    const amount = typeof data?.amount === 'string' ? data.amount : undefined;
    const recipientAddress =
      typeof data?.recipientAddress === 'string'
        ? data.recipientAddress
        : undefined;

    if (!hash || !amount || !recipientAddress) {
      this.logger.warn(
        { data },
        'Blockradar webhook: deposit.success missing required fields — acking',
      );
      return { status: 'ok' };
    }

    const assetSymbol =
      typeof data?.asset?.symbol === 'string' ? data.asset.symbol : 'USDT';
    const networkName =
      typeof data?.asset?.network?.name === 'string'
        ? data.asset.network.name
        : 'TRON';
    const webhookId = typeof data?.id === 'string' ? data.id : undefined;

    // Extract on-chain sender address for audit persistence.
    const senderAddress =
      typeof data?.senderAddress === 'string' ? data.senderAddress : undefined;

    // ── Steps 3–5: Resolve wallet, settle, notify (errors swallowed) ─────────
    await this.settleAndNotify({
      hash,
      amount,
      recipientAddress,
      assetSymbol,
      networkName,
      webhookId,
      senderAddress,
      postedAt: new Date(),
    });

    return { status: 'ok' };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Verifies the HMAC-SHA512 signature header (constant-time comparison).
   * Blockradar sends the raw hex digest (no prefix).
   */
  private verifySignature(
    rawBody: Buffer | undefined,
    sigHeader: string | undefined,
  ): boolean {
    if (!rawBody || !sigHeader) return false;
    if (sigHeader.length === 0) return false;

    try {
      const expected = hmacHex('sha512', this.apiKey, rawBody);

      // Constant-time comparison to resist timing attacks.
      const expectedBuf = Buffer.from(expected, 'utf8');
      const receivedBuf = Buffer.from(sigHeader, 'utf8');

      if (expectedBuf.length !== receivedBuf.length) return false;

      return timingSafeEqual(expectedBuf, receivedBuf);
    } catch {
      return false;
    }
  }

  /**
   * Resolves wallet, atomically settles the deposit, and — if deposited — sends
   * the WhatsApp receipt. All errors are caught and logged so the 200 ack holds.
   */
  private async settleAndNotify(params: {
    hash: string;
    amount: string;
    recipientAddress: string;
    assetSymbol: string;
    networkName: string;
    webhookId?: string;
    senderAddress?: string;
    postedAt: Date;
  }): Promise<void> {
    try {
      // ── 3. Resolve wallet by address ───────────────────────────────────────
      const wallet = await this.walletRepo.findByAddress(
        params.recipientAddress,
      );

      if (!wallet) {
        this.logger.warn(
          { recipientAddress: params.recipientAddress },
          'Blockradar webhook: no wallet found for address — ignoring',
        );
        return;
      }

      // ── 4. Atomic settlement ───────────────────────────────────────────────
      const result = await this.settlementRepo.settleDepositAtomic({
        walletId: wallet.id,
        userId: wallet.userId,
        cryptoAmount: params.amount,
        asset: params.assetSymbol,
        txHash: params.hash,
        sourceAddress: params.senderAddress,
        providerWebhookId: params.webhookId,
        postedAt: params.postedAt,
      });

      if (!result.deposited) {
        this.logger.log(
          { txHash: params.hash },
          'Blockradar webhook: duplicate txHash — already credited, skipping',
        );
        return;
      }

      // ── 5. Send WhatsApp receipt ───────────────────────────────────────────
      await this.sendReceipt({
        userId: wallet.userId,
        assetSymbol: params.assetSymbol,
        networkName: params.networkName,
        amount: params.amount,
        newBalance: result.newBalance ?? params.amount,
        txHash: params.hash,
        receiptNumber: result.receiptNumber,
      });
    } catch (err: unknown) {
      this.logger.error(
        { err, params },
        'Blockradar webhook: processing error — acking 200 anyway',
      );
    }
  }

  /**
   * Resolves the user's WhatsApp address and sends the formatted deposit receipt.
   * All errors are caught and logged.
   */
  private async sendReceipt(params: {
    userId: string;
    assetSymbol: string;
    networkName: string;
    amount: string;
    newBalance: string;
    txHash: string;
    receiptNumber?: string;
  }): Promise<void> {
    try {
      const waAddress = await this.identityService.findWhatsAppAddress(
        params.userId,
      );

      if (!waAddress) {
        this.logger.warn(
          { userId: params.userId },
          'Blockradar webhook: no WhatsApp address for user — skipping receipt',
        );
        return;
      }

      const receiptText = this.buildReceiptText(params);

      await this.sender.sendText(waAddress, receiptText);

      this.logger.log(
        { userId: params.userId, txHash: params.txHash },
        'Blockradar webhook: deposit receipt sent on WhatsApp',
      );
    } catch (err: unknown) {
      this.logger.error(
        { err, userId: params.userId },
        'Blockradar webhook: failed to send WhatsApp receipt — ignoring',
      );
    }
  }

  /**
   * Builds the plaintext deposit receipt sent to the user's WhatsApp.
   * All display values come from AssetRegistry — no hardcoded literals.
   * References the signed receipt number for auditability.
   */
  private buildReceiptText(params: {
    assetSymbol: string;
    networkName: string;
    amount: string;
    newBalance: string;
    txHash: string;
    receiptNumber?: string;
  }): string {
    // Use AssetRegistry for asset display name and formatted amounts.
    const assetMeta = this.assetRegistry.asset(params.assetSymbol);
    const formattedAmount = this.assetRegistry.formatCrypto(
      params.assetSymbol,
      params.amount,
    );
    const formattedBalance = this.assetRegistry.formatCrypto(
      params.assetSymbol,
      params.newBalance,
    );

    // Use AssetRegistry for network display name (fall back to raw name if not found).
    let networkDisplayName = params.networkName;
    try {
      const networkMeta = this.assetRegistry.network(params.networkName);
      networkDisplayName = networkMeta.displayName;
    } catch {
      // Network not in catalog — use raw name from webhook.
    }

    const shortHash = params.txHash.slice(0, 8) + '…';

    const receiptLine = params.receiptNumber
      ? `Receipt: ${params.receiptNumber}\n`
      : '';

    return (
      `✅ Deposit received\n` +
      `${formattedAmount} ${assetMeta.displayName} credited\n` +
      `Network: ${networkDisplayName}\n` +
      `Tx: ${shortHash}\n` +
      `New balance: ${formattedBalance}\n` +
      receiptLine
    );
  }
}
