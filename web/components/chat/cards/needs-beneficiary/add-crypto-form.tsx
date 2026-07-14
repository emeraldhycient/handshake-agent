"use client"

import { useState, type FormEvent } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  AddCryptoAddressRequestSchema,
  type AddCryptoAddressRequest,
} from "@handshake-agent/contracts/beneficiaries"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useAddCryptoAddress } from "@/lib/query/beneficiaries"
import { getDeviceFingerprint } from "@/lib/device"
import { pinErrorMessage } from "@/lib/settings/pin-error"
import { BeneficiaryField } from "./beneficiary-field"
import type { BeneficiaryFormProps } from "@/types/chat"

const PIN_INPUT_PROPS = {
  type: "password",
  inputMode: "numeric",
  autoComplete: "off",
  maxLength: 6,
  placeholder: "••••",
} as const

/**
 * Add a crypto (USDT/TRON) address (dispatcher).
 *
 * `mode="add"` (default): standalone add-crypto with a PIN, resolves
 * immediately on a successful add. `mode="send"`: the raw send-to-address
 * path (§3.1) — no PIN, address prefilled from the server's edge-parse but
 * still user-edited/confirmed, optional "save as beneficiary" toggle.
 */
export function AddCryptoForm({
  onResolve,
  mode = "add",
  prefillAddress,
  onSend,
}: BeneficiaryFormProps) {
  if (mode === "send") {
    return <SendCryptoForm prefillAddress={prefillAddress} onSend={onSend} />
  }
  return <AddCryptoAddressForm onResolve={onResolve} />
}

/**
 * Add a crypto (USDT/TRON) address; resolves immediately on a successful add.
 * Adding a payout destination is step-up gated server-side (§3.3), so the PIN
 * is required (additional to the existing first-use cooling-off) and PIN
 * failures map to distinct copy.
 */
function AddCryptoAddressForm({
  onResolve,
}: Pick<BeneficiaryFormProps, "onResolve">) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddCryptoAddressRequest>({
    resolver: zodResolver(AddCryptoAddressRequestSchema),
    // TRON / USDT are the only supported network/asset at launch.
    defaultValues: { network: "TRON", asset: "USDT" },
  })
  const add = useAddCryptoAddress()
  const [serverError, setServerError] = useState<string | null>(null)

  async function onSubmit(values: AddCryptoAddressRequest) {
    setServerError(null)
    try {
      const created = await add.mutateAsync({
        ...values,
        // Binds the step-up to this device (§3.4) — same source as the send flow.
        deviceFingerprint: getDeviceFingerprint(),
      })
      onResolve(created.id)
    } catch (err) {
      // PIN wrong/locked read distinctly; other failures show the server reason.
      setServerError(pinErrorMessage(err))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-2.5">
      <BeneficiaryField
        label="USDT address (TRON)"
        error={errors.address?.message}
      >
        <Input
          placeholder="T…"
          aria-label="USDT address (TRON)"
          {...register("address")}
        />
      </BeneficiaryField>
      <BeneficiaryField label="Label" error={errors.label?.message}>
        <Input
          placeholder="My wallet"
          aria-label="Label"
          {...register("label")}
        />
      </BeneficiaryField>
      <BeneficiaryField label="Transaction PIN" error={errors.pin?.message}>
        <Input
          aria-label="Transaction PIN"
          {...PIN_INPUT_PROPS}
          {...register("pin")}
        />
      </BeneficiaryField>
      {serverError && (
        <p className="text-[12.5px] text-warn" role="alert">
          {serverError}
        </p>
      )}
      <Button type="submit" disabled={add.isPending} className="mt-1">
        {add.isPending ? "Saving…" : "Add address"}
      </Button>
    </form>
  )
}

/**
 * Send-to-address path (§3.1): the address is USER-entered/confirmed here
 * (only pre-filled from the server's edge-parse of the chat message, never
 * fabricated by the client). No PIN — sending is authorized later via the
 * proposal's PIN + step-up flow (§3.3), not on this form. Submitting calls
 * `onSend` with the contract's `SendDestinationInput` shape; there is no add
 * mutation here, the beneficiary (if any) is saved server-side as part of
 * the send itself.
 */
function SendCryptoForm({
  prefillAddress,
  onSend,
}: Pick<BeneficiaryFormProps, "prefillAddress" | "onSend">) {
  const [address, setAddress] = useState(prefillAddress ?? "")
  const [saveAsBeneficiary, setSaveAsBeneficiary] = useState(false)
  const [label, setLabel] = useState("")

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmedAddress = address.trim()
    if (!trimmedAddress) return
    const trimmedLabel = label.trim()
    onSend?.({
      address: trimmedAddress,
      // TRON / USDT are the only supported network/asset at launch.
      network: "TRON",
      saveAsBeneficiary,
      ...(saveAsBeneficiary && trimmedLabel ? { label: trimmedLabel } : {}),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
      <BeneficiaryField label="USDT address (TRON)">
        <Input
          placeholder="T…"
          aria-label="USDT address (TRON)"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </BeneficiaryField>
      <label className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border border-input"
          checked={saveAsBeneficiary}
          onChange={(e) => setSaveAsBeneficiary(e.target.checked)}
        />
        Save this recipient for next time
      </label>
      {saveAsBeneficiary && (
        <BeneficiaryField label="Label">
          <Input
            placeholder="My wallet"
            aria-label="Label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </BeneficiaryField>
      )}
      <Button type="submit" className="mt-1">
        Send
      </Button>
    </form>
  )
}
