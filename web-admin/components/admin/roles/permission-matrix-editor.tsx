import { permissionId } from "@handshake-agent/contracts"

import { PERMISSION_GROUPS } from "@/lib/roles/permission-groups"
import type { PermissionMatrixEditorProps } from "@/types/components"

/**
 * The editable permission matrix — the shared PERMISSION_CATALOG grouped by category
 * into fieldsets, each row a checkbox keyed by its canonical `permissionId(...)`. Every
 * control is disabled when the role is built-in or a save is in flight.
 */
export function PermissionMatrixEditor({
  selected,
  onToggle,
  disabled,
}: PermissionMatrixEditorProps) {
  return (
    <div className="flex flex-col gap-3">
      {PERMISSION_GROUPS.map((group) => (
        <fieldset
          key={group.category}
          className="rounded-[12px] border border-line bg-card2 p-3.5"
        >
          <legend className="px-1.5 text-[10px] font-bold tracking-[0.06em] text-ink3 uppercase">
            {group.category}
          </legend>
          <ul className="flex flex-col gap-0.5">
            {group.entries.map((entry) => {
              const id = permissionId(entry)
              const inputId = `perm-${id}`
              const checked = selected.has(id)
              return (
                <li key={id}>
                  <label
                    htmlFor={inputId}
                    className={`flex cursor-pointer items-start gap-2.5 rounded-[9px] px-2 py-1.5 transition-colors hover:bg-hov has-disabled:cursor-default has-disabled:hover:bg-transparent ${
                      checked ? "bg-hov/60" : ""
                    }`}
                  >
                    <input
                      id={inputId}
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[--brand-green] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggle(id)}
                    />
                    <span className="flex flex-col leading-tight">
                      <span className="text-[12.5px] font-bold text-ink">
                        {entry.description}
                      </span>
                      <span className="mt-0.5 font-mono text-[10.5px] text-ink3">
                        {entry.resourceId} · {entry.action}
                      </span>
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  )
}
