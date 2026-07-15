"use client"

import { useState } from "react"
import { normalizeHandle } from "@handshake-agent/contracts"
import { useProfile } from "@/lib/query/auth"
import { useConfig } from "@/lib/query/hooks"
import {
  useChangePayId,
  useCreatePublicNickname,
  useDeletePublicNickname,
  usePublicNicknames,
} from "@/lib/query/profile"
import { ApiError } from "@/lib/api/client"
import { toErrorMessage } from "@/lib/error-message"
import { cn } from "@/lib/utils"
import { CopyButton } from "@/components/shared/copy-button"
import { useToast } from "@/hooks/use-toast"
import { EditProfileDialog } from "./edit-profile-dialog"
import { SectionCard, SettingRow, RowButton } from "./section-card"
import { HandleInput } from "./handle-input"
import type { SettingsSectionProps } from "@/types"

export function AccountSection({ density }: SettingsSectionProps) {
  const profile = useProfile()
  const config = useConfig()
  const nicknames = usePublicNicknames()
  const createNick = useCreatePublicNickname()
  const deleteNick = useDeletePublicNickname()
  const changePayId = useChangePayId()
  const { showToast } = useToast()

  const [editing, setEditing] = useState(false)
  const [addingNick, setAddingNick] = useState(false)
  const [nickDraft, setNickDraft] = useState("")
  const [claiming, setClaiming] = useState(false)
  const [payIdDraft, setPayIdDraft] = useState("")
  const [payIdLocked, setPayIdLocked] = useState<string | null>(null)

  if (!profile.data) return null
  const p = profile.data
  const mobile = density === "mobile"

  async function commitNick() {
    const alias = normalizeHandle(nickDraft)
    if (!alias) return
    try {
      await createNick.mutateAsync({ alias })
      setNickDraft("")
      setAddingNick(false)
      showToast(`Added @${alias}`)
    } catch (err) {
      showToast(toErrorMessage(err) ?? "Something went wrong")
    }
  }

  async function removeNick(id: string, alias: string) {
    try {
      await deleteNick.mutateAsync(id)
      showToast(`Removed @${alias}`)
    } catch (err) {
      showToast(toErrorMessage(err) ?? "Something went wrong")
    }
  }

  async function commitPayId() {
    const payId = normalizeHandle(payIdDraft)
    if (!payId) return
    try {
      await changePayId.mutateAsync({ payId })
      setPayIdDraft("")
      setClaiming(false)
      showToast(`Handle @${payId} claimed`)
    } catch (err) {
      if (err instanceof ApiError && err.code === "PAYID_ALREADY_CHANGED") {
        setPayIdLocked(err.message)
        setClaiming(false)
        return
      }
      showToast(toErrorMessage(err) ?? "Something went wrong")
    }
  }

  const nickList = nicknames.data?.nicknames ?? []

  return (
    <SectionCard label="Account" density={density}>
      <SettingRow
        first
        density={density}
        icon={<UserIcon />}
        title="Name"
        subtitle={p.fullName ?? p.email.split("@")[0]}
        trailing={
          <RowButton density={density} onClick={() => setEditing(true)}>
            Edit
          </RowButton>
        }
      />
      <SettingRow
        density={density}
        icon={<EmailIcon />}
        title="Email"
        subtitle={p.email}
        trailing={
          <RowButton density={density} onClick={() => setEditing(true)}>
            Edit
          </RowButton>
        }
      />
      <SettingRow
        density={density}
        icon={
          <span
            className={cn(
              "mono font-medium text-primary",
              mobile ? "text-[16px]" : "text-[17px]"
            )}
          >
            @
          </span>
        }
        title="PayID handle"
        subtitle={
          p.payId ? (
            <span className="mono inline-flex items-center" translate="no">
              @{p.payId}
              <CopyButton value={`@${p.payId}`} label="PayID" />
            </span>
          ) : mobile ? (
            "Not yet claimed."
          ) : (
            "Not yet claimed — pick a handle so people can pay you by name."
          )
        }
        trailing={
          !payIdLocked && (
            <RowButton density={density} onClick={() => setClaiming((v) => !v)}>
              {p.payId ? "Change" : mobile ? "Claim" : "Claim handle"}
            </RowButton>
          )
        }
        below={
          payIdLocked ? (
            <p
              className={cn(
                "text-[12.5px] text-settings-soft",
                mobile ? "mt-2 ml-[46px]" : "mt-2 ml-[52px]"
              )}
              role="status"
            >
              {payIdLocked}
            </p>
          ) : claiming ? (
            <HandleInput
              density={density}
              value={payIdDraft}
              onChange={setPayIdDraft}
              onCommit={commitPayId}
              onCancel={() => setClaiming(false)}
              pending={changePayId.isPending}
            />
          ) : null
        }
      />
      <SettingRow
        density={density}
        icon={<TagIcon />}
        title="Public nicknames"
        subtitle={
          mobile
            ? "Extra names friends can find you by."
            : "Extra names friends can use to find you."
        }
        trailing={
          <RowButton density={density} onClick={() => setAddingNick((v) => !v)}>
            {mobile ? "Add" : "Add nickname"}
          </RowButton>
        }
        below={
          <>
            {nickList.length > 0 && (
              <div
                className={cn(
                  "flex flex-wrap gap-2",
                  mobile ? "mt-3 ml-[46px]" : "mt-[13px] ml-[52px]"
                )}
              >
                {nickList.map((n) => (
                  <span
                    key={n.id}
                    className={cn(
                      "mono inline-flex items-center gap-[7px] rounded-full border border-settings-chip-border bg-settings-btn-hover text-settings-ink",
                      mobile
                        ? "py-[5px] pr-2 pl-[11px] text-[12.5px]"
                        : "py-1.5 pr-2 pl-3 text-[13px]"
                    )}
                    translate="no"
                  >
                    @{n.alias}
                    <button
                      type="button"
                      aria-label={`Remove @${n.alias}`}
                      onClick={() => removeNick(n.id, n.alias)}
                      className={cn(
                        "flex items-center justify-center rounded-full border-none bg-settings-outline leading-none text-muted-foreground",
                        mobile
                          ? "h-[17px] w-[17px] text-[12px]"
                          : "h-[18px] w-[18px] text-[13px]"
                      )}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {addingNick && (
              <HandleInput
                density={density}
                value={nickDraft}
                onChange={setNickDraft}
                onCommit={commitNick}
                onCancel={() => setAddingNick(false)}
                pending={createNick.isPending}
              />
            )}
          </>
        }
      />
      <EditProfileDialog
        open={editing}
        onOpenChange={setEditing}
        profile={p}
        fiats={config.data?.fiats ?? []}
      />
    </SectionCard>
  )
}

function UserIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      className="text-primary"
    >
      <circle cx="9" cy="6" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.6 14.8c0-3 2.4-4.6 5.4-4.6s5.4 1.6 5.4 4.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function EmailIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      className="text-primary"
    >
      <rect
        x="2.5"
        y="4"
        width="13"
        height="10"
        rx="2.2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M3.2 5.2L9 9.4l5.8-4.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TagIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      className="text-primary"
    >
      <path
        d="M9.4 2.5H14a1.5 1.5 0 011.5 1.5v4.6L8.2 15.9a1.4 1.4 0 01-2 0L2.1 11.8a1.4 1.4 0 010-2L9.4 2.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="11.6" cy="6.4" r="1.05" fill="currentColor" />
    </svg>
  )
}
