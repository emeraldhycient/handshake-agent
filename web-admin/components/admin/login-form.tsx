"use client"

/**
 * LoginForm — the admin /login form.
 *
 * Fields: email + password (required) and optional TOTP / recovery code (shown
 * behind a "use a multi-factor code" toggle). react-hook-form +
 * zodResolver(AdminLoginRequestSchema). On success the useAdminLogin hook writes
 * the session to the store; we then router.push('/'). On failure the error
 * branch renders the server message (e.g. "A multi-factor code is required").
 *
 * Strict layering: pure UI — no fetch, no axios, no localStorage.
 */
import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import {
  AdminLoginRequestSchema,
  type AdminLoginRequest,
} from "@handshake-agent/contracts"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useAdminLogin } from "@/lib/query/auth"
import { ApiError } from "@/lib/api/client"
import type { LoginFormProps } from "@/types/components"

function errorMessage(error: unknown): string | null {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return error ? String(error) : null
}

export function LoginForm({ className }: LoginFormProps) {
  const router = useRouter()
  const [showMfa, setShowMfa] = useState(false)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AdminLoginRequest>({
    resolver: zodResolver(AdminLoginRequestSchema),
    defaultValues: { email: "", password: "" },
  })

  const loginMutation = useAdminLogin()

  async function onSubmit(values: AdminLoginRequest) {
    // Strip empty optional fields so the server doesn't see "" for unused MFA.
    const payload: AdminLoginRequest = {
      email: values.email,
      password: values.password,
      ...(values.totp ? { totp: values.totp } : {}),
      ...(values.recoveryCode ? { recoveryCode: values.recoveryCode } : {}),
    }
    try {
      await loginMutation.mutateAsync(payload)
      router.push("/")
    } catch {
      // Error surfaces via loginMutation.error — rendered below.
    }
  }

  const loading = isSubmitting || loginMutation.isPending
  const serverError = errorMessage(loginMutation.error)

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
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
          aria-describedby={
            errors.password ? "admin-password-error" : undefined
          }
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
