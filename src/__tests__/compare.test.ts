import { describe, expect, it } from "vitest"
import { createClient } from "../client.js"
import { describeRule } from "../definition.js"
import {
  compareDefinitions,
  compareFlagEnvironments,
  summariseDefinition,
} from "../compare.js"
import {
  PROD_ENV,
  QA_ENV,
  WORKSPACE_ID,
  makeDefinition,
  makeFakeApi,
} from "./fake-api.js"

const STAGING = { id: QA_ENV.id, name: "staging" }
const PRODUCTION = { id: PROD_ENV.id, name: "production" }

describe("summariseDefinition", () => {
  it("summarises treatments with key counts and sorted segments", () => {
    const view = summariseDefinition(
      STAGING,
      makeDefinition({
        name: "checkout-redesign",
        treatments: [
          { name: "on", keys: ["k1", "k2"], segments: ["beta", "alpha"] },
          { name: "off" },
        ],
        lastUpdateTime: 1_767_323_045_678,
        changeNumber: 1_767_323_045_678,
      }),
    )
    expect(view.defined).toBe(true)
    expect(view.treatments).toEqual([
      { name: "on", keys: 2, segments: ["alpha", "beta"] },
      { name: "off", keys: 0, segments: [] },
    ])
    expect(view.defaultRuleText).toBe("off 100%")
    expect(view.lastUpdateTimeIso).toBe("2026-01-02T03:04:05.678Z")
  })

  it("marks a missing definition as not defined", () => {
    const view = summariseDefinition(PRODUCTION, undefined)
    expect(view).toMatchObject({
      environment: "production",
      defined: false,
      state: "undefined",
      lastUpdateTimeIso: null,
    })
  })
})

describe("compareDefinitions", () => {
  it("finds the default rule differing between two environments", () => {
    const comparison = compareDefinitions("checkout-redesign", [
      summariseDefinition(
        STAGING,
        makeDefinition({ defaultRule: [{ treatment: "on", size: 100 }] }),
      ),
      summariseDefinition(PRODUCTION, makeDefinition()),
    ])
    expect(comparison.differences).toEqual(["defaultRule"])
    expect(comparison.environments.map((e) => e.defaultRuleText)).toEqual([
      "on 100%",
      "off 100%",
    ])
  })

  it("reports nothing for definitions that differ only in stamps or order", () => {
    const comparison = compareDefinitions("checkout-redesign", [
      summariseDefinition(
        STAGING,
        makeDefinition({
          treatments: [{ name: "on", keys: ["a", "b"] }, { name: "off" }],
          lastUpdateTime: 1,
        }),
      ),
      summariseDefinition(
        PRODUCTION,
        makeDefinition({
          treatments: [{ name: "off" }, { name: "on", keys: ["b", "a"] }],
          lastUpdateTime: 2,
        }),
      ),
    ])
    expect(comparison.differences).toEqual([])
  })

  it("sees different keys even when the counts match", () => {
    const comparison = compareDefinitions("checkout-redesign", [
      summariseDefinition(
        STAGING,
        makeDefinition({ treatments: [{ name: "on", keys: ["a"] }] }),
      ),
      summariseDefinition(
        PRODUCTION,
        makeDefinition({ treatments: [{ name: "on", keys: ["b"] }] }),
      ),
    ])
    expect(comparison.differences).toEqual(["treatments"])
  })

  it("flags a killed environment and an undefined one", () => {
    const comparison = compareDefinitions("checkout-redesign", [
      summariseDefinition(STAGING, makeDefinition({ killed: true })),
      summariseDefinition(PRODUCTION, makeDefinition()),
      summariseDefinition({ id: "x", name: "sandbox" }, undefined),
    ])
    expect(comparison.differences).toEqual(["defined", "killed"])
  })
})

describe("compareFlagEnvironments", () => {
  it("reads every environment in one call and tolerates a missing one", async () => {
    const api = makeFakeApi({
      definitions: {
        [`${QA_ENV.id}/checkout-redesign`]: makeDefinition({
          name: "checkout-redesign",
          defaultRule: [{ treatment: "on", size: 100 }],
        }),
      },
    })
    const client = createClient({ apiKey: "test-key", fetch: api.fetch })
    const result = await compareFlagEnvironments(client, {
      workspaceId: WORKSPACE_ID,
      flagName: "checkout-redesign",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.environments.map((e) => e.environment)).toEqual([
      "QA",
      "Prod",
    ])
    expect(result.data.environments[1].defined).toBe(false)
    expect(result.data.differences).toEqual(["defined"])
  })

  it("fails on an error that is not a 404", async () => {
    const client = createClient({
      apiKey: "test-key",
      fetch: (async () =>
        new Response("boom", { status: 500 })) as typeof fetch,
    })
    const result = await compareFlagEnvironments(client, {
      workspaceId: WORKSPACE_ID,
      flagName: "checkout-redesign",
      environments: [STAGING],
    })
    expect(result.ok).toBe(false)
  })
})

describe("describeRule", () => {
  it("puts conditions and buckets on one line", () => {
    expect(
      describeRule({
        buckets: [{ treatment: "on", size: 100 }],
        condition: {
          combiner: "AND",
          matchers: [
            { type: "IN_SEGMENT", string: "beta-testers" },
            {
              type: "IN_LIST_STRING",
              attribute: "plan",
              strings: ["pro", "team"],
              negate: true,
            },
          ],
        },
      }),
    ).toBe(
      "IN_SEGMENT beta-testers AND NOT plan IN_LIST_STRING [pro, team] -> on 100%",
    )
  })

  it("falls back to JSON for a shape it does not know", () => {
    expect(describeRule({ odd: true })).toBe('{"odd":true}')
  })
})
