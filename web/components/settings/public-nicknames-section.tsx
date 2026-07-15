"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  CreatePublicNicknameSchema,
  normalizeHandle,
  type CreatePublicNickname,
  type PublicNickname,
} from "@handshake-agent/contracts"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { FormField } from "@/components/shared/form-field"
import {
  useCreatePublicNickname,
  useDeletePublicNickname,
  usePublicNicknames,
} from "@/lib/query/profile"
import { toErrorMessage } from "@/lib/error-message"
import { ConfirmRevokeDialog } from "./confirm-revoke-dialog"
import type { AddNicknameFormProps, NicknameRowProps } from "@/types"

function NicknameRow({ nickname, onRemove }: NicknameRowProps) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-5 py-[13px] last:border-b-0">
      <span
        className="min-w-0 flex-1 truncate font-mono text-sm text-foreground"
        translate="no"
      >
        @{nickname.alias}
      </span>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => onRemove(nickname)}
        aria-label={`Remove @${nickname.alias}`}
      >
        Remove
      </Button>
    </li>
  )
}

/** Inline add form. Unmounts on success/cancel so RHF state never lingers. */
function AddNicknameForm({ onDone }: AddNicknameFormProps) {
  const create = useCreatePublicNickname()
  const [serverError, setServerError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreatePublicNickname>({
    resolver: zodResolver(CreatePublicNicknameSchema),
    defaultValues: { alias: "" },
  })

  async function onSubmit(values: CreatePublicNickname) {
    setServerError(null)
    try {
      await create.mutateAsync(values)
      onDone()
    } catch (err) {
      // HANDLE_TAKEN (409) / NICKNAME_CAP_EXCEEDED (422) / format errors — all
      // surfaced inline; none of them are money-moving so there is no PIN path.
      setServerError(toErrorMessage(err))
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-3 border-b border-border px-5 py-4"
      noValidate
    >
      <FormField
        id="nickname-alias"
        label="New alias"
        placeholder="anicknamepeoplecansendto"
        error={errors.alias?.message}
        {...register("alias", {
          setValueAs: (v: unknown) => normalizeHandle(String(v ?? "")),
        })}
      />
      {serverError && (
        <p className="text-[12.5px] text-danger" role="alert">
          {serverError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDone}
          disabled={create.isPending}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  )
}

/**
 * Public nicknames: extra @-mention aliases that resolve to the caller's
 * PayID. A nickname is a lookup key others can send to — it moves no money
 * and changes none of the caller's own send destinations, so this list
 * carries no PIN (root CLAUDE.md §3.1).
 */
export function PublicNicknamesSection() {
  const nicknames = usePublicNicknames()
  const remove = useDeletePublicNickname()
  const [adding, setAdding] = useState(false)
  const [pendingRemove, setPendingRemove] = useState<PublicNickname | null>(
    null
  )

  async function handleConfirmRemove() {
    if (!pendingRemove) return
    try {
      await remove.mutateAsync(pendingRemove.id)
    } catch {
      return // surfaced inside the confirm dialog via remove.error
    }
    setPendingRemove(null)
  }

  return (
    <div className="rounded-[16px] border border-border bg-card">
      <div className="flex items-center border-b border-border px-5 py-[13px]">
        <p className="flex-1 text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Public nicknames
        </p>
        <Button size="sm" onClick={() => setAdding(true)}>
          Add nickname
        </Button>
      </div>
      {adding && <AddNicknameForm onDone={() => setAdding(false)} />}
      {nicknames.isLoading ? (
        <div className="flex flex-col gap-2 px-5 py-4">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : nicknames.isError || !nicknames.data ? (
        <p className="px-5 py-4 text-[12.5px] text-danger" role="alert">
          Could not load your nicknames. Please refresh the page.
        </p>
      ) : nicknames.data.nicknames.length === 0 ? (
        <p className="px-5 py-4 text-[12.5px] text-muted-foreground">
          No public nicknames yet. Add one so others can send to you by an
          easy-to-remember @-handle.
        </p>
      ) : (
        <ul aria-label="Public nicknames">
          {nicknames.data.nicknames.map((nickname) => (
            <NicknameRow
              key={nickname.id}
              nickname={nickname}
              onRemove={setPendingRemove}
            />
          ))}
        </ul>
      )}
      <ConfirmRevokeDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemove(null)
        }}
        title="Remove this nickname?"
        description="People will no longer be able to send to you using this @-handle. This cannot be undone."
        confirmLabel="Yes, remove"
        pending={remove.isPending}
        error={remove.isError ? toErrorMessage(remove.error) : null}
        onConfirm={handleConfirmRemove}
      />
    </div>
  )
}
