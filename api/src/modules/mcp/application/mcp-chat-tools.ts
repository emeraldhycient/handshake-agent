/**
 * chat:propose-scope MCP tool: run one agent turn for the authenticated user
 * (Wave C).
 *
 * §3.1/§3.5 preserved end-to-end: the turn rides the SAME WebChatService the
 * web surface uses — the model interprets, KYC/catalog gates run server-side,
 * and a money-shaped intent ends at a PROPOSAL. There is no execute/authorize
 * tool on this surface and no PIN parameter anywhere; the returned instruction
 * routes the user to the web app to confirm.
 */

import { z } from 'zod';

import { defineTool, PROPOSAL_INSTRUCTION } from './mcp-tool-types';
import type { McpToolDefinition, McpToolDeps } from './mcp-tool-types';

const SendChatMessageInputSchema = z.object({
  // Same bounds as ChatMessageRequestSchema (the web POST /chat/messages body).
  text: z.string().min(1).max(1000),
  /**
   * Optional pre-selected beneficiary id — used to answer a
   * `choose_beneficiary` / `needs_beneficiary` outcome by re-sending the turn,
   * exactly like the web resolve loop. A LOOKUP KEY, never a destination.
   */
  beneficiaryId: z.string().uuid().optional(),
});

export function buildChatTools(deps: McpToolDeps): McpToolDefinition[] {
  return [
    defineTool({
      name: 'send_chat_message',
      description:
        'Send a natural-language message to the Handshake assistant (balances, history, quotes, buy/sell/send requests). Money-moving requests end at a PROPOSAL the user must confirm in the Handshake web app — nothing can be executed from this integration.',
      scope: 'chat:propose',
      inputSchema: SendChatMessageInputSchema,
      handler: async (args, principal) => {
        const response = await deps.chat.handleMessage({
          userId: principal.userId,
          text: args.text,
          beneficiaryId: args.beneficiaryId,
        });
        return {
          reply: response.reply.text,
          // Verbatim outcome: a `proposal` kind carries the itemized
          // confirmation + proposalId for the client to display.
          outcome: response.outcome,
          conversationId: response.conversationId,
          messageId: response.messageId,
          ...(response.outcome.kind === 'proposal'
            ? { instruction: PROPOSAL_INSTRUCTION }
            : {}),
        };
      },
    }),
  ];
}
