"use client"

import { useState } from "react"
import { PAT_TOKEN_PREFIX, type PatScope } from "@handshake-agent/contracts"
import { usePats, useRevokePat } from "@/lib/query/profile"
import { useMcpEndpoint } from "@/hooks/use-mcp-endpoint"
import { claudeMcpAddCommand } from "@/lib/settings/mcp-connection"
import { formatDate } from "@/lib/transaction/format"
import { toErrorMessage } from "@/lib/error-message"
import { PAT_SCOPE_OPTIONS, MCP_CAPABILITY_NOTE } from "@/constants/settings"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CopyButton } from "@/components/shared/copy-button"
import { useToast } from "@/hooks/use-toast"
import { CreateTokenDialog } from "./create-token-dialog"
import { SectionCard, SettingRow, DangerButton } from "./section-card"
import type { SettingsSectionProps } from "@/types"

function scopesLabel(scopes: PatScope[]): string {
  return scopes
    .map((s) => PAT_SCOPE_OPTIONS.find((o) => o.scope === s)?.label ?? s)
    .join(" · ")
}

export function ConnectedAgentsSection({ density }: SettingsSectionProps) {
  const pats = usePats()
  const revoke = useRevokePat()
  const endpoint = useMcpEndpoint()
  const { showToast } = useToast()
  const [creating, setCreating] = useState(false)
  const mobile = density === "mobile"

  async function handleDisconnect(id: string, label: string) {
    try {
      await revoke.mutateAsync(id)
      showToast(`${label} disconnected`)
    } catch (err) {
      showToast(toErrorMessage(err) ?? "Something went wrong")
    }
  }

  const tokens = pats.data?.tokens ?? []

  return (
    <SectionCard
      label={mobile ? "Agents · MCP" : "Connected agents · MCP"}
      density={density}
      action={
        <Button
          type="button"
          size="sm"
          onClick={() => setCreating(true)}
          className="flex-none"
        >
          Create token
        </Button>
      }
    >
      {pats.isLoading ? (
        <div className="flex flex-col gap-2 px-[18px] py-4">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : pats.isError ? (
        <p
          className="border-b border-settings-hairline px-[18px] py-4 text-[12.5px] text-danger"
          role="alert"
        >
          Could not load your connected agents. Please refresh the page.
        </p>
      ) : tokens.length > 0 ? (
        tokens.map((token, i) => (
          <SettingRow
            key={token.id}
            first={i === 0}
            density={density}
            accentIcon
            icon={<RobotIcon className="text-white" />}
            title={
              <span className={mobile ? "text-[13.5px]" : "text-[14.5px]"}>
                {token.label}
              </span>
            }
            subtitle={
              <span className={mobile ? "text-[12px]" : "text-[12.5px]"}>
                {mobile
                  ? `Prepare only · ${formatDate(token.createdAt)}`
                  : `${scopesLabel(token.scopes)} · created ${formatDate(token.createdAt)}`}
              </span>
            }
            trailing={
              <DangerButton
                density={density}
                onClick={() => handleDisconnect(token.id, token.label)}
                ariaLabel={`Disconnect ${token.label}`}
              >
                Disconnect
              </DangerButton>
            }
          />
        ))
      ) : (
        <div
          className={cn(
            "flex items-start border-b border-settings-hairline",
            mobile ? "gap-3 px-[15px] py-[14px]" : "gap-[14px] px-[18px] py-4"
          )}
        >
          <div
            className={cn(
              "flex flex-none items-center justify-center bg-background text-settings-soft",
              mobile
                ? "h-[34px] w-[34px] rounded-[10px] [&_svg]:size-[17px]"
                : "h-[38px] w-[38px] rounded-[11px] [&_svg]:size-[18px]"
            )}
          >
            <RobotIcon />
          </div>
          <p
            className={cn(
              "pt-0.5 leading-[1.55] text-settings-soft",
              mobile ? "text-[13px] leading-[1.5]" : "text-[13.5px]"
            )}
          >
            No agents connected yet. Create a token to let an AI agent read your
            account and prepare transactions — every execution still needs your
            PIN.
          </p>
        </div>
      )}

      <div
        className={cn(
          "flex flex-col border-t border-settings-hairline",
          mobile
            ? "gap-[13px] px-[15px] py-[14px]"
            : "gap-[15px] px-[18px] py-4"
        )}
      >
        <DocsField label="MCP endpoint" density={density}>
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-[10px] border border-settings-code-border bg-settings-code-bg",
              mobile ? "px-3 py-2.5" : "px-[13px] py-[11px]"
            )}
          >
            <span
              className={cn(
                "mono min-w-0 flex-1 truncate text-settings-ink",
                mobile ? "text-[12.5px]" : "text-[13px]"
              )}
              translate="no"
            >
              {endpoint || "…"}
            </span>
            {endpoint && <CopyButton value={endpoint} label="MCP endpoint" />}
          </div>
        </DocsField>

        <DocsField label="Authentication header" density={density}>
          <div
            className={cn(
              "mono truncate rounded-[10px] border border-settings-code-border bg-settings-code-bg text-settings-ink",
              mobile
                ? "px-3 py-2.5 text-[12.5px]"
                : "px-[13px] py-[11px] text-[13px]"
            )}
            translate="no"
          >
            Authorization: Bearer {PAT_TOKEN_PREFIX}••••••••
          </div>
        </DocsField>

        <DocsField label="Add to Claude Code" density={density}>
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-[10px] bg-primary-deep",
              mobile ? "px-3 py-[11px]" : "px-[13px] py-3"
            )}
          >
            <span
              className={cn(
                "mono min-w-0 flex-1 leading-[1.55] break-all text-membership-mint-dim",
                mobile ? "text-[12px]" : "text-[12.5px]"
              )}
              translate="no"
            >
              {endpoint ? claudeMcpAddCommand(endpoint) : "…"}
            </span>
            {endpoint && (
              <CopyButton
                value={claudeMcpAddCommand(endpoint)}
                label="Claude setup command"
                tone="onDark"
              />
            )}
          </div>
        </DocsField>

        <div className="flex items-start gap-[9px] text-settings-soft">
          <svg
            width={mobile ? 14 : 15}
            height={mobile ? 14 : 15}
            viewBox="0 0 16 16"
            fill="none"
            className="mt-px flex-none"
          >
            <circle
              cx="8"
              cy="8"
              r="6.3"
              stroke="currentColor"
              strokeWidth="1.3"
            />
            <path
              d="M8 7.2v3.6M8 5.2h.01"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          <span
            className={cn(
              "leading-[1.55]",
              mobile ? "text-[12px] leading-[1.5]" : "text-[12.5px]"
            )}
          >
            {MCP_CAPABILITY_NOTE}
          </span>
        </div>
      </div>

      <CreateTokenDialog open={creating} onOpenChange={setCreating} />
    </SectionCard>
  )
}

function DocsField({
  label,
  density,
  children,
}: {
  label: string
  density: "desktop" | "mobile"
  children: React.ReactNode
}) {
  const mobile = density === "mobile"
  return (
    <div>
      <div
        className={cn(
          "mb-1.5 font-bold text-settings-label",
          mobile ? "text-[12px]" : "text-[12.5px]"
        )}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function RobotIcon({ className }: { className?: string }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      className={className}
    >
      <rect
        x="3.5"
        y="6"
        width="11"
        height="8"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M9 6V3.5M6.5 10h.01M11.5 10h.01"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
