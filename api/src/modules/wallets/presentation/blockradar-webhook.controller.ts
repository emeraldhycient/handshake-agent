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
 *   6. Respond 200 on a genuinely-processed outcome (credited, idempotent
 *      duplicate, or a deliberate non-credit ack). A *settlement* failure
 *      (settleDepositAtomic throws) → 503 so Blockradar retries the webhook
 *      (idempotent on txHash — never double-credits). Invalid signature → 401.
 *      Receipt-send errors are best-effort: swallowed + logged, never a 5xx.
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
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';

import { hmacHex } from '../../../core/crypto/hmac';
import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { IdentityService } from '../../identity/application/identity.service';
import {
  WHATSAPP_SENDER,
  type IWhatsAppSender,
} from '../../whatsapp/application/ports/whatsapp-sender.port';
import { ExecutionService } from '../../transactions/application/execution.service';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
} from '../application/ports/wallet.repository.port';
import {
  DEPOSIT_SETTLEMENT_REPOSITORY,
  type IDepositSettlementRepository,
  type SettleDepositAtomicOutput,
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
    /** Present on withdraw.success/withdraw.failed events — our idempotencyKey passed to withdraw. */
    reference?: unknown;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

// Provider machine-to-machine callback: authenticated by HMAC signature, not by
// IP. Exempt from the global IP-keyed throttler so a legitimate deposit/settlement
// burst from Blockradar's egress IP is never 429'd (funds-safety — settlement must
// not be dropped). Forged calls are still rejected fast by verifySignature (401).
@Controller('webhooks')
@SkipThrottle()
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
    private readonly executionService: ExecutionService,
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

    if (payload?.event === 'deposit.success') {
      return this.handleDepositSuccess(payload);
    }

    if (payload?.event === 'withdraw.success') {
      return this.handleWithdrawEvent(payload, true);
    }

    if (payload?.event === 'withdraw.failed') {
      return this.handleWithdrawEvent(payload, false);
    }

    if (payload?.event === 'swap.success') {
      return this.handleSwapEvent(payload, true);
    }

    if (payload?.event === 'swap.failed') {
      return this.handleSwapEvent(payload, false);
    }

    this.logger.log(
      { event: payload?.event },
      'Blockradar webhook: unhandled event — acking without processing',
    );
    return { status: 'ok' };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Private event-routing handlers
  // ---------------------------------------------------------------------------

  /**
   * Handles event=deposit.success: maps fields and delegates to settleAndNotify.
   */
  private async handleDepositSuccess(
    payload: BlockradarWebhookBody,
  ): Promise<AckResponse> {
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

    // WN-4: ack-without-credit when asset symbol is missing — never default to 'USDT'.
    if (typeof data?.asset?.symbol !== 'string' || !data.asset.symbol) {
      this.logger.warn(
        { data },
        'Blockradar webhook: deposit.success missing asset.symbol — acking without credit',
      );
      return { status: 'ok' };
    }
    const assetSymbol = data.asset.symbol;
    const networkName =
      typeof data?.asset?.network?.name === 'string'
        ? data.asset.network.name
        : undefined;
    const webhookId = typeof data?.id === 'string' ? data.id : undefined;

    // Extract on-chain sender address for audit persistence.
    const senderAddress =
      typeof data?.senderAddress === 'string' ? data.senderAddress : undefined;

    // Ack-then-process: errors must NOT change the 200.
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

  /**
   * Handles event=withdraw.success or withdraw.failed: routes to
   * ExecutionService.settleSendOnChain using the reference (our idempotencyKey)
   * and the on-chain tx hash (for success). Errors are swallowed.
   */
  private async handleWithdrawEvent(
    payload: BlockradarWebhookBody,
    success: boolean,
  ): Promise<AckResponse> {
    const data = payload.data;
    const reference = data?.reference;

    if (typeof reference !== 'string' || reference.length === 0) {
      this.logger.warn(
        { data, success },
        'Blockradar webhook: withdraw event missing reference — acking without processing',
      );
      return { status: 'ok' };
    }

    // on-chain tx hash is only meaningful for success events.
    const onChainTxHash =
      success && typeof data?.hash === 'string' ? data.hash : undefined;

    // Ack-then-process: errors must NOT change the 200.
    await this.settleSendAndNotify({ reference, success, onChainTxHash });

    return { status: 'ok' };
  }

  /**
   * Calls ExecutionService.settleSendOnChain and — if completed — sends the
   * WhatsApp receipt. Errors are caught and logged.
   */
  private async settleSendAndNotify(params: {
    reference: string;
    success: boolean;
    onChainTxHash?: string;
  }): Promise<void> {
    try {
      const result = await this.executionService.settleSendOnChain({
        reference: params.reference,
        success: params.success,
        onChainTxHash: params.onChainTxHash,
      });

      if (result.status === 'pending') {
        this.logger.log(
          { reference: params.reference },
          'Blockradar webhook: send settlement pending — will process on retry',
        );
        return;
      }

      // Settlement confirmed — send receipt on WhatsApp.
      if (result.userId) {
        try {
          const waAddress = await this.identityService.findWhatsAppAddress(
            result.userId,
          );
          if (waAddress) {
            const receiptText = this.buildWithdrawReceiptText(result);
            await this.sender.sendText(waAddress, receiptText);
            this.logger.log(
              { userId: result.userId, reference: params.reference },
              'Blockradar webhook: send receipt sent on WhatsApp',
            );
          }
        } catch (notifyErr: unknown) {
          this.logger.error(
            { notifyErr, userId: result.userId },
            'Blockradar webhook: failed to send send WhatsApp receipt — ignoring',
          );
        }
      }
    } catch (err: unknown) {
      this.logger.error(
        { err, reference: params.reference },
        'Blockradar webhook: send settlement threw — acking 200 anyway',
      );
    }
  }

  /**
   * Handles event=swap.success or swap.failed: routes to
   * ExecutionService.settleSwap using the reference (our idempotencyKey),
   * the toAmount received, and the on-chain hash (for success). Errors are swallowed.
   */
  private async handleSwapEvent(
    payload: BlockradarWebhookBody,
    success: boolean,
  ): Promise<AckResponse> {
    const data = payload.data;
    const reference = data?.reference;

    if (typeof reference !== 'string' || reference.length === 0) {
      this.logger.warn(
        { data, success },
        'Blockradar webhook: swap event missing reference — acking without processing',
      );
      return { status: 'ok' };
    }

    const toAmount =
      success && typeof data?.amount === 'string' ? data.amount : undefined;
    const hash =
      success && typeof data?.hash === 'string' ? data.hash : undefined;

    // Ack-then-process: errors must NOT change the 200.
    await this.settleSwapAndNotify({ reference, success, toAmount, hash });

    return { status: 'ok' };
  }

  /**
   * Calls ExecutionService.settleSwap and swallows errors so the 200 ack holds.
   */
  private async settleSwapAndNotify(params: {
    reference: string;
    success: boolean;
    toAmount?: string;
    hash?: string;
  }): Promise<void> {
    try {
      const result = await this.executionService.settleSwap({
        reference: params.reference,
        success: params.success,
        toAmount: params.toAmount,
        hash: params.hash,
      });

      this.logger.log(
        { reference: params.reference, status: result.status },
        'Blockradar webhook: swap settled',
      );
    } catch (err: unknown) {
      this.logger.error(
        { err, reference: params.reference },
        'Blockradar webhook: swap settlement threw — acking 200 anyway',
      );
    }
  }

  /**
   * Builds a plaintext on-chain send receipt / failure notice for WhatsApp.
   */
  private buildWithdrawReceiptText(result: {
    status: 'completed' | 'failed' | 'pending';
    transactionId: string;
    receiptNumber?: string;
  }): string {
    if (result.status === 'completed') {
      const ref = result.receiptNumber ?? result.transactionId;
      return (
        `✅ Your crypto send is complete!\n` +
        `Receipt: ${ref}\n` +
        `Your USDT has been sent on-chain. Reply "balance" to check your balance.`
      );
    }
    return (
      `⚠️ Send failed\n` +
      `Your USDT has been refunded to your Handshake wallet. ` +
      `Reply "balance" to check your balance.`
    );
  }

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
   * the WhatsApp receipt.
   *
   * Funds-safety (CLAUDE.md §3.1): a *settlement* failure (settleDepositAtomic
   * throws on misconfig/DB/transient error, e.g. ReceiptNotSignableError) must
   * NOT be acked 200 — that would tell Blockradar the deposit is processed and
   * it would never retry, silently losing the credit. We rethrow as a retryable
   * 503 so Blockradar redelivers the webhook. Deliberate non-credit outcomes
   * (wallet not found, network mismatch, unsupported asset) and the idempotent
   * duplicate (`deposited:false`) are genuinely processed → return (200).
   *
   * The *receipt-send* step is best-effort and already swallows its own errors
   * (sendReceipt) — the money has moved, so a notify failure never forces a retry.
   */
  private async settleAndNotify(params: {
    hash: string;
    amount: string;
    recipientAddress: string;
    assetSymbol: string;
    networkName: string | undefined;
    webhookId?: string;
    senderAddress?: string;
    postedAt: Date;
  }): Promise<void> {
    // ── 3. Resolve wallet by address ─────────────────────────────────────────
    const wallet = await this.walletRepo.findByAddress(params.recipientAddress);

    if (!wallet) {
      this.logger.warn(
        { recipientAddress: params.recipientAddress },
        'Blockradar webhook: no wallet found for address — ignoring',
      );
      return;
    }

    // ── 3a. Network mismatch guard (WN-4) ───────────────────────────────────
    // The per-network wallet has a `network` field set at creation time.
    // If the payload's network name doesn't match, ack without credit —
    // a cross-network attribution error must never be silently credited.
    if (
      params.networkName !== undefined &&
      params.networkName !== wallet.network
    ) {
      this.logger.warn(
        {
          payloadNetwork: params.networkName,
          walletNetwork: wallet.network,
          recipientAddress: params.recipientAddress,
        },
        'Blockradar webhook: payload network does not match wallet.network — acking without credit',
      );
      return;
    }

    // ── 3b. Asset guard — only credit enabled/known assets (WN-2) ───────────
    // A per-network address receives ANY token on its chain. If the deposited
    // asset is not registered/enabled in the catalog, log and ack — do NOT
    // credit an unknown token to the ledger (no crash, no credit).
    if (!this.assetRegistry.isAssetEnabled(params.assetSymbol)) {
      this.logger.warn(
        {
          assetSymbol: params.assetSymbol,
          recipientAddress: params.recipientAddress,
        },
        'Blockradar webhook: deposited asset not supported in catalog — ignoring deposit',
      );
      return;
    }

    // ── 4. Atomic settlement ─────────────────────────────────────────────────
    // A throw here is a genuine settlement FAILURE — propagate it so the caller
    // returns 5xx and Blockradar retries (settleDepositAtomic is idempotent on
    // txHash, so a redelivery never double-credits).
    let result: SettleDepositAtomicOutput;
    try {
      result = await this.settlementRepo.settleDepositAtomic({
        walletId: wallet.id,
        userId: wallet.userId,
        cryptoAmount: params.amount,
        asset: params.assetSymbol,
        txHash: params.hash,
        sourceAddress: params.senderAddress,
        providerWebhookId: params.webhookId,
        postedAt: params.postedAt,
      });
    } catch (err: unknown) {
      this.logger.error(
        { err, params },
        'Blockradar webhook: settlement failed — returning 503 so Blockradar retries',
      );
      throw new ServiceUnavailableException(
        'Deposit settlement failed — please retry',
      );
    }

    if (!result.deposited) {
      this.logger.log(
        { txHash: params.hash },
        'Blockradar webhook: duplicate txHash — already credited, skipping',
      );
      return;
    }

    // ── 5. Send WhatsApp receipt ─────────────────────────────────────────────
    // WN-4: params.networkName may be undefined when the payload omitted it;
    // fall back to wallet.network for the human-readable receipt copy.
    // sendReceipt swallows its own errors — the deposit is already settled, so a
    // notify failure must NOT force a 5xx (avoids a credited deposit re-firing).
    await this.sendReceipt({
      userId: wallet.userId,
      assetSymbol: params.assetSymbol,
      networkName: params.networkName ?? wallet.network,
      amount: params.amount,
      newBalance: result.newBalance ?? params.amount,
      txHash: params.hash,
      receiptNumber: result.receiptNumber,
    });
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
