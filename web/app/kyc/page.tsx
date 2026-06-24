/**
 * /kyc — KYC web-handoff page.
 *
 * The backend's KYC CTA URL points here:
 *   ${WEB_APP_BASE_URL}/kyc?t=<handoff-token>
 *
 * Composition only: reads the token from the awaited searchParams (Promise in
 * Next 16), then delegates to the KycForm feature component or renders the
 * invalid-link empty state. No business logic here.
 */
import { KycForm } from "@/components/kyc/KycForm"

interface KycPageProps {
  searchParams: Promise<Record<string, string>>
}

export const metadata = {
  title: "Identity Verification — Handshake Agent",
  description: "Complete your KYC verification to unlock full features.",
}

export default async function KycPage({ searchParams }: KycPageProps) {
  // searchParams is a Promise in Next 16 — must await (sync access removed)
  const params = await searchParams
  const token = typeof params.t === "string" ? params.t.trim() : ""

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-foreground">
            Identity verification
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Complete this form to verify your identity and unlock full features.
          </p>
        </header>

        {token ? (
          <KycForm token={token} />
        ) : (
          /* Empty / invalid-token state */
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-4 rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-10 text-center"
          >
            <span className="text-4xl" aria-hidden="true">
              ⚠
            </span>
            <h2 className="text-lg font-semibold text-destructive">
              Invalid or expired link
            </h2>
            <p className="text-sm text-muted-foreground">
              This verification link is missing, invalid, or has already been
              used. Please return to WhatsApp and request a new link.
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
