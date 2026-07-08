import type { ChatAction, SearchResult } from "@/lib/schemas"

export interface TopbarSearchProps {
  onSearchSelect: (result: SearchResult) => void
  onQuickAction: (action: ChatAction, label: string) => void
}
