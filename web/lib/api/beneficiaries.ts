/**
 * Beneficiary API client — saved payout destinations (sell → bank account,
 * send → crypto address).
 *
 *   listBeneficiaries(type)   → GET    /beneficiaries?type=
 *   addBankAccount(body)      → POST   /beneficiaries/bank-account
 *   addCryptoAddress(body)    → POST   /beneficiaries/crypto-address
 *   deleteBeneficiary(id)     → DELETE /beneficiaries/:id
 *
 * Parses request bodies through the contracts Zod schemas before sending and
 * the responses after (UX gate — server is the security gate per §3.3). The
 * axios instance sets Idempotency-Key on every non-GET request.
 */
import {
  BeneficiaryListResponseSchema,
  BeneficiarySchema,
  AddBankAccountRequestSchema,
  AddCryptoAddressRequestSchema,
  DeleteBeneficiaryResponseSchema,
} from "@handshake-agent/contracts/beneficiaries"
import type {
  Beneficiary,
  BeneficiaryListResponse,
  BeneficiaryType,
  AddBankAccountRequest,
  AddCryptoAddressRequest,
  DeleteBeneficiaryResponse,
} from "@handshake-agent/contracts/beneficiaries"
import { api } from "./client"

export async function listBeneficiaries(
  type: BeneficiaryType
): Promise<BeneficiaryListResponse> {
  const { data } = await api.get("/beneficiaries", { params: { type } })
  return BeneficiaryListResponseSchema.parse(data)
}

export async function addBankAccount(
  body: AddBankAccountRequest
): Promise<Beneficiary> {
  const validated = AddBankAccountRequestSchema.parse(body)
  const { data } = await api.post("/beneficiaries/bank-account", validated)
  return BeneficiarySchema.parse(data)
}

export async function addCryptoAddress(
  body: AddCryptoAddressRequest
): Promise<Beneficiary> {
  const validated = AddCryptoAddressRequestSchema.parse(body)
  const { data } = await api.post("/beneficiaries/crypto-address", validated)
  return BeneficiarySchema.parse(data)
}

export async function deleteBeneficiary(
  id: string
): Promise<DeleteBeneficiaryResponse> {
  const { data } = await api.delete(`/beneficiaries/${id}`)
  return DeleteBeneficiaryResponseSchema.parse(data)
}
