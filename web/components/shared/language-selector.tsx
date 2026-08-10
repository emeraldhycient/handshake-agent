"use client"

import { useMemo, useRef, useState } from "react"
import { useTranslation } from "./translation-provider"
import { cn } from "@/lib/utils"
import type { LanguageSelectorProps } from "@/types"

const LISTBOX_ID = "language-selector-listbox"

export function LanguageSelector({ className }: LanguageSelectorProps) {
  const { language, languages, setLanguage } = useTranslation()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return languages
    return languages.filter(
      (l) =>
        l.englishName.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        l.code.toLowerCase() === q
    )
  }, [query, languages])

  function choose(code: string) {
    setLanguage(code)
    setQuery("")
    setOpen(false)
    inputRef.current?.blur()
  }

  return (
    // translate="no" so Google never rewrites language names / this control.
    <div className={cn("relative", className)} translate="no">
      <input
        ref={inputRef}
        role="combobox"
        aria-label="Language"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={LISTBOX_ID}
        value={open ? query : language.nativeName}
        placeholder="Search languages…"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className={cn(
          "w-full rounded-[12px] border border-border bg-card px-4 py-2.5",
          "text-[14px] font-semibold text-foreground outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring"
        )}
      />
      {open && (
        <ul
          id={LISTBOX_ID}
          role="listbox"
          className={cn(
            "absolute z-40 mt-1 max-h-64 w-full overflow-y-auto",
            "rounded-[14px] border border-border bg-card p-1.5 shadow-dropdown"
          )}
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              No languages found
            </li>
          ) : (
            filtered.map((l) => (
              <li
                key={l.code}
                role="option"
                aria-selected={l.code === language.code}
                onMouseDown={(e) => {
                  e.preventDefault()
                  choose(l.code)
                }}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3",
                  "rounded-[10px] px-3 py-2 text-sm hover:bg-muted",
                  l.code === language.code &&
                    "bg-foreground text-background hover:bg-foreground"
                )}
              >
                <span className="font-semibold">{l.nativeName}</span>
                <span className="text-xs text-muted-foreground">
                  {l.englishName}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
