/**
 * SettingField tests.
 *
 *  1. A number setting renders its value + a source badge ('default'/'db') and
 *     calls updateSetting with the PARSED numeric value on Save.
 *  2. A non-editable (editable:false) setting renders disabled (no Save).
 *  3. A boolean capability renders a Switch.
 *  4. A Save that 403s with ADMIN_STEP_UP_REQUIRED opens the StepUpDialog.
 *
 * The settings + auth api layers are mocked — no server. `getMe` (useAdminMe)
 * drives the step-up dialog's password-vs-TOTP branch.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AdminMe, EffectiveSetting } from "@handshake-agent/contracts"

import { SettingField } from "@/components/admin/setting-field"
import { ApiError } from "@/lib/api/client"

// ─── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api/settings", () => ({
  listSettings: vi.fn(),
  getSetting: vi.fn(),
  updateSetting: vi.fn(),
}))

vi.mock("@/lib/api/admin", () => ({
  getMe: vi.fn(),
  stepUp: vi.fn(),
}))

import { updateSetting } from "@/lib/api/settings"
import { getMe, stepUp } from "@/lib/api/admin"

const mockUpdate = vi.mocked(updateSetting)
const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ME: AdminMe = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "me@example.com",
  role: { id: "00000000-0000-0000-0000-0000000000ff", name: "super_admin" },
  status: "active",
  mfaEnabled: false, // → step-up asks for a password
  permissions: [],
  menus: ["menu.config"],
  pages: ["/admin/settings"],
}

function numberSetting(
  overrides: Partial<EffectiveSetting> = {}
): EffectiveSetting {
  return {
    key: "pricing.processingFeeBps",
    category: "Pricing",
    label: "Processing fee (bps)",
    description: "Platform processing fee.",
    valueType: "number",
    editable: true,
    value: 150,
    source: "default",
    scope: "global",
    scopeValue: null,
    ...overrides,
  }
}

function booleanSetting(): EffectiveSetting {
  return {
    key: "catalog.capabilities.crypto.swap",
    category: "Catalog",
    label: "Capability: crypto swap",
    description: "Enable asset-to-asset swaps.",
    valueType: "boolean",
    editable: true,
    value: false,
    source: "default",
    scope: "global",
    scopeValue: null,
  }
}

function renderField(setting: EffectiveSetting) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SettingField
        setting={setting}
        gridClassName="grid-cols-[1.5fr_1fr_0.7fr_1.5fr_0.9fr]"
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockUpdate.mockReset()
  mockGetMe.mockReset()
  mockStepUp.mockReset()
  mockGetMe.mockResolvedValue(ME)
})

describe("SettingField", () => {
  it("renders a number value + a 'default' source badge and saves the parsed numeric value", async () => {
    mockUpdate.mockResolvedValue(numberSetting({ value: 200, source: "db" }))
    const user = userEvent.setup()
    renderField(numberSetting())

    // Value rendered in the number input.
    const input = screen.getByLabelText(
      "Processing fee (bps)"
    ) as HTMLInputElement
    expect(input.value).toBe("150")

    // Source badge ('default' for the env/JSON baseline).
    expect(screen.getByText("default")).toBeInTheDocument()

    // Edit then Save → updateSetting called with a NUMBER, not a string.
    await user.clear(input)
    await user.type(input, "200")
    await user.click(screen.getByRole("button", { name: /^save$/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith("pricing.processingFeeBps", {
      value: 200,
      scope: "global",
      scopeValue: null,
    })
  })

  it("renders an 'overridden' badge when the source is a db override", () => {
    renderField(numberSetting({ source: "db" }))
    expect(screen.getByText("overridden")).toBeInTheDocument()
  })

  it("renders a non-editable setting disabled with no Save", () => {
    renderField(numberSetting({ editable: false }))
    const input = screen.getByLabelText("Processing fee (bps)")
    expect(input).toBeDisabled()
    expect(
      screen.queryByRole("button", { name: /^save$/i })
    ).not.toBeInTheDocument()
  })

  it("renders a boolean capability as a Switch", () => {
    renderField(booleanSetting())
    const toggle = screen.getByRole("switch", {
      name: "Capability: crypto swap",
    })
    expect(toggle).toBeInTheDocument()
    expect(toggle).not.toBeChecked()
  })

  it("opens the step-up dialog on ADMIN_STEP_UP_REQUIRED, then retries after re-auth", async () => {
    // First save 403s with the step-up code; the retry (after step-up) succeeds.
    mockUpdate
      .mockRejectedValueOnce(
        new ApiError("Re-auth required.", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(numberSetting({ value: 200, source: "db" }))
    mockStepUp.mockResolvedValue(undefined)

    const user = userEvent.setup()
    renderField(numberSetting())

    // Wait for useAdminMe so mfaEnabled is known to the dialog.
    await waitFor(() => expect(mockGetMe).toHaveBeenCalled())

    const input = screen.getByLabelText("Processing fee (bps)")
    await user.clear(input)
    await user.type(input, "200")
    await user.click(screen.getByRole("button", { name: /^save$/i }))

    // The step-up dialog opens (password field, since mfaEnabled=false).
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent(/confirm it's you/i)
    const passwordField = await screen.findByLabelText(/^password$/i)

    // Re-authenticate → step-up called, then the save retried (2 total).
    await user.type(passwordField, "supersecret")
    await user.click(screen.getByRole("button", { name: /^confirm$/i }))

    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2))
  })
})
