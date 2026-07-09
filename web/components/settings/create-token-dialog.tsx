"use client"

import { useState } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import type { CreatePatResponse } from "@handshake-agent/contracts"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { FormField } from "@/components/shared/form-field"
import { CopyButton } from "@/components/shared/copy-button"
import { useCreatePat } from "@/lib/query/profile"
import {
  CreateTokenFormSchema,
  toCreatePatRequest,
  type CreateTokenFormValues,
} from "@/lib/schemas/settings"
import { pinErrorMessage } from "@/lib/settings/pin-error"
import {
  PAT_EXPIRY_OPTIONS,
  PAT_SCOPE_OPTIONS,
  TOKEN_SHOWN_ONCE_NOTE,
} from "@/constants/settings"
import type { CreateTokenDialogProps } from "@/types"

/** Post-mint view — the ONLY place the raw token ever renders (server keeps a hash). */
function TokenCreatedView({
  created,
  onDone,
}: {
  created: CreatePatResponse
  onDone: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 rounded-[12px] border border-border bg-background px-3 py-2.5">
        <code
          className="min-w-0 flex-1 text-[12px] break-all text-foreground"
          translate="no"
        >
          {created.token}
        </code>
        <CopyButton value={created.token} label="token" />
      </div>
      <p className="text-[12.5px] font-semibold text-warn" role="alert">
        {TOKEN_SHOWN_ONCE_NOTE}
      </p>
      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </div>
  )
}

/** The mint form. Unmounts on success/close, so RHF state never leaks a PIN. */
function CreateTokenForm({
  onCreated,
  onCancel,
}: {
  onCreated: (created: CreatePatResponse) => void
  onCancel: () => void
}) {
  const create = useCreatePat()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<CreateTokenFormValues>({
    resolver: zodResolver(CreateTokenFormSchema),
    defaultValues: {
      label: "",
      readScope: true,
      proposeScope: true,
      expiry: "never",
      pin: "",
    },
  })
  // useWatch (not watch()) — the React-Compiler-safe subscription API.
  const scopeChecked = {
    read: useWatch({ control, name: "readScope" }),
    "chat:propose": useWatch({ control, name: "proposeScope" }),
  } as const

  async function onSubmit(values: CreateTokenFormValues) {
    setServerError(null)
    try {
      onCreated(await create.mutateAsync(toCreatePatRequest(values)))
    } catch (err) {
      setServerError(pinErrorMessage(err))
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4"
      noValidate
    >
      <FormField
        id="token-label"
        label="Token name"
        placeholder="e.g. Claude Code on my laptop"
        error={errors.label?.message}
        {...register("label")}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-foreground">
          Permissions
        </legend>
        {PAT_SCOPE_OPTIONS.map((option) => (
          <div key={option.scope} className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-foreground">
                {option.label}
              </p>
              <p className="text-[12px] text-muted-foreground">
                {option.description}
              </p>
            </div>
            <Switch
              checked={scopeChecked[option.scope]}
              onCheckedChange={(checked) =>
                setValue(
                  option.scope === "read" ? "readScope" : "proposeScope",
                  checked
                )
              }
              aria-label={option.label}
            />
          </div>
        ))}
        {errors.readScope?.message && (
          <p role="alert" className="text-xs text-destructive">
            {errors.readScope.message}
          </p>
        )}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="token-expiry"
          className="text-sm font-medium text-foreground"
        >
          Expires
        </label>
        <NativeSelect id="token-expiry" {...register("expiry")}>
          {PAT_EXPIRY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <FormField
        id="token-pin"
        label="Transaction PIN"
        hint="Creating a token is a sensitive action — confirm it's you."
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        error={errors.pin?.message}
        {...register("pin")}
      />
      {serverError && (
        <p className="text-[12.5px] text-danger" role="alert">
          {serverError}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={create.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create token"}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * Mint a personal access token for a connected agent. Minting is a sensitive
 * action: the transaction PIN travels in-body and is verified server-side
 * through the lockout-protected PinService. Scopes are read/propose only —
 * a token can never execute (§3.1).
 */
export function CreateTokenDialog({
  open,
  onOpenChange,
}: CreateTokenDialogProps) {
  const [created, setCreated] = useState<CreatePatResponse | null>(null)

  function handleOpenChange(next: boolean) {
    if (!next) setCreated(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create access token</DialogTitle>
          <DialogDescription>
            Give an AI agent scoped access to your account. Agents can read
            and propose — executing anything always needs your PIN in this app.
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <TokenCreatedView
            created={created}
            onDone={() => handleOpenChange(false)}
          />
        ) : (
          <CreateTokenForm
            onCreated={setCreated}
            onCancel={() => handleOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
