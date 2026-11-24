import { describe, expect, it } from "vitest"
import { isEpochMs, toIso, withIsoTimes } from "../time.js"

describe("withIsoTimes", () => {
  it("adds an ISO twin beside each epoch-millisecond time field", () => {
    const out = withIsoTimes({
      name: "checkout-redesign",
      lastUpdateTime: 1_767_323_045_678,
      creationTime: 1_767_323_045_000,
      lastTrafficReceivedAt: 1_767_323_000_000,
    })
    expect(out).toEqual({
      name: "checkout-redesign",
      lastUpdateTime: 1_767_323_045_678,
      lastUpdateTimeIso: "2026-01-02T03:04:05.678Z",
      creationTime: 1_767_323_045_000,
      creationTimeIso: "2026-01-02T03:04:05.000Z",
      lastTrafficReceivedAt: 1_767_323_000_000,
      lastTrafficReceivedAtIso: "2026-01-02T03:03:20.000Z",
    })
  })

  it("walks nested objects and arrays", () => {
    const out = withIsoTimes({
      objects: [{ creationTime: 1_767_323_045_678 }],
    })
    expect(out.objects[0]).toHaveProperty(
      "creationTimeIso",
      "2026-01-02T03:04:05.678Z",
    )
  })

  it("leaves numbers that are not times alone", () => {
    const out = withIsoTimes({
      trafficAllocation: 100,
      changeNumber: 1_767_323_045_678,
      lastUpdateTime: 0,
      size: 1_767_323_045_678,
    })
    expect(Object.keys(out)).toEqual([
      "trafficAllocation",
      "changeNumber",
      "lastUpdateTime",
      "size",
    ])
  })

  it("does not overwrite an ISO field already present", () => {
    const out = withIsoTimes({
      lastUpdateTime: 1_767_323_045_678,
      lastUpdateTimeIso: "kept",
    })
    expect(out.lastUpdateTimeIso).toBe("kept")
  })

  it("does not mutate its input", () => {
    const input = { lastUpdateTime: 1_767_323_045_678 }
    withIsoTimes(input)
    expect(input).toEqual({ lastUpdateTime: 1_767_323_045_678 })
  })

  it("passes primitives and null through", () => {
    expect(withIsoTimes(null)).toBeNull()
    expect(withIsoTimes("x")).toBe("x")
  })
})

describe("isEpochMs and toIso", () => {
  it("accepts millisecond stamps only", () => {
    expect(isEpochMs(1_767_323_045_678)).toBe(true)
    expect(isEpochMs(1_767_323_045)).toBe(false)
    expect(isEpochMs(1.5e12 + 0.5)).toBe(false)
    expect(toIso(0)).toBe("1970-01-01T00:00:00.000Z")
  })
})
