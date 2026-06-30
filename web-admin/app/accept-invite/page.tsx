import { Suspense } from "react"

import { AcceptInviteForm } from "@/components/admin/accept-invite-form"

/**
 * /accept-invite?token=… — public page where an invited admin sets a password.
 * Composition only. The form reads the token via useSearchParams, which Next 16
 * requires to sit under a Suspense boundary.
 */
export default function AcceptInviteRoute() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
            Accept your invitation
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Set a password to activate your admin account
          </p>
        </div>
        <Suspense
          fallback={
            <p className="text-center text-sm text-muted-foreground">
              Loading…
            </p>
          }
        >
          <AcceptInviteForm />
        </Suspense>
      </div>
    </main>
  )
}
