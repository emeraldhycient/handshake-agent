import { LoginForm } from "@/components/admin/login-form"

/**
 * /login — public admin login page. Composition only: centers the LoginForm.
 * No guard (this is how a session is established).
 */
export default function LoginRoute() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
            Handshake Admin
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to the operator console
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  )
}
