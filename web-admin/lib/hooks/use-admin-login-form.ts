"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import {
  AdminLoginRequestSchema,
  type AdminLoginRequest,
} from "@handshake-agent/contracts"

import { toErrorMessage } from "@/lib/error-message"
import { useAdminLogin } from "@/lib/query/auth"

/**
 * View-model for the admin /login form. Owns the RHF form (email + password,
 * optional TOTP / recovery behind the `showMfa` toggle) and the submit flow: it
 * strips empty optional MFA fields so the server never sees "" for an unused
 * code, logs in via `useAdminLogin` (which writes the session to the store), and
 * on success navigates to '/'. On failure the error surfaces via
 * `loginMutation.error` → `serverError`. Pure client logic — no fetch/axios here.
 */
export function useAdminLoginForm() {
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

  const onFormSubmit = handleSubmit(async (values) => {
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
  })

  return {
    register,
    errors,
    showMfa,
    setShowMfa,
    loading: isSubmitting || loginMutation.isPending,
    serverError: toErrorMessage(loginMutation.error),
    onFormSubmit,
  }
}
