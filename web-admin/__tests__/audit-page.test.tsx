/**
 * AuditPage — certification of the "Export" action.
 *
 * The design binds the header Export button to `exportAudit()`, which toasts
 * "Exporting audit log to CSV…". This asserts the button is live and emits that
 * exact confirmation (a read-shaped mock — no file is produced yet).
 */
import { describe, expect, it, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { AuditPage } from "@/components/admin/audit-page"
import { defaultToastStore } from "@/lib/store/toast-store"

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
})

describe("AuditPage", () => {
  it("toasts the CSV export confirmation when Export is clicked", async () => {
    const user = userEvent.setup()
    render(<AuditPage />)

    await user.click(screen.getByRole("button", { name: /Export/i }))

    const { toasts } = defaultToastStore.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe("Exporting audit log to CSV…")
    expect(toasts[0].kind).toBe("info")
  })
})
