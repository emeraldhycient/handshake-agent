// Seconds the user must wait before re-requesting an OTP. A client-side cooldown
// that mirrors the server throttle so we don't hammer login/request.
export const RESEND_COOLDOWN_SECONDS = 30
