import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { AxiosError } from 'axios';

import type { Env } from '../../../core/config/env.schema';
import type {
  IWhatsAppSender,
  SendBeneficiaryFlowInput,
  SendCtaUrlInput,
  SendFlowInput,
  SendResult,
} from '../application/ports/whatsapp-sender.port';

/**
 * Shape of a non-2xx Cloud API error body.
 * `error_data` is optional; Meta only includes it on some error types.
 */
interface CloudApiErrorBody {
  error: {
    message: string;
    type: string;
    code: number;
    error_data?: unknown;
  };
}

/** Shape of the Cloud API success response for message sends. */
interface CloudApiSendResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

/**
 * Outbound Cloud API adapter — implements `IWhatsAppSender`.
 *
 * Uses `HttpService` (injected) so callers can mock it in unit tests without
 * network access. Config is read via `ConfigService<Env, true>` to keep
 * credentials out of the agent/application layer (root CLAUDE.md §3.2).
 */
@Injectable()
export class CloudApiSender implements IWhatsAppSender {
  private readonly messagesUrl: string;
  private readonly authHeader: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Env, true>,
  ) {
    const base = this.config.get<'WHATSAPP_GRAPH_BASE_URL'>(
      'WHATSAPP_GRAPH_BASE_URL',
    );
    const version = this.config.get<'WHATSAPP_GRAPH_VERSION'>(
      'WHATSAPP_GRAPH_VERSION',
    );
    const phoneNumberId = this.config.get<'WHATSAPP_PHONE_NUMBER_ID'>(
      'WHATSAPP_PHONE_NUMBER_ID',
    );
    const token = this.config.get<'WHATSAPP_ACCESS_TOKEN'>(
      'WHATSAPP_ACCESS_TOKEN',
    );

    this.messagesUrl = `${base}/${version}/${phoneNumberId}/messages`;
    this.authHeader = `Bearer ${token}`;
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    };
    return this.post(payload);
  }

  async sendTemplate(
    to: string,
    name: string,
    languageCode: string,
    components?: unknown[],
  ): Promise<SendResult> {
    const template: {
      name: string;
      language: { code: string };
      components?: unknown[];
    } = { name, language: { code: languageCode } };

    if (components !== undefined) {
      template.components = components;
    }

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template,
    };
    return this.post(payload);
  }

  async sendCtaUrl(input: SendCtaUrlInput): Promise<SendResult> {
    const { to, body, buttonText, url } = input;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        body: { text: body },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: buttonText,
            url,
          },
        },
      },
    };

    return this.post(payload);
  }

  async sendFlow(input: SendFlowInput): Promise<SendResult> {
    const { to, flowId, flowToken, cta, screen, data } = input;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: {
          text: 'Please complete the secure form to confirm your transaction.',
        },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: flowToken,
            flow_id: flowId,
            flow_cta: cta,
            flow_action: 'navigate',
            flow_action_payload: { screen, data },
          },
        },
      },
    };

    return this.post(payload);
  }

  async sendBeneficiaryFlow(
    input: SendBeneficiaryFlowInput,
  ): Promise<SendResult> {
    const { to, flowId, flowToken, type, beneficiaries } = input;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: {
          text: 'Select a saved payout account or add a new one.',
        },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: flowToken,
            flow_id: flowId,
            flow_cta: 'Manage Accounts',
            flow_action: 'navigate',
            flow_action_payload: {
              screen: 'SELECT',
              data: {
                type,
                beneficiaries,
              },
            },
          },
        },
      },
    };

    return this.post(payload);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async post(body: unknown): Promise<SendResult> {
    const headers = {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
    };

    try {
      const response = await firstValueFrom(
        this.http.post<CloudApiSendResponse>(this.messagesUrl, body, {
          headers,
        }),
      );
      return { externalMessageId: response.data.messages[0].id };
    } catch (err: unknown) {
      // Cloud API errors: axios rejects with an AxiosError that carries a
      // structured error body in `response.data`. Surface message + code so
      // callers can act on them; do not swallow.
      const axiosErr = err as AxiosError<CloudApiErrorBody>;
      const apiError = axiosErr?.response?.data?.error;
      if (apiError) {
        throw new Error(
          `WhatsApp Cloud API error (code ${apiError.code}): ${apiError.message}`,
        );
      }
      throw err;
    }
  }
}
