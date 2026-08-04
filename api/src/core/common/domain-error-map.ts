/**
 * DomainExceptionFilter's client-facing error allow-list (I1/I2).
 *
 * This is the pure, framework-free data half of the global exception filter
 * (`domain-exception.filter.ts`): the stable-`code` → { status, message } map and
 * the reverse status → canonical-reason-phrase table. It is deliberately a
 * standalone module so the filter class stays small and this policy table — which
 * grows an entry for every new cross-boundary domain error — reads as one list.
 *
 * Matching is by the error's stable `code` (its documented cross-boundary
 * discriminant), so this file imports NO feature error classes — it stays
 * decoupled from every module's domain. Anything not allow-listed here falls
 * through to a generic 500 in the filter, with the original error logged
 * server-side only.
 *
 * Messages are deliberately generic — the raw domain message (which may carry
 * limits, balances, addresses, or compliance event ids) is NEVER sent to the
 * client; only logged server-side.
 */

import { HttpStatus } from '@nestjs/common';

export interface MappedError {
  status: HttpStatus;
  message: string;
}

/**
 * Allow-list: domain `code` → client-facing { status, message }.
 * Messages are deliberately generic — the raw domain message (which may carry
 * limits, balances, addresses, or compliance event ids) is NEVER sent to the
 * client; only logged server-side.
 */
export const DOMAIN_ERROR_MAP: Readonly<Record<string, MappedError>> = {
  // ── Authorization (PIN + directive) → 401 ──────────────────────────────────
  PIN_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Authorization failed.',
  },
  PIN_NOT_SET: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Authorization failed.',
  },
  PIN_LOCKED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Your PIN is temporarily locked. Please try again later.',
  },
  DIRECTIVE_EXPIRED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Your authorization expired. Please try again.',
  },
  DIRECTIVE_REPLAY: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Authorization failed.',
  },
  DIRECTIVE_PROPOSAL_MISMATCH: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Authorization failed.',
  },
  DIRECTIVE_SIGNATURE_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Authorization failed.',
  },
  // Fresh device-bound step-up missing/expired (e.g. adding a withdrawal
  // destination, R2) → 403 so the client can prompt a re-auth / step-up.
  STEP_UP_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Please re-authenticate on a trusted device to continue.',
  },

  // ── KYC / limits / velocity / SIM-swap / sanctions → 403 ───────────────────
  // Each cause gets a DISTINCT, actionable message so the user can tell *why* a
  // transaction was blocked and what to do — without leaking exact limits,
  // balances, or compliance detail (those stay server-side only). Previously all
  // of these collapsed to one opaque "not permitted" line, which read as "the
  // whole app is broken" when the real cause was usually a per-transaction cap.
  KYC_NOT_VERIFIED: {
    status: HttpStatus.FORBIDDEN,
    message:
      'Please finish verifying your identity before making this transaction.',
  },
  // Task 1.3: the account's KYC tier is below the minimum required for the
  // requested capability (e.g. a tier_1/email-verified account trying to
  // send/sell/swap, which need tier_2) — distinct from KYC_NOT_VERIFIED so the
  // client can point the user at identity verification specifically.
  CAPABILITY_TIER_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message:
      'Verify your identity to unlock this — sending, selling and swapping ' +
      'need identity verification.',
  },
  TIER_LIMIT_EXCEEDED: {
    status: HttpStatus.FORBIDDEN,
    message:
      'This amount is above the per-transaction limit for your account. ' +
      'Try a smaller amount, or verify a higher tier to raise your limits.',
  },
  SEND_LIMIT_EXCEEDED: {
    status: HttpStatus.FORBIDDEN,
    message:
      'This amount is above the send limit for your account. ' +
      'Try a smaller amount, or verify a higher tier to raise your limits.',
  },
  TIER_CHANGE_COOLING_OFF: {
    status: HttpStatus.FORBIDDEN,
    message:
      'Your account was updated recently, so transactions are briefly on hold ' +
      'for your security. Please try again a little later.',
  },
  VELOCITY_EXCEEDED: {
    status: HttpStatus.FORBIDDEN,
    message:
      "You've reached your transaction limit for now. Please try again later.",
  },
  SIM_SWAP_BLOCKED: {
    status: HttpStatus.FORBIDDEN,
    message:
      'For your security, transactions are paused after a recent SIM or ' +
      'phone-number change. Please re-verify your identity to continue.',
  },
  // Sanctions stays deliberately vague (no tipping-off) but points to a path
  // the user can actually take, distinct from the self-serviceable limit errors.
  SANCTIONS_BLOCKED: {
    status: HttpStatus.FORBIDDEN,
    message: "This transaction can't be completed. Please contact support.",
  },

  // ── Validation / wrong state → 422 / 409 ───────────────────────────────────
  SELL_INSUFFICIENT_BALANCE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Insufficient balance for this transaction.',
  },
  ENGINE_PROPOSAL_EXPIRED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'This proposal has expired. Please start again.',
  },
  ENGINE_QUOTE_DRIFT: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'The quote changed. Please re-quote and try again.',
  },
  SWAP_SAME_ASSET: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'Choose two different assets to swap.',
  },
  // Swap unavailable is a non-retryable "capability not offered right now"
  // condition — 422, NOT a retryable 502/503 that invites endless retries.
  SWAP_PROVIDER_UNAVAILABLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      "Swap isn't available right now. Please try again later or contact support.",
  },
  ENGINE_PROPOSAL_NOT_EXECUTABLE: {
    status: HttpStatus.CONFLICT,
    message: 'This proposal can no longer be processed.',
  },
  ENGINE_SETTLEMENT_INVALID_STATUS: {
    status: HttpStatus.CONFLICT,
    message: 'This transaction can no longer be processed.',
  },

  // ── Transient / provider-unavailable / fail-closed config → 503 ────────────
  AGENT_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'The assistant is temporarily unavailable. Please try again.',
  },
  SANCTIONS_SCREENING_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Service temporarily unavailable. Please try again.',
  },
  ENGINE_BASE_RATE_MISCONFIGURED: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Service temporarily unavailable. Please try again.',
  },
  RECEIPT_NOT_SIGNABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Service temporarily unavailable. Please try again.',
  },
  DIRECTIVE_NOT_MINTABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'Service temporarily unavailable. Please try again.',
  },

  // ── Beneficiaries → 403 (first-use lock) / 404 / 422 ───────────────────────
  BENEFICIARY_COOLING_OFF: {
    status: HttpStatus.FORBIDDEN,
    message:
      'For your security, newly added recipients have a short cooling-off ' +
      'period before the first transfer. Please try again later.',
  },
  BENEFICIARY_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Recipient not found.',
  },
  BENEFICIARY_INVALID_ADDRESS: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      "That address isn't valid for the selected network. " +
      'Please check it and try again.',
  },
  BENEFICIARY_INVALID_ACCOUNT_NUMBER: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      "That account number isn't valid for the selected currency. " +
      'Please check it and try again.',
  },
  BENEFICIARY_WRONG_TYPE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "That recipient can't be used for this transaction.",
  },
  BENEFICIARY_CURRENCY_MISMATCH: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      "That bank account can't receive this currency. " +
      'Please add or pick a bank account in the same currency.',
  },
  BENEFICIARY_UNKNOWN_COUNTRY: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'That country is not supported for bank accounts.',
  },
  BENEFICIARY_NAME_ENQUIRY_FAILED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      "We couldn't verify that bank account. " +
      'Please check the details and try again.',
  },

  // ── Admin platform (RBAC console) → 401 / 403 / 404 / 409 / 410 ─────────────
  // Distinct principal from end users; messages are admin-operator-facing (no
  // end-user fund detail), and the `code` is echoed so the admin UI can react
  // (e.g. ADMIN_STEP_UP_REQUIRED → open the re-auth modal).
  ADMIN_INVALID_CREDENTIALS: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'Invalid credentials.',
  },
  // Per-account lockout after too many failed logins (credential-stuffing guard,
  // §3.3) → 429, mirroring the end-user OTP/PIN lockout.
  ADMIN_ACCOUNT_LOCKED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Too many failed attempts. This account is temporarily locked.',
  },
  ADMIN_MFA_REQUIRED: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'A multi-factor code is required.',
  },
  ADMIN_MFA_INVALID: {
    status: HttpStatus.UNAUTHORIZED,
    message: 'The multi-factor code is invalid.',
  },
  ADMIN_INACTIVE: {
    status: HttpStatus.FORBIDDEN,
    message: 'This admin account is not active.',
  },
  ADMIN_STEP_UP_REQUIRED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Please re-authenticate to perform this action.',
  },
  ADMIN_PERMISSION_DENIED: {
    status: HttpStatus.FORBIDDEN,
    message: 'You do not have permission to perform this action.',
  },
  ADMIN_BOOTSTRAP_FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: 'Bootstrap is not available.',
  },
  ADMIN_NOT_FOUND: {
    status: HttpStatus.NOT_FOUND,
    message: 'Not found.',
  },
  ADMIN_BUILTIN_ROLE_IMMUTABLE: {
    status: HttpStatus.CONFLICT,
    message: 'Built-in roles cannot be modified.',
  },
  ADMIN_INVITATION_INVALID: {
    status: HttpStatus.GONE,
    message: 'This invitation is invalid or has expired.',
  },
  // Transaction triage (Phase 3B): the txn is in a state that cannot be triaged
  // (not settling, or a type with no reserve to refund) → 409 Conflict.
  ADMIN_TXN_NOT_TRIAGEABLE: {
    status: HttpStatus.CONFLICT,
    message: 'This transaction cannot be triaged in its current state.',
  },
  // Payout retry (go-readiness #2): the owning user failed the server-side re-check
  // at retry time (KYC/tier/SIM-swap/cooling-off/compliance block) → 403. The retry
  // service opens a compliance escalation before this is thrown (§3.3).
  ADMIN_PAYOUT_RETRY_BLOCKED: {
    status: HttpStatus.FORBIDDEN,
    message: 'This payout cannot be retried for this account.',
  },
  // Approvals / maker-checker (Phase 7): four-eyes enforcement + decision guards.
  ADMIN_SELF_APPROVAL_FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: 'You cannot approve or reject your own change request.',
  },
  // Admin lifecycle self-guard: an operator cannot suspend/offboard themselves.
  ADMIN_SELF_ACTION_FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: 'You cannot suspend or offboard your own admin account.',
  },
  ADMIN_CHANGE_REQUEST_NOT_PENDING: {
    status: HttpStatus.CONFLICT,
    message: 'This change request has already been decided.',
  },
  ADMIN_CHANGE_REQUEST_NOT_APPLICABLE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'This change request cannot be applied.',
  },
  ADMIN_BULK_CONFIRMATION_REQUIRED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      'This broadcast is over the large-set threshold; explicit confirmation is required.',
  },
  // Manual credit (Phase 7): the credited user's server-side state forbids it
  // (deactivated / sanctions-flagged / no wallet on the asset's network) → 422.
  ADMIN_MANUAL_CREDIT_NOT_ALLOWED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'A manual credit is not allowed for this user.',
  },
  // A client-supplied fiat code is not in the live catalog (built-in + custom) → 422.
  ADMIN_UNSUPPORTED_CURRENCY: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'That currency is not in the fiat catalog.',
  },
  // A broadcast referenced a template key absent from the template store → 422.
  ADMIN_BROADCAST_TEMPLATE_UNKNOWN: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'That notification template does not exist.',
  },

  // ── Admin config settings (layered-config console) → 409 / 422 ──────────────
  ADMIN_SETTING_NOT_EDITABLE: {
    status: HttpStatus.CONFLICT,
    message: 'This setting cannot be edited.',
  },
  ADMIN_SETTING_INVALID: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'The proposed value is invalid for this setting.',
  },
  ADMIN_MULTI_CURRENCY_INVARIANT: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      'This change would leave an enabled currency without limits or pricing.',
  },
  // Runtime "Add currency": the proposed code collides with a built-in catalog
  // fiat or an existing custom fiat (a custom fiat may not shadow a currency) → 409.
  ADMIN_CURRENCY_COLLISION: {
    status: HttpStatus.CONFLICT,
    message: 'A currency with this code already exists.',
  },

  // ── Amount guards (engine) → 422 — clear, non-sensitive validation copy ─────
  AMOUNT_TOO_SMALL: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'That amount is below the minimum allowed for this transaction.',
  },
  AMOUNT_TOO_LARGE: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: 'That amount is above the maximum allowed for this transaction.',
  },
  SELF_SEND_BLOCKED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "That's your own wallet address — no transfer is needed.",
  },
  // A user-supplied raw send address failed the network's pattern validation
  // (createSendProposal raw_address branch) → 422, never an opaque 500.
  INVALID_SEND_ADDRESS: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      "That address isn't valid for the selected network. " +
      'Please check it and try again.',
  },

  // ── Auth / PIN-setup / KYC (backstops; controllers also map these) ─────────
  PIN_WEAK: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      'Choose a stronger PIN: 4–6 digits, not all the same and not a simple sequence.',
  },
  PIN_SETUP_NOT_VERIFIED: {
    status: HttpStatus.FORBIDDEN,
    message: 'Please complete identity verification before setting a PIN.',
  },
  PIN_ALREADY_SET: {
    status: HttpStatus.CONFLICT,
    message: 'A PIN is already set for this account.',
  },
  OTP_LOCKED: {
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Too many attempts. Please request a new code.',
  },
  // Device-bind unique-constraint collision (§3.4 one-device-per-identity): the
  // fingerprint is already pinned to another account. Previously escaped as a raw
  // Prisma P2002 → opaque 500. → 409 with an actionable, non-leaking message.
  DEVICE_ALREADY_BOUND: {
    status: HttpStatus.CONFLICT,
    message:
      'This device is already linked to another account. ' +
      'Log in with that account, or use a different device.',
  },
  KYC_REJECTED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message:
      "We couldn't verify your identity with the details provided. " +
      'Please check them and try again.',
  },
  // Task 3.4: requesting a Sumsub WebSDK token for a tier the account hasn't
  // earned the prerequisite rung for (e.g. tier_3 before tier_2) → 403.
  SUMSUB_PREREQUISITE_NOT_MET: {
    status: HttpStatus.FORBIDDEN,
    message:
      'Please complete the previous verification step before continuing.',
  },
  // POST /profile/name is pre-verification name capture ONLY — the name is
  // immutable once KYC has started (verified against NIN/BVN and relied on as
  // the FATF Travel-Rule originator identity, root CLAUDE.md §3.4) → 409.
  NAME_CHANGE_NOT_ALLOWED: {
    status: HttpStatus.CONFLICT,
    message: 'Your name is locked once identity verification has started.',
  },

  // ── Handle resolver / PayID / public nicknames (Spec 2) → 409 / 422 ────────
  // PayID and public nicknames share one namespace (design §4.2): claiming a
  // nickname or renaming a PayID against an already-claimed handle → 409.
  HANDLE_TAKEN: {
    status: HttpStatus.CONFLICT,
    message: 'That handle is already taken. Please choose another.',
  },
  // A user may hold at most a fixed number of public nicknames → 422.
  NICKNAME_CAP_EXCEEDED: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "You've reached the maximum number of public nicknames.",
  },
  // A PayID may be changed exactly once → 409 on a second attempt.
  PAYID_ALREADY_CHANGED: {
    status: HttpStatus.CONFLICT,
    message:
      'Your PayID has already been changed once and cannot be changed again.',
  },
};

export const STATUS_TEXT: Readonly<Record<number, string>> = {
  [HttpStatus.UNAUTHORIZED]: 'Unauthorized',
  [HttpStatus.FORBIDDEN]: 'Forbidden',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
  [HttpStatus.GONE]: 'Gone',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'Unprocessable Entity',
  [HttpStatus.TOO_MANY_REQUESTS]: 'Too Many Requests',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'Internal Server Error',
};
