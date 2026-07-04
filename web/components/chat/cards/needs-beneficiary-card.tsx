"use client"

/**
 * NeedsBeneficiaryCard — inline add/select payout-destination UI.
 *
 * Rendered when a sell (bank account) or send (crypto address) needs a saved
 * beneficiary the user doesn't have yet. The user can pick an existing one,
 * remove a stale one, or add a new one; on resolve, `onResolve(beneficiaryId,
 * messageId)` re-asks the agent so the sell/send proposal can be created.
 *
 * Funds-safety: for a NEW bank account the card shows the server-resolved
 * account-holder name (name-enquiry) and requires an explicit "Yes, that's
 * correct" before resolving — a typo'd account paying a stranger is the most
 * expensive beneficiary mistake, so the confirm is mandatory, not optional.
 *
 * Strict layering: pure UI + lib hooks only (no fetch/axios here).
 *   - List: useBeneficiaries (TanStack Query) — loading/error/empty/data branches.
 *   - Add: react-hook-form + zodResolver(contracts schema) + add mutations.
 *   - Delete: useDeleteBeneficiary.
 */
import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  AddBankAccountRequestSchema,
  AddCryptoAddressRequestSchema,
  type AddBankAccountRequest,
  type AddCryptoAddressRequest,
  type Beneficiary,
  NIGERIAN_BANKS,
  bankNameForCode,
} from "@handshake-agent/contracts/beneficiaries"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { NativeSelect } from "@/components/ui/native-select"
import { Button } from "@/components/ui/button"
import {
  useBeneficiaries,
  useAddBankAccount,
  useAddCryptoAddress,
  useDeleteBeneficiary,
} from "@/lib/query/beneficiaries"
import type { NeedsBeneficiaryCardProps } from "@/types/components"

export function NeedsBeneficiaryCard({
  beneficiaryType,
  messageId,
  onResolve,
  density,
  className,
}: NeedsBeneficiaryCardProps) {
  const isMobile = density === "mobile"
  const isBank = beneficiaryType === "bank_account"

  const list = useBeneficiaries(beneficiaryType)
  const del = useDeleteBeneficiary()

  // Bind onResolve to this card's id so the right pending intent resumes.
  const resolve = (beneficiaryId: string) => onResolve(beneficiaryId, messageId)

  return (
    <div
      className={cn(
        "overflow-hidden border border-border bg-card",
        isMobile
          ? "w-[88%] rounded-[20px] shadow-card"
          : "w-[92%] rounded-[16px] shadow-[0_4px_14px_oklch(0.244_0.024_162_/_0.06)]",
        className
      )}
    >
      <div className={cn(isMobile ? "px-4 pt-3.5" : "px-[15px] pt-[13px]")}>
        <span className="text-[11px] font-bold tracking-widest text-muted-foreground-subtle uppercase">
          {isBank ? "Add a bank account" : "Add a crypto address"}
        </span>
        <p
          className={cn(
            "pt-1 text-muted-foreground",
            isMobile ? "text-[13px]" : "text-[12px]"
          )}
        >
          {isBank
            ? "Choose where you'd like the sale paid out, or add a new bank account."
            : "Choose where to send your crypto, or add a new address."}
        </p>
      </div>

      {/* Existing beneficiaries — loading / error / empty / data */}
      <div className={cn(isMobile ? "px-4 pt-3" : "px-[15px] pt-[11px]")}>
        {list.isPending ? (
          <p className="text-[13px] text-muted-foreground">
            Loading saved destinations…
          </p>
        ) : list.isError ? (
          <p className="text-[13px] text-warn">
            Couldn&apos;t load your saved destinations. You can still add a new
            one below.
          </p>
        ) : list.data && list.data.beneficiaries.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {list.data.beneficiaries.map((b) => (
              <li key={b.id} className="flex items-stretch gap-2">
                <button
                  type="button"
                  onClick={() => resolve(b.id)}
                  className={cn(
                    "flex min-w-0 flex-1 items-center justify-between rounded-[12px] border border-border",
                    "bg-background px-3 py-2.5 text-left text-[13.5px] text-foreground",
                    "transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  )}
                >
                  <span className="truncate font-medium">{b.label}</span>
                  <span
                    className="ml-2 shrink-0 text-[12px] text-muted-foreground"
                    translate="no"
                  >
                    {isBank
                      ? `${b.accountNumber ?? ""} · ${b.bankCode ? (bankNameForCode(b.bankCode) ?? b.bankCode) : ""}`
                      : truncateMiddle(b.cryptoAddress ?? "")}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${b.label}`}
                  disabled={del.isPending}
                  onClick={() => del.mutate(b.id)}
                  className={cn(
                    "flex w-10 shrink-0 items-center justify-center rounded-[12px] border border-border",
                    "bg-background text-muted-foreground transition-colors",
                    "hover:bg-muted hover:text-danger focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    "disabled:opacity-50"
                  )}
                >
                  <RemoveIcon />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No saved {isBank ? "bank accounts" : "addresses"} yet — add your
            first below.
          </p>
        )}
        {del.isError && (
          <p className="pt-2 text-[12px] text-warn" role="alert">
            Couldn&apos;t remove that destination. Please try again.
          </p>
        )}
      </div>

      {/* Divider */}
      <div
        className={cn("mt-3 h-px bg-border", isMobile ? "mx-4" : "mx-[15px]")}
      />

      {/* Add form */}
      <div className={cn(isMobile ? "px-4 py-3.5" : "px-[15px] py-[13px]")}>
        {isBank ? (
          <AddBankForm onResolve={resolve} />
        ) : (
          <AddCryptoForm onResolve={resolve} />
        )}
      </div>
    </div>
  )
}

// ─── Bank add form (with account-name confirmation) ───────────────────────────

function AddBankForm({ onResolve }: { onResolve: (id: string) => void }) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AddBankAccountRequest>({
    resolver: zodResolver(AddBankAccountRequestSchema),
  })
  const add = useAddBankAccount()

  // After a successful add the server returns the name-enquiry result; hold it
  // here so the user can confirm the resolved name before we resume the sell.
  const [added, setAdded] = useState<Beneficiary | null>(null)

  async function onSubmit(values: AddBankAccountRequest) {
    try {
      const created = await add.mutateAsync(values)
      setAdded(created)
    } catch {
      // Surfaced via add.error below — never silently dropped.
    }
  }

  // ── Confirm step: show the server-resolved account holder name ──────────────
  if (added) {
    return (
      <div
        className="flex flex-col gap-2.5"
        role="group"
        aria-label="Confirm account name"
      >
        <p className="text-[12px] font-medium text-muted-foreground">
          We found this account — is this you?
        </p>
        <div className="rounded-[12px] border border-border bg-background px-3 py-2.5">
          <p
            className="text-[14px] font-semibold text-foreground"
            translate="no"
          >
            {added.accountHolderName ?? added.label}
          </p>
          <p
            className="pt-0.5 text-[12px] text-muted-foreground"
            translate="no"
          >
            {added.accountNumber ?? ""}
            {added.bankCode
              ? ` · ${bankNameForCode(added.bankCode) ?? added.bankCode}`
              : ""}
          </p>
        </div>
        <p className="text-[11.5px] text-muted-foreground">
          Money sent to the wrong account can&apos;t be recovered — confirm the
          name matches before continuing.
        </p>
        <Button
          type="button"
          onClick={() => onResolve(added.id)}
          className="mt-1"
        >
          Yes, that&apos;s correct
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setAdded(null)}
          className="mt-0.5"
        >
          No, re-enter details
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-2.5">
      <Field label="Account number" error={errors.accountNumber?.message}>
        <Input
          inputMode="numeric"
          placeholder="0123456789"
          aria-label="Account number"
          {...register("accountNumber")}
        />
      </Field>
      <Field label="Bank" error={errors.bankCode?.message}>
        {/* Users don't know bank codes — pick a bank by name, submit its code.
            Mirrors the WhatsApp Flow bank picker; list is the shared
            NIGERIAN_BANKS contract. */}
        <NativeSelect
          aria-label="Bank"
          defaultValue=""
          {...register("bankCode")}
        >
          <option value="" disabled>
            Select your bank
          </option>
          {NIGERIAN_BANKS.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Label" error={errors.label?.message}>
        <Input placeholder="My GTB" aria-label="Label" {...register("label")} />
      </Field>
      {add.isError && (
        <p className="text-[12.5px] text-warn" role="alert">
          We couldn&apos;t verify that account. Check the number and bank code,
          then try again.
        </p>
      )}
      <Button type="submit" disabled={add.isPending} className="mt-1">
        {add.isPending ? "Verifying…" : "Add bank account"}
      </Button>
    </form>
  )
}

// ─── Crypto add form ────────────────────────────────────────────────────────────

function AddCryptoForm({ onResolve }: { onResolve: (id: string) => void }) {
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

  async function onSubmit(values: AddCryptoAddressRequest) {
    try {
      const created = await add.mutateAsync(values)
      onResolve(created.id)
    } catch {
      // Surfaced via add.error below.
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-2.5">
      <Field label="USDT address (TRON)" error={errors.address?.message}>
        <Input
          placeholder="T…"
          aria-label="USDT address (TRON)"
          {...register("address")}
        />
      </Field>
      <Field label="Label" error={errors.label?.message}>
        <Input
          placeholder="My wallet"
          aria-label="Label"
          {...register("label")}
        />
      </Field>
      {add.isError && (
        <p className="text-[12.5px] text-warn" role="alert">
          That address looks invalid for the TRON network. Please check it and
          try again.
        </p>
      )}
      <Button type="submit" disabled={add.isPending} className="mt-1">
        {add.isPending ? "Saving…" : "Add address"}
      </Button>
    </form>
  )
}

// ─── Small field wrapper ────────────────────────────────────────────────────────

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
      {error && (
        <span className="text-[11.5px] text-warn" role="alert">
          {error}
        </span>
      )}
    </label>
  )
}

function RemoveIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}

function truncateMiddle(s: string, head = 6, tail = 4): string {
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}
