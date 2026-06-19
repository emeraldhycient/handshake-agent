import Link from "next/link"

import { Button } from "@/components/ui/button"

export default function Page() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-10">
        {/* Logo lockup */}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex items-center gap-3">
            {/* Green rounded square containing amber inner square */}
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-deep shadow-md">
              <div className="h-4 w-4 rounded-[5px] bg-accent" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              Handshake Agent
            </h1>
          </div>
          <p className="text-base font-semibold tracking-tight text-foreground">
            Chat-native crypto &amp; payments
          </p>
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            Buy, sell, send and receive crypto through natural-language
            conversation. Every money move ends with a transparent quote, a
            confirmation, and a PIN.
          </p>
        </div>

        {/* Primary entry cards */}
        <div className="flex w-full flex-col gap-3">
          <Button
            asChild
            size="lg"
            className="h-14 w-full rounded-xl bg-primary text-base font-semibold text-primary-foreground hover:bg-primary-deep"
          >
            <Link href="/app">Open mobile app</Link>
          </Button>

          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-14 w-full rounded-xl border-border text-base font-semibold text-foreground hover:bg-card-muted"
          >
            <Link href="/dashboard">Open desktop dashboard</Link>
          </Button>
        </div>

        {/* Secondary onboarding link */}
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <Link href="/onboarding">Start onboarding</Link>
        </Button>
      </div>
    </main>
  )
}
