/**
 * LimitsPage test (design §6.26) — wired to real per-tier limit settings, raised as a
 * four-eyes ChangeRequest (Wave I).
 *
 * The per-tier caps resolve from the `limits.NGN.<tier>.*` registry keys (GET
 * /admin/settings, mocked). Design rows the registry has no key for render "—". Editing
 * an amount cap opens value → reason → dual-control; the maker-checker submit RAISES a
 * `tier_override` ChangeRequest (createChange) for a SECOND admin to approve — it does
 * NOT write the setting directly. The api layer is mocked — no server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ChangeRequest, EffectiveSetting } from "@handshake-agent/contracts"

import { LimitsPage } from "@/components/admin/limits-page"
import { defaultToastStore } from "@/lib/store/toast-store"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/config", () => ({
  listEffectiveSettings: vi.fn(),
  setSetting: vi.fn(),
}))

// The four-eyes maker-checker raise (POST /admin/approvals).
vi.mock("@/lib/api/approvals", () => ({
  createChange: vi.fn(),
}))

// The signed-in admin (drives the step-up dialog's password-vs-TOTP mode).
vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
}))

import { listEffectiveSettings, setSetting } from "@/lib/api/config"
import { createChange } from "@/lib/api/approvals"
import { getMe } from "@/lib/api/admin"

const mockList = vi.mocked(listEffectiveSettings)
const mockSet = vi.mocked(setSetting)
const mockCreate = vi.mocked(createChange)
const mockGetMe = vi.mocked(getMe)

// ─── Fixture ──────────────────────────────────────────────────────────────────

function limit(
  key: string,
  value: number,
  category = "KYC"
): EffectiveSetting {
  return {
    key,
    category,
    label: key,
    description: `Limit ${key}`,
    valueType: "number",
    editable: true,
    value,
    source: "default",
    scope: "global",
    scopeValue: null,
  }
}

/** A pending ChangeRequest the mocked createChange resolves with (bypasses parse). */
const PENDING_CHANGE: ChangeRequest = {
  id: "22222222-2222-2222-2222-222222222222",
  kind: "tier_override",
  resource: "limits.NGN.tier_1.perTxFiatMax",
  payload: {},
  status: "pending",
  reason: "Ops correction",
  requestedByAdminId: "11111111-1111-1111-1111-111111111111",
  requestedByEmail: "amara@handshake.ng",
  decidedByAdminId: null,
  decidedByEmail: null,
  decisionReason: null,
  decidedAt: null,
  createdAt: "2026-07-09T00:00:00.000Z",
}

// Only tier_1 needs real values for the assertions; the mapper handles missing tiers.
// The new-beneficiary hold is a GLOBAL Beneficiary-category leaf (not per-tier).
const LIMIT_SETTINGS: EffectiveSetting[] = [
  limit("limits.NGN.tier_1.perTxFiatMax", 200000),
  limit("limits.NGN.tier_1.dailyFiatMax", 500000),
  limit("limits.NGN.tier_1.weeklyFiatMax", 3000000),
  limit("limits.NGN.tier_1.perSendOnChainFiatMax", 100000),
  limit("limits.NGN.tier_1.sendsPer10MinMax", 5),
  limit("limits.NGN.tier_1.dailyTxCountMax", 10),
  limit("beneficiary.cryptoCoolingOffSeconds", 86400, "Beneficiary"),
  limit("compliance.tierChangeCoolingOffSeconds", 3600, "Compliance"),
]

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <LimitsPage />
    </QueryClientProvider>
  )
}

/** Drive the shared flow chain: reason → dual-control submit. The REAL step-up is
 *  server-driven (403 → StepUpDialog). */
async function advanceThroughApproval(
  user: ReturnType<typeof userEvent.setup>
) {
  await user.type(
    screen.getByRole("textbox", { name: "Reason" }),
    "Ops correction"
  )
  await user.click(screen.getByRole("button", { name: "Continue" }))
  await user.click(screen.getByRole("button", { name: "Submit for approval" }))
}

beforeEach(() => {
  defaultToastStore.setState({ toasts: [] })
  mockList.mockReset()
  mockList.mockResolvedValue(LIMIT_SETTINGS)
  mockSet.mockReset()
  mockSet.mockResolvedValue(limit("limits.NGN.tier_1.perTxFiatMax", 300000))
  mockCreate.mockReset()
  mockCreate.mockResolvedValue(PENDING_CHANGE)
  mockGetMe.mockReset()
  mockGetMe.mockResolvedValue({
    id: "11111111-1111-1111-1111-111111111111",
    email: "amara@handshake.ng",
    role: { id: "00000000-0000-0000-0000-000000000001", name: "Super Admin" },
    status: "active",
    displayName: "Test Admin",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages: [],
  })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LimitsPage (four-eyes tier_override)", () => {
  it("renders the tier tabs and the real per-tier caps", async () => {
    renderPage()

    expect(
      screen.getByRole("heading", { name: "Limits & velocity" })
    ).toBeInTheDocument()
    // The tier tabs render only after the settings resolve (data branch).
    expect(await screen.findByRole("tab", { name: "Tier 1" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
    // The real per-transaction cap (200,000 → "₦200,000.00").
    expect(screen.getByText("₦200,000.00")).toBeInTheDocument()
    // The real daily cap (500,000 → "₦500,000.00").
    expect(screen.getByText("₦500,000.00")).toBeInTheDocument()
    // The real daily tx-count (10) is the one backed velocity row.
    expect(screen.getByText("10")).toBeInTheDocument()
  })

  it("raises a tier_override ChangeRequest (not a direct setSetting) when submitted", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit Per-transaction max" })
    )

    const input = screen.getByRole("textbox", { name: "New value (NGN)" })
    await user.clear(input)
    await user.type(input, "300000")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await advanceThroughApproval(user)

    // A four-eyes change request is raised against tier_1's per-tx cap key,
    // mirroring the setSetting body 1:1 inside the payload, with the reason.
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      kind: "tier_override",
      resource: "limits.NGN.tier_1.perTxFiatMax",
      payload: {
        key: "limits.NGN.tier_1.perTxFiatMax",
        value: 300000,
        scope: "global",
        scopeValue: null,
      },
      reason: "Ops correction",
    })
    // Nothing is written directly — no optimistic settings mutation fires.
    expect(mockSet).not.toHaveBeenCalled()
    // The copy says submitted-for-approval and the flow closed.
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "Submitted for approval" })
    )
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("targets the daily-cap key when the daily row is edited", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit Daily max · rolling 24h" })
    )
    const input = screen.getByRole("textbox", { name: "New value (NGN)" })
    await user.clear(input)
    await user.type(input, "750000")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughApproval(user)

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      kind: "tier_override",
      resource: "limits.NGN.tier_1.dailyFiatMax",
      payload: {
        key: "limits.NGN.tier_1.dailyFiatMax",
        value: 750000,
        scope: "global",
        scopeValue: null,
      },
      reason: "Ops correction",
    })
  })

  it("rejects a reason shorter than 3 chars — no change request is raised", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit Per-transaction max" })
    )
    const input = screen.getByRole("textbox", { name: "New value (NGN)" })
    await user.clear(input)
    await user.type(input, "300000")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    // Type only 2 chars — the reason step's Continue must stay disabled.
    await user.type(screen.getByRole("textbox", { name: "Reason" }), "no")
    const continueBtn = screen.getByRole("button", { name: "Continue" })
    expect(continueBtn).toBeDisabled()
    await user.click(continueBtn)

    expect(
      screen.queryByRole("button", { name: "Submit for approval" })
    ).not.toBeInTheDocument()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("does not offer to edit a row whose config key is absent from the read (§3.6 guard)", async () => {
    // A read missing the sends/10-min key → that row renders "—" with NO editor, even
    // though every other row is backed. The guard is about resolvability, not the label.
    mockList.mockResolvedValue(
      LIMIT_SETTINGS.filter((s) => !s.key.endsWith("sendsPer10MinMax"))
    )
    renderPage()
    await screen.findByRole("tab", { name: "Tier 1" })
    expect(
      screen.queryByRole("button", { name: "Edit Sends / 10-min window" })
    ).not.toBeInTheDocument()
    expect(
      await screen.findByRole("button", { name: "Edit Per-transaction max" })
    ).toBeInTheDocument()
  })

  it("raises a tier_override for the sends / 10-min window (a count leaf)", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit Sends / 10-min window" })
    )
    const input = screen.getByRole("textbox", { name: "New value (count)" })
    await user.clear(input)
    await user.type(input, "8")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughApproval(user)

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      kind: "tier_override",
      resource: "limits.NGN.tier_1.sendsPer10MinMax",
      payload: {
        key: "limits.NGN.tier_1.sendsPer10MinMax",
        value: 8,
        scope: "global",
        scopeValue: null,
      },
      reason: "Ops correction",
    })
  })

  it("raises a tier_override for the tier-change cooling-off (a global seconds leaf)", async () => {
    const user = userEvent.setup()
    renderPage()

    // 3600s renders humanized as "1h".
    expect(await screen.findByText("1h")).toBeInTheDocument()
    await user.click(
      await screen.findByRole("button", {
        name: "Edit Cooling-off after tier change",
      })
    )
    const input = screen.getByRole("textbox", { name: "New value (seconds)" })
    await user.clear(input)
    await user.type(input, "7200")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughApproval(user)

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      kind: "tier_override",
      resource: "compliance.tierChangeCoolingOffSeconds",
      payload: {
        key: "compliance.tierChangeCoolingOffSeconds",
        value: 7200,
        scope: "global",
        scopeValue: null,
      },
      reason: "Ops correction",
    })
  })

  it("raises a tier_override for the single on-chain send max", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", {
        name: "Edit Single on-chain send max",
      })
    )
    const input = screen.getByRole("textbox", { name: "New value (NGN)" })
    await user.clear(input)
    await user.type(input, "80000")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughApproval(user)

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      kind: "tier_override",
      resource: "limits.NGN.tier_1.perSendOnChainFiatMax",
      payload: {
        key: "limits.NGN.tier_1.perSendOnChainFiatMax",
        value: 80000,
        scope: "global",
        scopeValue: null,
      },
      reason: "Ops correction",
    })
  })

  it("configures limits for a NON-NGN currency via the currency selector (multi-currency)", async () => {
    // GHS per-tx key is registered but UNSET (value undefined) — the editor must still
    // appear (shown as "Not set") so the operator can configure a new currency's limits.
    mockList.mockResolvedValue([
      ...LIMIT_SETTINGS,
      { ...limit("limits.GHS.tier_1.perTxFiatMax", 0), value: undefined },
    ])
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole("tab", { name: "Tier 1" })

    // Switch the currency selector to GHS.
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Limits currency" }),
      "GHS"
    )

    // The (unset) GHS per-tx cap is editable; the field label reflects the currency.
    await user.click(
      await screen.findByRole("button", { name: "Edit Per-transaction max" })
    )
    const input = screen.getByRole("textbox", { name: "New value (GHS)" })
    await user.clear(input)
    await user.type(input, "5000")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughApproval(user)

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      kind: "tier_override",
      resource: "limits.GHS.tier_1.perTxFiatMax",
      payload: {
        key: "limits.GHS.tier_1.perTxFiatMax",
        value: 5000,
        scope: "global",
        scopeValue: null,
      },
      reason: "Ops correction",
    })
  })

  it("raises a tier_override for the weekly max (rolling 7-day cap)", async () => {
    const user = userEvent.setup()
    renderPage()

    // 3,000,000 → "₦3,000,000.00" renders, and the row is editable.
    await user.click(
      await screen.findByRole("button", {
        name: "Edit Weekly max · rolling 7d",
      })
    )
    const input = screen.getByRole("textbox", { name: "New value (NGN)" })
    await user.clear(input)
    await user.type(input, "4000000")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughApproval(user)

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      kind: "tier_override",
      resource: "limits.NGN.tier_1.weeklyFiatMax",
      payload: {
        key: "limits.NGN.tier_1.weeklyFiatMax",
        value: 4000000,
        scope: "global",
        scopeValue: null,
      },
      reason: "Ops correction",
    })
  })

  it("opens the step-up dialog and retries the raise after re-auth when the server demands step-up", async () => {
    const user = userEvent.setup()
    const { ApiError } = await import("@/lib/api/client")
    mockCreate
      .mockRejectedValueOnce(
        new ApiError("Step-up required", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(PENDING_CHANGE)

    renderPage()
    await user.click(
      await screen.findByRole("button", { name: "Edit Per-transaction max" })
    )
    const input = screen.getByRole("textbox", { name: "New value (NGN)" })
    await user.clear(input)
    await user.type(input, "300000")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughApproval(user)

    expect(await screen.findByText("Confirm it's you")).toBeInTheDocument()
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it("shows the error branch with a retry when the settings read fails", async () => {
    mockList.mockRejectedValueOnce(new Error("boom"))
    renderPage()

    expect(await screen.findByText("Failed to load limits")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument()
  })

  it("raises a tier_override for the daily transaction-count cap (a count leaf)", async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(
      await screen.findByRole("button", { name: "Edit Transactions / day" })
    )
    const input = screen.getByRole("textbox", { name: "New value (count)" })
    await user.clear(input)
    await user.type(input, "20")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughApproval(user)

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      kind: "tier_override",
      resource: "limits.NGN.tier_1.dailyTxCountMax",
      payload: {
        key: "limits.NGN.tier_1.dailyTxCountMax",
        value: 20,
        scope: "global",
        scopeValue: null,
      },
      reason: "Ops correction",
    })
  })

  it("raises a tier_override for the global new-beneficiary cooling-off (a seconds leaf)", async () => {
    const user = userEvent.setup()
    renderPage()

    // 86400s renders humanized as "1d".
    expect(await screen.findByText("1d")).toBeInTheDocument()
    await user.click(
      await screen.findByRole("button", { name: "Edit New-beneficiary hold" })
    )
    const input = screen.getByRole("textbox", { name: "New value (seconds)" })
    await user.clear(input)
    await user.type(input, "172800")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    await advanceThroughApproval(user)

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    // The global leaf (no tier suffix) is raised with the raw seconds value.
    expect(mockCreate).toHaveBeenCalledWith({
      kind: "tier_override",
      resource: "beneficiary.cryptoCoolingOffSeconds",
      payload: {
        key: "beneficiary.cryptoCoolingOffSeconds",
        value: 172800,
        scope: "global",
        scopeValue: null,
      },
      reason: "Ops correction",
    })
    // The copy says submitted-for-approval.
    expect(defaultToastStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "Submitted for approval" })
    )
  })
})
