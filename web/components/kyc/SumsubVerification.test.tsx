/**
 * TDD tests for SumsubVerification — the Sumsub WebSDK verification surface.
 *
 * The component mints a WebSDK access token for the requested rung (tier_2 doc +
 * liveness, or tier_3 proof of address) via POST /kyc/sumsub/token, then hands it
 * to `<SumsubWebSdk>`. It never grants a tier itself — the engine does that
 * server-side off the Sumsub webhook (root §3.1). Its job here: fetch the token
 * for the level, render the SDK, surface the four async branches, and fire
 * `onSubmitted` when the applicant finishes inside the iframe.
 *
 * The real WebSDK is mocked to a stub that echoes its accessToken and exposes a
 * button to emit a completion message, so we can assert wiring without a network.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

// ─── Mock the WebSDK default export ─────────────────────────────────────────
vi.mock("@sumsub/websdk-react", () => ({
  default: (props: {
    accessToken: string
    onMessage?: (type: string, payload?: unknown) => void
    onError?: (e: unknown) => void
  }) => {
    return (
      <div data-testid="sumsub-sdk">
        <span data-testid="sdk-token">{props.accessToken}</span>
        <button
          type="button"
          onClick={() => props.onMessage?.("idCheck.onApplicantSubmitted")}
        >
          emit-submitted
        </button>
        <button
          type="button"
          onClick={() => props.onError?.(new Error("iframe failed to load"))}
        >
          emit-error
        </button>
      </div>
    )
  },
}))

// ─── Mock the token mutation hook ───────────────────────────────────────────
const mockMutate = vi.fn()
const mockMutateAsync = vi.fn()
let mockTokenState: {
  data?: { token: string; userId: string }
  isPending: boolean
  isError: boolean
  error: unknown
}
vi.mock("@/lib/query/kyc-onboarding", () => ({
  useSumsubToken: vi.fn(() => ({
    mutate: mockMutate,
    mutateAsync: mockMutateAsync,
    ...mockTokenState,
  })),
}))

import { SumsubVerification } from "./SumsubVerification"

describe("SumsubVerification", () => {
  beforeEach(() => {
    mockMutate.mockReset()
    mockMutateAsync.mockReset()
    mockTokenState = { isPending: true, isError: false, error: undefined }
  })

  it("mints a token for the requested level on mount", () => {
    render(<SumsubVerification level="tier_3" />)
    expect(mockMutate).toHaveBeenCalledWith("tier_3")
  })

  it("shows a loading branch while the token is minting", () => {
    mockTokenState = { isPending: true, isError: false, error: undefined }
    render(<SumsubVerification level="tier_2" />)
    expect(screen.getByText(/preparing verification/i)).toBeInTheDocument()
    expect(screen.queryByTestId("sumsub-sdk")).not.toBeInTheDocument()
  })

  it("renders the WebSDK with the minted token once available", async () => {
    mockTokenState = {
      data: { token: "sbx-token-abc", userId: "u-1" },
      isPending: false,
      isError: false,
      error: undefined,
    }
    render(<SumsubVerification level="tier_2" />)
    expect(await screen.findByTestId("sumsub-sdk")).toBeInTheDocument()
    expect(screen.getByTestId("sdk-token")).toHaveTextContent("sbx-token-abc")
  })

  it("fires onSubmitted when the applicant finishes inside the SDK", async () => {
    mockTokenState = {
      data: { token: "sbx-token-abc", userId: "u-1" },
      isPending: false,
      isError: false,
      error: undefined,
    }
    const onSubmitted = vi.fn()
    render(<SumsubVerification level="tier_2" onSubmitted={onSubmitted} />)

    await userEvent.click(
      await screen.findByRole("button", { name: /emit-submitted/i })
    )
    expect(onSubmitted).toHaveBeenCalledTimes(1)
  })

  it("shows an error branch with retry when the token fetch fails", async () => {
    mockTokenState = {
      isPending: false,
      isError: true,
      error: new Error("token mint failed"),
    }
    render(<SumsubVerification level="tier_2" />)

    expect(
      await screen.findByText(/couldn.t start verification/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/token mint failed/i)).toBeInTheDocument()
    // A retry re-mints the token.
    mockMutate.mockClear()
    await userEvent.click(
      screen.getByRole("button", { name: /try again|retry/i })
    )
    expect(mockMutate).toHaveBeenCalledWith("tier_2")
  })

  it("shows a persistent Back control on the loading branch so the user is never trapped", () => {
    mockTokenState = { isPending: true, isError: false, error: undefined }
    const onBack = vi.fn()
    render(<SumsubVerification level="tier_2" onBack={onBack} />)

    expect(screen.getByText(/preparing verification/i)).toBeInTheDocument()
    const back = screen.getByRole("button", { name: /back/i })
    back.click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it("shows a persistent Back control on the data (SDK) branch", async () => {
    mockTokenState = {
      data: { token: "sbx-token-abc", userId: "u-1" },
      isPending: false,
      isError: false,
      error: undefined,
    }
    const onBack = vi.fn()
    render(<SumsubVerification level="tier_2" onBack={onBack} />)

    expect(await screen.findByTestId("sumsub-sdk")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /back/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it("surfaces an SDK runtime error to the user (not just the console) with a retry", async () => {
    mockTokenState = {
      data: { token: "sbx-token-abc", userId: "u-1" },
      isPending: false,
      isError: false,
      error: undefined,
    }
    render(<SumsubVerification level="tier_2" />)

    await userEvent.click(
      await screen.findByRole("button", { name: /emit-error/i })
    )

    // The broken iframe is replaced by a user-visible error + recovery.
    expect(
      await screen.findByText(/couldn.t start verification/i)
    ).toBeInTheDocument()
    expect(screen.queryByTestId("sumsub-sdk")).not.toBeInTheDocument()
    mockMutate.mockClear()
    await userEvent.click(
      screen.getByRole("button", { name: /try again|retry/i })
    )
    expect(mockMutate).toHaveBeenCalledWith("tier_2")
  })
})
