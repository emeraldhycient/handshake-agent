import { MobileShell } from "@/components/mobile/mobile-shell"

export default function AppPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="relative flex h-[min(100dvh,844px)] w-full max-w-[420px] flex-col overflow-hidden shadow-2xl sm:rounded-[44px]">
        <MobileShell />
      </div>
    </main>
  )
}
