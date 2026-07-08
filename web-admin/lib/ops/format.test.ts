import { describe, expect, it } from "vitest"
import type { OpsJob } from "@handshake-agent/contracts"

import {
  jobEffect,
  latencyLabel,
  pctLabel,
  relativeLabel,
  serviceHealth,
  toJobRow,
} from "./format"

describe("latencyLabel", () => {
  it("renders ms, or an em dash when unobserved", () => {
    expect(latencyLabel(142)).toBe("142ms")
    expect(latencyLabel(null)).toBe("—")
  })
})

describe("relativeLabel", () => {
  it("returns 'never' for null / unparseable", () => {
    expect(relativeLabel(null)).toBe("never")
    expect(relativeLabel("nope")).toBe("never")
  })
  it("buckets seconds / minutes / hours / days", () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
    expect(relativeLabel(ago(5_000))).toMatch(/^\d+s ago$/)
    expect(relativeLabel(ago(5 * 60_000))).toBe("5m ago")
    expect(relativeLabel(ago(3 * 3_600_000))).toBe("3h ago")
    expect(relativeLabel(ago(2 * 86_400_000))).toBe("2d ago")
  })
})

describe("serviceHealth", () => {
  it("maps success rate onto the tone thresholds", () => {
    expect(serviceHealth(0.99)).toBe("ok")
    expect(serviceHealth(0.95)).toBe("warn")
    expect(serviceHealth(0.5)).toBe("down")
  })
})

describe("pctLabel", () => {
  it("formats a 0–1 rate to one decimal", () => {
    expect(pctLabel(0.99)).toBe("99.0%")
  })
})

describe("toJobRow + jobEffect", () => {
  const job: OpsJob = {
    id: "settlement-reconciliation",
    name: "Reconciliation sweep",
    schedule: "*/2 * * * *",
    status: "ok",
    health: "ok",
    lastRunAt: null,
  }
  it("maps a job, prefixing 'Failed' when the last run failed", () => {
    expect(toJobRow(job).status).toBe("Healthy")
    expect(toJobRow(job).last).toBe("never")
    expect(toJobRow({ ...job, status: "failed" }).last).toBe("Failed never")
  })
  it("itemizes the run effect from the job row", () => {
    const effect = jobEffect(toJobRow(job))
    expect(effect[0]).toEqual({ k: "Job", v: "Reconciliation sweep" })
    expect(effect[3].v).toContain("Manual")
  })
})
