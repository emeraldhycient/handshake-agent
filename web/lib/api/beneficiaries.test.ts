import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the axios instance so no real HTTP happens.
const get = vi.fn()
const post = vi.fn()
vi.mock("./client", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
  },
}))

import {
  listBeneficiaries,
  addBankAccount,
  addCryptoAddress,
} from "./beneficiaries"

const bankBeneficiary = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  type: "bank_account",
  label: "My GTB",
  accountNumber: "0123456789",
  accountHolderName: "ADA LOVELACE",
  bankCode: "058",
  cryptoAddress: null,
  cryptoAsset: null,
  cryptoNetwork: null,
  verificationStatus: "verified",
  isDefault: true,
  firstUseLockedUntil: null,
  createdAt: "2026-06-29T12:00:00.000Z",
}

const cryptoBeneficiary = {
  ...bankBeneficiary,
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  type: "crypto_address",
  label: "Cold wallet",
  accountNumber: null,
  accountHolderName: null,
  bankCode: null,
  cryptoAddress: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
  cryptoAsset: "USDT",
  cryptoNetwork: "TRON",
  isDefault: false,
}

describe("beneficiaries api client", () => {
  beforeEach(() => {
    get.mockReset()
    post.mockReset()
  })

  it("listBeneficiaries calls GET /beneficiaries with the type param and parses", async () => {
    get.mockResolvedValue({ data: { beneficiaries: [bankBeneficiary] } })

    const result = await listBeneficiaries("bank_account")

    expect(get).toHaveBeenCalledWith("/beneficiaries", {
      params: { type: "bank_account" },
    })
    expect(result.beneficiaries[0].accountHolderName).toBe("ADA LOVELACE")
  })

  it("addBankAccount posts the validated body and parses the response", async () => {
    post.mockResolvedValue({ data: bankBeneficiary })

    const result = await addBankAccount({
      accountNumber: "0123456789",
      bankCode: "058",
      label: "My GTB",
    })

    expect(post).toHaveBeenCalledWith("/beneficiaries/bank-account", {
      accountNumber: "0123456789",
      bankCode: "058",
      label: "My GTB",
    })
    expect(result.id).toBe(bankBeneficiary.id)
  })

  it("addBankAccount rejects an invalid (short) account number before sending", async () => {
    await expect(
      addBankAccount({ accountNumber: "123", bankCode: "058", label: "x" })
    ).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })

  it("addCryptoAddress posts the validated body and parses the response", async () => {
    post.mockResolvedValue({ data: cryptoBeneficiary })

    const result = await addCryptoAddress({
      address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      network: "TRON",
      asset: "USDT",
      label: "Cold wallet",
    })

    expect(post).toHaveBeenCalledWith("/beneficiaries/crypto-address", {
      address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      network: "TRON",
      asset: "USDT",
      label: "Cold wallet",
    })
    expect(result.cryptoAddress).toBe("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE")
  })
})
