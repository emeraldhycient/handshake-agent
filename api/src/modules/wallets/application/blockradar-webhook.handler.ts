/**
 * BlockradarWebhookHandler — the async processing body for Blockradar webhooks.
 *
 * Runs in the worker (WebhookProcessor → registry) on a persisted WebhookEvent,
 * AFTER the controller has verified the signature. It carries the exact routing
 * + settlement + notify logic that used to live inline in the controller
 * (deposit / withdraw / swap), now keyed off `event.payload`.
 *
 * Funds-safety (§3.1): a genuine settlement FAILURE THROWS so BullMQ retries with
 * backoff (and dead-letters on exhaustion) — this replaces the old inline 503 that
 * asked Blockradar to retry. settleDepositAtomic is idempotent on txHash, so a
 * retry never double-credits. Deliberate non-credit acks (wallet-not-found,
 * network mismatch, unsupported asset, missing fields, unhandled event) return
 * normally (success). Receipt sends are best-effort and swallow their own errors.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import { AssetRegistry } from '../../../core/catalog/asset-registry';
import { IdentityService } from '../../identity/application/identity.service';
import {
  WHATSAPP_SENDER,
  type IWhatsAppSender,
} from '../../whatsapp/application/ports/whatsapp-sender.port';
import { ExecutionService } from '../../transactions/application/execution.service';
import type { WebhookHandler } from '../../webhooks/application/ports/webhook-handler.port';
import type { WebhookEventRecord } from '../../webhooks/application/ports/webhook-event.repository.port';
import {
  WALLET_REPOSITORY,
  type IWalletRepository,
} from './ports/wallet.repository.port';
import {
  DEPOSIT_SETTLEMENT_REPOSITORY,
  type IDepositSettlementRepository,
  type SettleDepositAtomicOutput,
} from './ports/deposit-settlement.repository.port';

// Defensive shape of a Blockradar webhook body (parsed at runtime).
interface BlockradarWebhookBody {
  event?: unknown;
  data?: {
    hash?: unknown;
    amount?: unknown;
    recipientAddress?: unknown;
    senderAddress?: unknown;
    asset?: { symbol?: unknown; network?: { name?: unknown } };
    id?: unknown;
    reference?: unknown;
    [key: string]: unknown;
  };
}

@Injectable()
export class BlockradarWebhookHandler implements WebhookHandler {
  readonly provider = 'blockradar';
  private readonly logger = new Logger(BlockradarWebhookHandler.name);

  constructor(
    @Inject(WALLET_REPOSITORY)
    private readonly walletRepo: IWalletRepository,
    @Inject(DEPOSIT_SETTLEMENT_REPOSITORY)
    private readonly settlementRepo: IDepositSettlementRepository,
    private readonly identityService: IdentityService,
    @Inject(WHATSAPP_SENDER)
    private readonly sender: IWhatsAppSender,
    private readonly assetRegistry: AssetRegistry,
    private readonly executionService: ExecutionService,
  ) {}

  async handle(event: WebhookEventRecord): Promise<void> {
    const payload = event.payload as BlockradarWebhookBody;

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
  }

  // ---------------------------------------------------------------------------
  // deposit.success
  // ---------------------------------------------------------------------------

  private async handleDepositSuccess(
    payload: BlockradarWebhookBody,
  ): Promise<void> {
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
      return;
    }

    // WN-4: ack-without-credit when asset symbol is missing — never default.
    if (typeof data?.asset?.symbol !== 'string' || !data.asset.symbol) {
      this.logger.warn(
        { data },
        'Blockradar webhook: deposit.success missing asset.symbol — acking without credit',
      );
      return;
    }
    const assetSymbol = data.asset.symbol;
    const networkName =
      typeof data?.asset?.network?.name === 'string'
        ? data.asset.network.name
        : undefined;
    const webhookId = typeof data?.id === 'string' ? data.id : undefined;
    const senderAddress =
      typeof data?.senderAddress === 'string' ? data.senderAddress : undefined;

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
  }

  /**
   * Resolves the wallet, atomically settles, and — if credited — sends the
   * WhatsApp receipt. A settlement FAILURE throws (BullMQ retries; idempotent on
   * txHash so a retry never double-credits, §3.1). Deliberate non-credit
   * outcomes and the idempotent duplicate return normally.
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
    const wallet = await this.walletRepo.findByAddress(params.recipientAddress);
    if (!wallet) {
      this.logger.warn(
        { recipientAddress: params.recipientAddress },
        'Blockradar webhook: no wallet found for address — ignoring',
      );
      return;
    }

    // WN-4: network mismatch guard.
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

    // WN-2: only credit enabled/known assets.
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
      // A settlement failure is retryable — throw so the worker retries (the
      // atomic is idempotent on txHash; a redelivery never double-credits).
      this.logger.error(
        { err, params },
        'Blockradar webhook: settlement failed — throwing so the worker retries',
      );
      throw err instanceof Error ? err : new Error('deposit settlement failed');
    }

    if (!result.deposited) {
      this.logger.log(
        { txHash: params.hash },
        'Blockradar webhook: duplicate txHash — already credited, skipping',
      );
      return;
    }

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

  // ---------------------------------------------------------------------------
  // withdraw.success / withdraw.failed
  // ---------------------------------------------------------------------------

  private async handleWithdrawEvent(
    payload: BlockradarWebhookBody,
    success: boolean,
  ): Promise<void> {
    const data = payload.data;
    const reference = data?.reference;

    if (typeof reference !== 'string' || reference.length === 0) {
      this.logger.warn(
        { data, success },
        'Blockradar webhook: withdraw event missing reference — acking without processing',
      );
      return;
    }

    const onChainTxHash =
      success && typeof data?.hash === 'string' ? data.hash : undefined;

    await this.settleSendAndNotify({ reference, success, onChainTxHash });
  }

  private async settleSendAndNotify(params: {
    reference: string;
    success: boolean;
    onChainTxHash?: string;
  }): Promise<void> {
    // A settlement EXCEPTION is retryable — let it propagate so the worker
    // retries with backoff (+ dead-letters on exhaustion). settleSendOnChain is
    // idempotent, so a retry (or the reconciler re-driving in parallel) never
    // double-settles (§3.1).
    const result = await this.executionService.settleSendOnChain({
      reference: params.reference,
      success: params.success,
      onChainTxHash: params.onChainTxHash,
    });

    if (result.status === 'pending') {
      // Not a failure — the withdrawal isn't confirmed yet. The next webhook /
      // reconciler tick finalizes it. Ack the webhook as processed.
      this.logger.log(
        { reference: params.reference },
        'Blockradar webhook: send settlement pending — will finalize later',
      );
      return;
    }

    // Best-effort receipt — a notify failure must NOT fail the job.
    if (result.userId) {
      try {
        const waAddress = await this.identityService.findWhatsAppAddress(
          result.userId,
        );
        if (waAddress) {
          await this.sender.sendText(
            waAddress,
            this.buildWithdrawReceiptText(result),
          );
        }
      } catch (notifyErr: unknown) {
        this.logger.error(
          { notifyErr, userId: result.userId },
          'Blockradar webhook: failed to send send WhatsApp receipt — ignoring',
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // swap.success / swap.failed
  // ---------------------------------------------------------------------------

  private async handleSwapEvent(
    payload: BlockradarWebhookBody,
    success: boolean,
  ): Promise<void> {
    const data = payload.data;
    const reference = data?.reference;

    if (typeof reference !== 'string' || reference.length === 0) {
      this.logger.warn(
        { data, success },
        'Blockradar webhook: swap event missing reference — acking without processing',
      );
      return;
    }

    const toAmount =
      success && typeof data?.amount === 'string' ? data.amount : undefined;
    const hash =
      success && typeof data?.hash === 'string' ? data.hash : undefined;

    await this.settleSwapAndNotify({ reference, success, toAmount, hash });
  }

  private async settleSwapAndNotify(params: {
    reference: string;
    success: boolean;
    toAmount?: string;
    hash?: string;
  }): Promise<void> {
    // A settlement EXCEPTION is retryable — propagate so the worker retries +
    // dead-letters. settleSwap is idempotent (the reconciler also re-drives).
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
  }

  // ---------------------------------------------------------------------------
  // Receipt rendering
  // ---------------------------------------------------------------------------

  private buildWithdrawReceiptText(result: {
    status: 'completed' | 'failed' | 'pending';
    transactionId: string;
    receiptNumber?: string;
    assetSymbol?: string;
  }): string {
    const assetDisplayName = result.assetSymbol
      ? this.assetRegistry.asset(result.assetSymbol).displayName
      : this.assetRegistry.asset(this.assetRegistry.defaultCryptoAsset())
          .displayName;

    if (result.status === 'completed') {
      const ref = result.receiptNumber ?? result.transactionId;
      return (
        `✅ Your crypto send is complete!\n` +
        `Receipt: ${ref}\n` +
        `Your ${assetDisplayName} has been sent on-chain. Reply "balance" to check your balance.`
      );
    }
    return (
      `⚠️ Send failed\n` +
      `Your ${assetDisplayName} has been refunded to your Handshake wallet. ` +
      `Reply "balance" to check your balance.`
    );
  }

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
    } catch (err: unknown) {
      this.logger.error(
        { err, userId: params.userId },
        'Blockradar webhook: failed to send WhatsApp receipt — ignoring',
      );
    }
  }

  private buildReceiptText(params: {
    assetSymbol: string;
    networkName: string;
    amount: string;
    newBalance: string;
    txHash: string;
    receiptNumber?: string;
  }): string {
    const assetMeta = this.assetRegistry.asset(params.assetSymbol);
    const formattedAmount = this.assetRegistry.formatCrypto(
      params.assetSymbol,
      params.amount,
    );
    const formattedBalance = this.assetRegistry.formatCrypto(
      params.assetSymbol,
      params.newBalance,
    );

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
