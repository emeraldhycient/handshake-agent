import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { WhatsAppConfigView } from '@handshake-agent/contracts';

import type { Env } from '../../../core/config/env.schema';

/**
 * Phase 4 (wave 1) — the admin Comms READ-ONLY WhatsApp configuration view. It
 * surfaces the NON-SECRET WhatsApp Cloud-API / Flows wiring (graph version + ids)
 * plus a boolean presence flag for each secret. The secret VALUES (app secret,
 * Flow private key, verify token) NEVER cross this boundary (§3.5) — only whether
 * each is configured. It reads the layered env via ConfigService; there is no
 * write path and it never moves money (§3.1).
 */
@Injectable()
export class AdminWhatsAppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  getConfig(): WhatsAppConfigView {
    return {
      graphVersion: this.config.get('WHATSAPP_GRAPH_VERSION', { infer: true }),
      graphBaseUrl: this.config.get('WHATSAPP_GRAPH_BASE_URL', { infer: true }),
      phoneNumberId: this.config.get('WHATSAPP_PHONE_NUMBER_ID', {
        infer: true,
      }),
      flowId: this.config.get('WHATSAPP_FLOW_ID', { infer: true }),
      beneficiaryFlowId: this.config.get('WHATSAPP_BENEFICIARY_FLOW_ID', {
        infer: true,
      }),
      wabaId: this.config.get('WHATSAPP_WABA_ID', { infer: true }),
      appId: this.config.get('WHATSAPP_APP_ID', { infer: true }),
      hasAppSecret: Boolean(
        this.config.get('WHATSAPP_APP_SECRET', { infer: true }),
      ),
      hasFlowPrivateKey: Boolean(
        this.config.get('WHATSAPP_FLOW_PRIVATE_KEY', { infer: true }),
      ),
      hasVerifyToken: Boolean(
        this.config.get('WHATSAPP_VERIFY_TOKEN', { infer: true }),
      ),
    };
  }
}
