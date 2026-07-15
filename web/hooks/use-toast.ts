import { useToastStore } from "@/lib/store/toast-store"

/** Returns `showToast(message)` for transient settings feedback. */
export function useToast() {
  const showToast = useToastStore((s) => s.show)
  return { showToast }
}
