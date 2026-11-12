import { describe, expect, it } from "vitest"
import {
  diffValues,
  normaliseDefinition,
  writableView,
  classifyRollout,
  describeDefaultRule,
} from "../definition.js"
import {
  addKeyOperation,
  removeKeyOperation,
  turnOffOperation,
  turnOnOperation,
} from "../operations.js"
import { evaluateWriteGate, isProductionEnvironment } from "../safety.js"
import { makeDefinition } from "./fake-api.js"

const KEY = "0a1b2c3d-0000-4000-8000-000000000001"

describe("addKeyOperation", () => {
  const op = addKeyOperation({ key: KEY })

  it("adds the key to the on treatment and touches nothing else", () => {
    const before = makeDefinition()
    const outcome = op.apply(before)
    expect(outcome.action).toBe("update")
    if (outcome.action === "update") {
      expect(outcome.next.treatments[0].keys).toEqual([KEY])
      expect(
        diffValues(writableView(before), writableView(outcome.next)),
      ).toEqual([
        { path: "treatments[0].keys", before: undefined, after: [KEY] },
      ])
      expect(before.treatments[0].keys).toBeUndefined()
    }
  })

  it.each([
    ["killed", makeDefinition({ killed: true }), "killed"],
    [
      "already fully on",
      makeDefinition({ defaultRule: [{ treatment: "on", size: 100 }] }),
      "already serves on to everyone",
    ],
    [
      "key already present",
      makeDefinition({
        treatments: [{ name: "on", keys: [KEY] }, { name: "off" }],
      }),
      "already has the key",
    ],
    [
      "no on treatment",
      makeDefinition({ treatments: [{ name: "off" }] }),
      "no treatment named on",
    ],
  ])("skips when %s", (_label, def, reason) => {
    const outcome = op.apply(def)
    expect(outcome.action).toBe("skip")
    if (outcome.action === "skip") expect(outcome.reason).toContain(reason)
  })

  it("can target another treatment", () => {
    const outcome = addKeyOperation({ key: KEY, treatment: "off" }).apply(
      makeDefinition({ defaultRule: [{ treatment: "on", size: 100 }] }),
    )
    expect(outcome.action).toBe("update")
  })
})

describe("removeKeyOperation", () => {
  it("removes the key and drops an emptied list", () => {
    const outcome = removeKeyOperation({ key: KEY }).apply(
      makeDefinition({
        treatments: [{ name: "on", keys: [KEY] }, { name: "off" }],
      }),
    )
    expect(outcome.action).toBe("update")
    if (outcome.action === "update")
      expect(outcome.next.treatments[0].keys).toBeUndefined()
  })

  it("skips when the key is absent", () => {
    expect(
      removeKeyOperation({ key: KEY }).apply(makeDefinition()).action,
    ).toBe("skip")
  })
})

describe("turnOnOperation", () => {
  it("serves on to everyone by default", () => {
    const outcome = turnOnOperation().apply(makeDefinition())
    expect(outcome.action).toBe("update")
    if (outcome.action === "update")
      expect(outcome.next.defaultRule).toEqual([{ treatment: "on", size: 100 }])
  })

  it("splits the default rule for a percentage", () => {
    const outcome = turnOnOperation({ percent: 25 }).apply(makeDefinition())
    expect(outcome.action).toBe("update")
    if (outcome.action === "update")
      expect(outcome.next.defaultRule).toEqual([
        { treatment: "on", size: 25 },
        { treatment: "off", size: 75 },
      ])
  })

  it("adds a segment to the on treatment", () => {
    const outcome = turnOnOperation({ segment: "beta_testers" }).apply(
      makeDefinition(),
    )
    expect(outcome.action).toBe("update")
    if (outcome.action === "update")
      expect(outcome.next.treatments[0].segments).toEqual(["beta_testers"])
  })

  it("skips when already in that state", () => {
    expect(
      turnOnOperation().apply(
        makeDefinition({ defaultRule: [{ treatment: "on", size: 100 }] }),
      ).action,
    ).toBe("skip")
    expect(
      turnOnOperation({ percent: 25 }).apply(
        makeDefinition({
          defaultRule: [
            { treatment: "off", size: 75 },
            { treatment: "on", size: 25 },
          ],
        }),
      ).action,
    ).toBe("skip")
  })

  it("leaves a killed flag alone", () => {
    expect(
      turnOnOperation().apply(makeDefinition({ killed: true })).action,
    ).toBe("skip")
  })

  it.each([0, 101, 12.5, -3])("rejects percent %s", (percent) => {
    expect(() => turnOnOperation({ percent })).toThrow("percent")
  })

  it("rejects a segment and a percentage together", () => {
    expect(() => turnOnOperation({ segment: "s", percent: 10 })).toThrow()
  })
})

describe("turnOffOperation", () => {
  it("serves off to everyone by default", () => {
    const outcome = turnOffOperation().apply(
      makeDefinition({ defaultRule: [{ treatment: "on", size: 100 }] }),
    )
    expect(outcome.action).toBe("update")
    if (outcome.action === "update")
      expect(outcome.next.defaultRule).toEqual([
        { treatment: "off", size: 100 },
      ])
  })

  it("removes a segment from on", () => {
    const outcome = turnOffOperation({ segment: "beta_testers" }).apply(
      makeDefinition({
        treatments: [
          { name: "on", segments: ["beta_testers"] },
          { name: "off" },
        ],
      }),
    )
    expect(outcome.action).toBe("update")
    if (outcome.action === "update")
      expect(outcome.next.treatments[0].segments).toBeUndefined()
  })

  it("skips when already off", () => {
    expect(turnOffOperation().apply(makeDefinition()).action).toBe("skip")
  })
})

describe("definition helpers", () => {
  it("treats an empty list like a missing one and ignores order", () => {
    const a = normaliseDefinition({
      treatments: [
        { name: "on", keys: [] },
        { name: "off", segments: ["b", "a"] },
      ],
      lastUpdateTime: 5,
    })
    const b = normaliseDefinition({
      treatments: [{ name: "on" }, { name: "off", segments: ["a", "b"] }],
      lastUpdateTime: 9,
    })
    expect(diffValues(a, b)).toEqual([])
  })

  it("describes and classifies the default rule", () => {
    expect(describeDefaultRule(makeDefinition())).toBe("off 100%")
    expect(classifyRollout(makeDefinition())).toBe("off")
    expect(
      classifyRollout(
        makeDefinition({ defaultRule: [{ treatment: "on", size: 100 }] }),
      ),
    ).toBe("on")
    expect(
      classifyRollout(
        makeDefinition({
          defaultRule: [
            { treatment: "on", size: 40 },
            { treatment: "off", size: 60 },
          ],
        }),
      ),
    ).toBe("partial")
    expect(classifyRollout(makeDefinition({ killed: true }))).toBe("killed")
  })
})

describe("write gate", () => {
  it("is a plan until go is given", () => {
    expect(
      evaluateWriteGate({
        environmentName: "Prod",
        environmentArg: "Prod",
        go: false,
      }),
    ).toEqual({ mode: "plan" })
  })

  it("writes to a non-production environment with go", () => {
    expect(
      evaluateWriteGate({
        environmentName: "QA",
        environmentArg: "qa",
        go: true,
      }),
    ).toEqual({ mode: "write" })
  })

  it("requires the exact production name typed explicitly", () => {
    expect(
      evaluateWriteGate({
        environmentName: "Prod",
        environmentArg: "Prod",
        go: true,
      }),
    ).toEqual({ mode: "write" })
    for (const arg of [
      "prod",
      "99999999-8888-4777-8666-555555555555",
      "PROD",
    ]) {
      const gate = evaluateWriteGate({
        environmentName: "Prod",
        environmentArg: arg,
        go: true,
      })
      expect(gate.mode).toBe("refused")
    }
  })

  it("recognises production by name", () => {
    expect(isProductionEnvironment("Production-EU")).toBe(true)
    expect(isProductionEnvironment("preprod")).toBe(true)
    expect(isProductionEnvironment("QA")).toBe(false)
  })
})
