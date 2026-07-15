import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PreferencesSection } from "./preferences-section"

const setLanguage = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())

vi.mock("@/components/shared/translation-provider", () => ({
  useTranslation: () => ({
    language: { code: "en", englishName: "English", nativeName: "English" },
    languages: [
      { code: "en", englishName: "English", nativeName: "English" },
      { code: "fr", englishName: "French", nativeName: "Français" },
    ],
    setLanguage,
  }),
}))
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ showToast }) }))

beforeEach(() => {
  setLanguage.mockClear()
  showToast.mockClear()
})

describe("PreferencesSection", () => {
  it("renders the language row and changes language with a toast", async () => {
    render(<PreferencesSection density="desktop" />)
    expect(screen.getByText("Language")).toBeInTheDocument()
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Language" }),
      "fr"
    )
    expect(setLanguage).toHaveBeenCalledWith("fr")
    expect(showToast).toHaveBeenCalledWith("Language set to Français")
  })
})
