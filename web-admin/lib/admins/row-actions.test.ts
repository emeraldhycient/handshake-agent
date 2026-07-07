import { describe, expect, it } from "vitest"

import { buildStatusTransitions } from "./row-actions"

const CAN = { canChangeStatus: true, isSelf: false }
const CAN_SELF = { canChangeStatus: true, isSelf: true }

describe("buildStatusTransitions", () => {
  it("returns nothing when the operator can't change status", () => {
    expect(buildStatusTransitions("active", { canChangeStatus: false, isSelf: false })).toEqual([])
  })

  it("offers Suspend + Offboard for an active admin (other operator)", () => {
    expect(buildStatusTransitions("active", CAN)).toEqual([
      { label: "Suspend", status: "suspended" },
      { label: "Offboard", status: "offboarded" },
    ])
  })

  it("offers Reactivate + Offboard for a suspended admin", () => {
    expect(buildStatusTransitions("suspended", CAN)).toEqual([
      { label: "Reactivate", status: "active" },
      { label: "Offboard", status: "offboarded" },
    ])
  })

  it("hides self-lockout transitions on your OWN row (no suspend/offboard self)", () => {
    // Active-self: both offered transitions are self-forbidden → empty.
    expect(buildStatusTransitions("active", CAN_SELF)).toEqual([])
    // Suspended-self: Reactivate stays, Offboard is dropped.
    expect(buildStatusTransitions("suspended", CAN_SELF)).toEqual([
      { label: "Reactivate", status: "active" },
    ])
  })

  it("offers only Offboard for a pending admin, but nothing on your own pending row", () => {
    expect(buildStatusTransitions("pending", CAN)).toEqual([
      { label: "Offboard", status: "offboarded" },
    ])
    // pending-self: the only transition (Offboard) is self-forbidden → empty.
    expect(buildStatusTransitions("pending", CAN_SELF)).toEqual([])
  })

  it("offers Reactivate for an offboarded admin — including your OWN row (reactivate is not a lockout)", () => {
    expect(buildStatusTransitions("offboarded", CAN)).toEqual([
      { label: "Reactivate", status: "active" },
    ])
    expect(buildStatusTransitions("offboarded", CAN_SELF)).toEqual([
      { label: "Reactivate", status: "active" },
    ])
  })

  it("returns nothing for an unknown status", () => {
    expect(buildStatusTransitions("archived", CAN)).toEqual([])
  })
})
