import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the axios instance so no real HTTP happens.
const get = vi.fn()
const post = vi.fn()
const del = vi.fn()
vi.mock("./client", () => ({
  api: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}))

import {
  listBeneficiaries,
  listBanks,
  addBankAccount,
  addCryptoAddress,
  deleteBeneficiary,
} from "./beneficiaries"

const bankBeneficiary = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  type: "bank_account",
  label: "My GTB",
  accountNumber: "0123456789",
  accountHolderName: "ADA LOVELACE",
  bankCode: "058",
  currency: "NGN",
  country: "NG",
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
    del.mockReset()
  })

  it("listBeneficiaries calls GET /beneficiaries with the type param and parses", async () => {
    get.mockResolvedValue({ data: { beneficiaries: [bankBeneficiary] } })

    const result = await listBeneficiaries("bank_account")

    expect(get).toHaveBeenCalledWith("/beneficiaries", {
      params: { type: "bank_account" },
    })
    expect(result.beneficiaries[0].accountHolderName).toBe("ADA LOVELACE")
  })

  it("addBankAccount posts the validated body (currency + pin) and parses the response", async () => {
    post.mockResolvedValue({ data: bankBeneficiary })

    const result = await addBankAccount({
      accountNumber: "0123456789",
      bankCode: "058",
      label: "My GTB",
      currency: "NGN",
      pin: "1379",
    })

    expect(post).toHaveBeenCalledWith("/beneficiaries/bank-account", {
      accountNumber: "0123456789",
      bankCode: "058",
      label: "My GTB",
      currency: "NGN",
      pin: "1379",
    })
    expect(result.id).toBe(bankBeneficiary.id)
  })

  it("addBankAccount rejects an invalid (short) account number before sending", async () => {
    await expect(
      addBankAccount({
        accountNumber: "123",
        bankCode: "058",
        label: "x",
        currency: "NGN",
        pin: "1379",
      })
    ).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })

  it("addBankAccount rejects a missing PIN before sending (step-up is required)", async () => {
    await expect(
      // @ts-expect-error — omitting the now-required pin must be caught by the schema
      addBankAccount({
        accountNumber: "0123456789",
        bankCode: "058",
        label: "x",
        currency: "NGN",
      })
    ).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })

  it("addCryptoAddress posts the validated body (with pin) and parses the response", async () => {
    post.mockResolvedValue({ data: cryptoBeneficiary })

    const result = await addCryptoAddress({
      address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      network: "TRON",
      asset: "USDT",
      label: "Cold wallet",
      pin: "1379",
    })

    expect(post).toHaveBeenCalledWith("/beneficiaries/crypto-address", {
      address: "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE",
      network: "TRON",
      asset: "USDT",
      label: "Cold wallet",
      pin: "1379",
    })
    expect(result.cryptoAddress).toBe("TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE")
  })

  it("listBanks calls GET /beneficiaries/banks with the country param and parses", async () => {
    get.mockResolvedValue({
      data: { banks: [{ name: "GTBank", code: "058" }] },
    })

    const result = await listBanks("NG")

    expect(get).toHaveBeenCalledWith("/beneficiaries/banks", {
      params: { country: "NG" },
    })
    expect(result.banks).toEqual([{ name: "GTBank", code: "058" }])
  })

  it("listBanks rejects a malformed country before sending", async () => {
    await expect(listBanks("NGA")).rejects.toThrow()
    expect(get).not.toHaveBeenCalled()
  })

  it("deleteBeneficiary calls DELETE /beneficiaries/:id and parses the ack", async () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    del.mockResolvedValue({ data: { id, deleted: true } })

    const result = await deleteBeneficiary(id)

    expect(del).toHaveBeenCalledWith(`/beneficiaries/${id}`)
    expect(result).toEqual({ id, deleted: true })
  })

  it("deleteBeneficiary rejects a response whose shape does not match (deleted:false)", async () => {
    const id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    del.mockResolvedValue({ data: { id, deleted: false } })

    await expect(deleteBeneficiary(id)).rejects.toThrow()
  })
})
