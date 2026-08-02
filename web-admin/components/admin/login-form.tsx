"use client"

/**
 * LoginForm — the admin /login form.
 *
 * Fields: email + password (required) and optional TOTP / recovery code (shown
 * behind a "use a multi-factor code" toggle). Composition only: the RHF form +
 * submit/navigate flow live in `useAdminLoginForm`. On success it navigates to
 * '/'; on failure the error branch renders the server message (e.g. "A
 * multi-factor code is required").
 *
 * Strict layering: pure UI — no fetch, no axios, no localStorage.
 */
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useAdminLoginForm } from "@/lib/hooks/use-admin-login-form"
import type { LoginFormProps } from "@/types"

export function LoginForm({ className }: LoginFormProps) {
  const {
    register,
    errors,
    showMfa,
    setShowMfa,
    loading,
    serverError,
    onFormSubmit,
  } = useAdminLoginForm()

  return (
    <form
      onSubmit={onFormSubmit}
      noValidate
      aria-label="Admin log in form"
      className={`flex flex-col gap-5 ${className ?? ""}`}
    >
      {serverError && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {serverError}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="admin-email">Email address</Label>
        <Input
          id="admin-email"
          type="email"
          autoComplete="username"
          aria-required="true"
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? "admin-email-error" : undefined}
          placeholder="you@example.com"
          disabled={loading}
          {...register("email")}
        />
        {errors.email && (
          <p
            id="admin-email-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.email.message ?? "Enter a valid email address"}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="admin-password">Password</Label>
        <Input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          aria-required="true"
          aria-invalid={!!errors.password}
          aria-describedby={errors.password ? "admin-password-error" : undefined}
          placeholder="Your password"
          disabled={loading}
          {...register("password")}
        />
        {errors.password && (
          <p
            id="admin-password-error"
            role="alert"
            className="text-xs text-destructive"
          >
            {errors.password.message ?? "Enter your password"}
          </p>
        )}
      </div>

      {showMfa ? (
        <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-totp">Authenticator code (TOTP)</Label>
            <Input
              id="admin-totp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              disabled={loading}
              {...register("totp")}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="admin-recovery">Recovery code</Label>
            <Input
              id="admin-recovery"
              type="text"
              autoComplete="off"
              placeholder="Use if you can't access your authenticator"
              disabled={loading}
              {...register("recoveryCode")}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="text-left text-sm text-muted-foreground underline underline-offset-2"
          onClick={() => setShowMfa(true)}
        >
          Use a multi-factor code
        </button>
      )}

      <Button
        type="submit"
        size="lg"
        disabled={loading}
        aria-busy={loading}
        className="mt-1 w-full"
      >
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}
