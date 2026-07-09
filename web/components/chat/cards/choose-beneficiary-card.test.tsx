import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ChooseBeneficiaryCard } from "./choose-beneficiary-card"
import type { ChooseBeneficiaryCandidate } from "@/lib/schemas"

const candidates: ChooseBeneficiaryCandidate[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    label: "Mum",
    detail: "Guaranty Trust Bank (GTBank) ••6789",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    label: "Mum (Access)",
    detail: "Access Bank ••4321",
  },
]

describe("ChooseBeneficiaryCard", () => {
  it("shows how many recipients share the nickname", () => {
    render(
      <ChooseBeneficiaryCard
        kind="choose_beneficiary"
        beneficiaryType="bank_account"
        nickname="mum"
        candidates={candidates}
        density="mobile"
        onResolve={vi.fn()}
      />
    )
    // "You have N saved as 'mum'" — count + the echoed nickname.
    expect(screen.getByText(/You have 2 saved as .mum./i)).toBeInTheDocument()
  })

  it("renders every candidate with its label and masked detail", () => {
    render(
      <ChooseBeneficiaryCard
        kind="choose_beneficiary"
        beneficiaryType="bank_account"
        nickname="mum"
        candidates={candidates}
        density="mobile"
        onResolve={vi.fn()}
      />
    )
    expect(screen.getByText("Mum")).toBeInTheDocument()
    expect(screen.getByText("Mum (Access)")).toBeInTheDocument()
    expect(
      screen.getByText("Guaranty Trust Bank (GTBank) ••6789")
    ).toBeInTheDocument()
    expect(screen.getByText("Access Bank ••4321")).toBeInTheDocument()
  })

  it("marks the masked detail translate=no (funds-safety — never reformatted)", () => {
    render(
      <ChooseBeneficiaryCard
        kind="choose_beneficiary"
        beneficiaryType="crypto_address"
        nickname="mum"
        candidates={[
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            label: "Mum wallet",
            detail: "TQn9Y2...nH4d",
          },
        ]}
        density="mobile"
        onResolve={vi.fn()}
      />
    )
    expect(screen.getByText("TQn9Y2...nH4d")).toHaveAttribute("translate", "no")
  })

  it("clicking a candidate resolves with THAT candidate's id + the card's messageId", async () => {
    const onResolve = vi.fn()
    render(
      <ChooseBeneficiaryCard
        kind="choose_beneficiary"
        beneficiaryType="bank_account"
        nickname="mum"
        candidates={candidates}
        density="mobile"
        messageId="msg-77"
        onResolve={onResolve}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: /Mum \(Access\)/i })
    )
    expect(onResolve).toHaveBeenCalledTimes(1)
    expect(onResolve).toHaveBeenCalledWith(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "msg-77"
    )
  })

  it("omitting messageId passes undefined as the second arg (legacy callers)", async () => {
    const onResolve = vi.fn()
    render(
      <ChooseBeneficiaryCard
        kind="choose_beneficiary"
        beneficiaryType="bank_account"
        nickname="mum"
        candidates={candidates}
        density="desktop"
        onResolve={onResolve}
      />
    )
    await userEvent.click(
      screen.getByRole("button", { name: /Mum \(Access\)/i })
    )
    expect(onResolve).toHaveBeenCalledWith(
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      undefined
    )
  })
})
