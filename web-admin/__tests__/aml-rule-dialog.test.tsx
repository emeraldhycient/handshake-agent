/**
 * AmlRuleDialog test — the AML engine-rule create/edit form. The pure body/parse
 * helpers are unit-tested in `lib/compliance/aml-rule.test.ts`; here we assert the
 * composed dialog: create POSTs the full body, edit PATCHes the mutable fields with the
 * immutable ruleKey/ruleType disabled, invalid parameters JSON surfaces inline, and a
 * 403 opens step-up and replays. The api layer is mocked (no server).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { AmlRule } from "@handshake-agent/contracts"

import { AmlRuleDialog } from "@/components/admin/aml-rule-dialog"
import { ApiError } from "@/lib/api/client"

vi.mock("@/lib/api/compliance", () => ({
  createAmlRule: vi.fn(),
  updateAmlRule: vi.fn(),
}))
vi.mock("@/lib/api/admin", () => ({ getMe: vi.fn(), stepUp: vi.fn() }))

import { createAmlRule, updateAmlRule } from "@/lib/api/compliance"
import { getMe, stepUp } from "@/lib/api/admin"

const mockCreate = vi.mocked(createAmlRule)
const mockUpdate = vi.mocked(updateAmlRule)
const mockGetMe = vi.mocked(getMe)
const mockStepUp = vi.mocked(stepUp)

const RULE: AmlRule = {
  id: "rule-1",
  ruleKey: "velocity.daily_amount",
  name: "Daily amount cap",
  description: "Flag large daily volume",
  enabled: true,
  ruleType: "velocity_amount",
  action: "flag",
  parameters: { threshold: 5 },
  version: 1,
}

function renderDialog(rule: AmlRule | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <AmlRuleDialog open onOpenChange={vi.fn()} rule={rule} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue(RULE)
  mockUpdate.mockReset().mockResolvedValue(RULE)
  mockStepUp.mockReset().mockResolvedValue(undefined as never)
  mockGetMe.mockReset().mockResolvedValue({
    id: "a-1",
    email: "me@x.io",
    role: { id: "r-1", name: "super_admin" },
    status: "active",
    displayName: "Me",
    mfaEnabled: true,
    permissions: [],
    menus: [],
    pages: [],
  } as never)
})

describe("AmlRuleDialog", () => {
  it("creates a new rule (POST the full body incl. ruleKey + ruleType)", async () => {
    const user = userEvent.setup()
    renderDialog(null)

    expect(screen.getByText("New AML rule")).toBeInTheDocument()
    await user.type(screen.getByLabelText("Rule key"), "velocity.test")
    await user.type(screen.getByLabelText("Name"), "Test rule")
    await user.type(screen.getByLabelText("Description"), "desc")
    await user.click(screen.getByRole("button", { name: "Create" }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleKey: "velocity.test",
        name: "Test rule",
        ruleType: "velocity_amount",
        action: "flag",
        enabled: true,
        parameters: {},
      })
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("edits a rule (PATCH the mutable fields; ruleKey + ruleType immutable)", async () => {
    const user = userEvent.setup()
    renderDialog(RULE)

    expect(screen.getByText("Edit AML rule")).toBeInTheDocument()
    expect(screen.getByLabelText("Rule key")).toBeDisabled()
    expect(screen.getByLabelText("Rule type")).toBeDisabled()

    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith(
      "rule-1",
      expect.objectContaining({
        name: "Daily amount cap",
        description: "Flag large daily volume",
        action: "flag",
        enabled: true,
        parameters: { threshold: 5 },
      })
    )
  })

  it("seeds `enabled` from the rule (a disabled rule stays disabled on save)", async () => {
    const user = userEvent.setup()
    renderDialog({ ...RULE, enabled: false })

    await user.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(mockUpdate).toHaveBeenCalledWith(
      "rule-1",
      expect.objectContaining({ enabled: false })
    )
  })

  it("surfaces an invalid-parameters error inline without firing a request", async () => {
    const user = userEvent.setup()
    renderDialog(null)

    await user.type(screen.getByLabelText("Rule key"), "velocity.test")
    await user.type(screen.getByLabelText("Name"), "Test")
    await user.type(screen.getByLabelText("Description"), "desc")
    const params = screen.getByLabelText("Parameters (JSON)")
    await user.clear(params)
    await user.type(params, "not json")
    await user.click(screen.getByRole("button", { name: "Create" }))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /not valid JSON/i
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("opens step-up on a 403 and replays the create after re-auth", async () => {
    mockCreate
      .mockRejectedValueOnce(
        new ApiError("step up", 403, "ADMIN_STEP_UP_REQUIRED")
      )
      .mockResolvedValueOnce(RULE)
    const user = userEvent.setup()
    renderDialog(null)

    await user.type(screen.getByLabelText("Rule key"), "velocity.test")
    await user.type(screen.getByLabelText("Name"), "Test")
    await user.type(screen.getByLabelText("Description"), "desc")
    await user.click(screen.getByRole("button", { name: "Create" }))

    const totp = await screen.findByLabelText(/Authenticator code/)
    await user.type(totp, "123456")
    await user.click(screen.getByRole("button", { name: "Confirm" }))

    await waitFor(() => expect(mockStepUp).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2))
  })
})
