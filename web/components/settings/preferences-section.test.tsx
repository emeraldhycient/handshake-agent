import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PreferencesSection } from "./preferences-section"

const setLanguage = vi.hoisted(() => vi.fn())
const showToast = vi.hoisted(() => vi.fn())
const updateProfile = vi.hoisted(() => ({
  current: { mutateAsync: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock("@/lib/query/auth", () => ({
  useProfile: () => ({ data: { fiatCurrency: "NGN" } }),
}))
vi.mock("@/lib/query/hooks", () => ({
  useConfig: () => ({
    data: {
      fiats: [
        { code: "NGN", displayName: "Naira", symbol: "₦", decimals: 2 },
        { code: "GHS", displayName: "Cedi", symbol: "₵", decimals: 2 },
      ],
    },
  }),
}))
vi.mock("@/lib/query/profile", () => ({
  useUpdateProfile: () => updateProfile.current,
}))
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
  updateProfile.current = { mutateAsync: vi.fn().mockResolvedValue(undefined) }
})

describe("PreferencesSection", () => {
  it("changes the display currency with a toast", async () => {
    render(<PreferencesSection density="desktop" />)
    expect(screen.getByText("Display currency")).toBeInTheDocument()
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Display currency" }),
      "GHS"
    )
    expect(updateProfile.current.mutateAsync).toHaveBeenCalledWith({
      fiatCurrency: "GHS",
    })
    expect(showToast).toHaveBeenCalledWith("Display currency set to GHS")
  })

  it("changes the language with a toast", async () => {
    render(<PreferencesSection density="desktop" />)
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Language" }),
      "fr"
    )
    expect(setLanguage).toHaveBeenCalledWith("fr")
    expect(showToast).toHaveBeenCalledWith("Language set to Français")
  })
})
