// Seconds the user must wait before re-requesting an OTP. A client-side cooldown
// that mirrors the server throttle so we don't hammer login/request.
export const RESEND_COOLDOWN_SECONDS = 30

// Default OTP validity window (seconds). Mirrors the server's
// `auth.otp.ttlSeconds` config default (api/src/modules/auth/application/
// auth.service.ts) — the signup/login-request response carries no explicit
// expiry, so the client seeds its countdown from this constant the moment a
// code is sent.
export const OTP_TTL_SECONDS = 300
