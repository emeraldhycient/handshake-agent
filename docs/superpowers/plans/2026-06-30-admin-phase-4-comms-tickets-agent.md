# Admin Dashboard — Phase 4 (Notifications / WhatsApp / Tickets / Agent) Plan

> REQUIRED SUB-SKILL: subagent-driven-development / executing-plans. TDD, frequent commits.

**Goal:** Admin control of the comms + product-config surfaces: notification-template CRUD + preview + channel enable/disable; a read-only WhatsApp config view; ticketing enablement + per-vendor commission (via the settings registry) + a read-only ticket-order list; and agent config (model id + enablement editable, system prompt read-only) + a conversation/intent log viewer.

**Architecture:** Template/conversation-log/ticket-order read+write methods added to the owning modules' repos; admin services + controllers under the admin surface, RBAC-gated (`Comms`/`Tickets`/`Agent` perm categories); ticketing + agent enablement become Phase-1 `SETTING_REGISTRY` entries (edited via `/admin/settings`). The agent's system prompt is **display-only** — never editable (§3.1: the model proposes, it must never be tuned to move money). web-admin pages.

## Global Constraints
- Agent system prompt is READ-ONLY in the admin; only `agent.modelId` (the proposing layer) + `agent.enabled` are tunable. The engine still disposes — changing the model never moves money. (§3.1)
- WhatsApp/agent SECRETS (access token, app secret, flow private key, ANTHROPIC_API_KEY) are NEVER shown/editable — env-only. The WhatsApp config view shows only non-secret values. (§7)
- Every template/config mutation audited (`config_change`/`admin_update`) + step-up on writes. Server-side authz default-deny. Cross-boundary shapes from contracts. depcruise clean.
- Don't build the greenfield ticketing ENGINE — only the admin registry/commission/enablement + a read-only TicketOrder list.

## Sub-areas (each: contracts → api repo/service/controller → web-admin → tests → gate; commit per sub-area)

### A — Notification templates
- **contracts** `admin-notification.dto.ts`: template item/list/detail (templateKey, language, channel, subject?, contentText, contentHtml?, whatsappTemplateId?, variables[]), `NotificationTemplateUpsertRequest`, `NotificationTemplatePreviewRequest`{variables: record} / `...PreviewResponse`{rendered: string}. Perms `Comms` (read/write) + web_page/menu.
- **api:** new `INotificationTemplateRepository` (list, findByKeyLangChannel, upsert) + impl; a small `NotificationTemplateRenderer` (interpolate `{{var}}` placeholders — pure). `AdminNotificationTemplateService` (list/get/upsert+audit `config_change`/preview-render). `admin-notifications.controller` (`GET/POST /admin/notification-templates`, `GET/PATCH /admin/notification-templates/:key/:language/:channel`, `POST /admin/notification-templates/preview`). RBAC + step-up on writes.
- **web-admin:** templates page (list by key/lang/channel + editor + live preview with sample vars).

### B — WhatsApp config (read-only) + enablement
- **contracts** `admin-whatsapp.dto.ts`: `WhatsAppConfigViewSchema`{graphVersion, graphBaseUrl, phoneNumberId(masked), flowId, beneficiaryFlowId, wabaId, appId, hasAppSecret:boolean, hasFlowPrivateKey:boolean, hasVerifyToken:boolean} (NON-secret + boolean "is set" for secrets). Perms `Comms` read (reuse).
- **api:** `AdminWhatsAppConfigService.getConfig()` reads the non-secret env values via ConfigService + booleans for secret presence. `admin-whatsapp.controller` `GET /admin/whatsapp/config` (Comms read). (Webhook-health + opt-in are deferred — note in the plan; they need new models.)
- **web-admin:** WhatsApp config card (read-only) within a comms page.

### C — Tickets (registry/commission/enablement + order list)
- **registry:** add `ticketing.enabled` (boolean), `ticketing.commissionBps` (number 0..10000) to `configuration.ts` (new `ticketing` section, default `{enabled:false, commissionBps:0}`) + `SETTING_REGISTRY` (category `Tickets`). (Per-vendor keys deferred until vendors exist.)
- **contracts** `admin-ticket.dto.ts`: `TicketOrderItemSchema`{id, userId, vendorKey, ticketType, quantity, totalAmount, paymentStatus, settlementStatus, deliveryStatus, createdAt}, `TicketOrderListResponseSchema`. Perms `Tickets` read + web_page/menu.
- **api:** `ITicketOrderReadRepository.list(filter,page)` + impl (read the existing `TicketOrder` table — likely empty, fine). `AdminTicketService.listOrders(query)`. `admin-tickets.controller` `GET /admin/tickets/orders`. (Enablement/commission edited via `/admin/settings` Tickets category.)
- **web-admin:** tickets page (enablement/commission link to settings + order list).

### D — Agent config + conversation logs
- **registry:** add `agent` section to `configuration.ts` (`{ enabled:true, modelId: env.AGENT_MODEL }`) + `SETTING_REGISTRY` (`agent.enabled` boolean, `agent.modelId` string — category `Agent`). Migrate `AnthropicLlmProvider` to read `agent.modelId` via `EffectiveConfigService` (small, behavior-identical when no override = today's env value); add an `agent.enabled` check in the agent gateway (when false, the agent surface returns a clear "temporarily unavailable" — never silently). 
- **contracts** `admin-agent.dto.ts`: `AgentConfigViewSchema`{modelId, enabled, systemPromptPreview: string} (system prompt READ-ONLY); `ConversationLogItemSchema`{id, userId?, contactId?, language, status, lastMessageAt?, createdAt}, `...ListResponse`; `ConversationLogDetailSchema`{conversation, messages:[{text, processingStatus, receivedAt, intent?:{action, confidence?}}], replies:[{text, status, sentAt?}]}. Perms `Agent` read + web_page/menu.
- **api:** conversation/intent/reply/message repos += `listAll(page)` / `listByConversation(id)`; `AdminAgentService.getConfig()` (modelId+enabled from EffectiveConfig, systemPromptPreview from the provider's prompt builder — read-only) + `listConversations(query)` + `getConversation(id)` (compose messages+intents+replies). `admin-agent.controller` (`GET /admin/agent/config`, `GET /admin/agent/conversations`, `GET /admin/agent/conversations/:id`). (No agent-config WRITE endpoint — model/enabled are edited via `/admin/settings` Agent category; system prompt never editable.)
- **web-admin:** agent page (config read-only card + conversation log list + detail viewer showing messages/intents/replies).

### E — gate
- Full `pnpm typecheck`/`test`/`depcruise`; admin e2es green; verify a template upsert + render, and a conversation-log read. Update memory.

## Self-review
- Safety: system prompt display-only; agent model/enabled tunable (proposing layer, engine still disposes); secrets never shown (booleans only); ticketing engine NOT built (admin registry/list only). Audit + step-up on writes. Cross-module reads via exported ports.
- Deferred (noted, not silently dropped): WhatsApp webhook-health + opt-in models, per-vendor ticket config, full ticketing engine — all need schema/product work beyond the admin dashboard.
