import type { ReactNode } from "react"

/** The design card/panel (rounded-2xl, 1px line, --card bg, 18/20 padding). */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-[18px_20px]">
      {children}
    </div>
  )
}
