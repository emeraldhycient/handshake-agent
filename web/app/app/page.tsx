import { MobileShell } from "@/components/mobile/mobile-shell"

export default function AppPage() {
  return (
    <main className="min-h-svh bg-background sm:flex sm:items-center sm:justify-center sm:p-6">
      {/* Full-bleed on mobile; framed phone-width preview only at sm+ (desktop). */}
      <div className="relative flex h-svh w-full flex-col overflow-hidden bg-background sm:h-[min(100dvh,844px)] sm:max-w-[420px] sm:rounded-[44px] sm:shadow-2xl">
        <MobileShell />
      </div>
    </main>
  )
}
