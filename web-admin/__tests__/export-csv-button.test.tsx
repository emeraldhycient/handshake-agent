import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { ExportCsvButton } from "@/components/admin/export-csv-button"

describe("ExportCsvButton", () => {
  it("builds the CSV lazily at click and hands it to the injected download", async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()
    const build = vi.fn(() => ({
      headers: ["date", "count"],
      rows: [["2026-06-01", 3]] as (string | number)[][],
    }))

    render(
      <ExportCsvButton
        filename="volume.csv"
        label="Export"
        build={build}
        onDownload={onDownload}
      />
    )
    // Not built until clicked.
    expect(build).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Export" }))

    expect(build).toHaveBeenCalledTimes(1)
    expect(onDownload).toHaveBeenCalledWith(
      "volume.csv",
      "date,count\r\n2026-06-01,3"
    )
  })

  it("does not build or download when disabled", async () => {
    const user = userEvent.setup()
    const onDownload = vi.fn()
    const build = vi.fn(() => ({ headers: ["a"], rows: [] }))
    render(
      <ExportCsvButton
        filename="x.csv"
        build={build}
        onDownload={onDownload}
        disabled
      />
    )
    await user.click(screen.getByRole("button", { name: /export csv/i }))
    expect(build).not.toHaveBeenCalled()
    expect(onDownload).not.toHaveBeenCalled()
  })
})
