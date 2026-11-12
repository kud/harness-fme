import { describe, expect, it, vi } from "vitest"
import {
  applyChanges,
  planChanges,
  selectUpdates,
  type ApplyOptions,
} from "../changes.js"
import { createClient } from "../client.js"
import { addKeyOperation } from "../operations.js"
import {
  QA_ENV,
  PROD_ENV,
  WORKSPACE_ID,
  makeDefinition,
  makeFakeApi,
  type FakeApiOptions,
} from "./fake-api.js"

const KEY = "0a1b2c3d-0000-4000-8000-000000000001"
const operation = addKeyOperation({ key: KEY })

const NAMES = ["checkout_a", "checkout_b", "checkout_c"]

const setup = (options: FakeApiOptions = {}) => {
  const definitions = Object.fromEntries(
    NAMES.map((name) => [`${QA_ENV.id}/${name}`, makeDefinition({ name })]),
  )
  const api = makeFakeApi({ definitions, ...options })
  const client = createClient({ apiKey: "test-key", fetch: api.fetch })
  return { api, client }
}

const run = async (
  client: ReturnType<typeof createClient>,
  overrides: Partial<ApplyOptions> = {},
  names = NAMES,
) => {
  const plan = await planChanges(client, {
    workspaceId: WORKSPACE_ID,
    environmentId: QA_ENV.id,
    flags: names,
    operation,
  })
  return applyChanges(client, {
    workspaceId: WORKSPACE_ID,
    environmentId: QA_ENV.id,
    operation,
    items: selectUpdates(plan),
    title: "Add key",
    comment: "Add the key",
    guard: { environmentName: "QA", environmentArg: "QA", go: true },
    backup: () => {},
    ...overrides,
  })
}

describe("planChanges", () => {
  it("never writes", async () => {
    const { api, client } = setup()
    const plan = await planChanges(client, {
      workspaceId: WORKSPACE_ID,
      environmentId: QA_ENV.id,
      flags: NAMES,
      operation,
    })
    expect(plan.map((p) => p.action)).toEqual(["update", "update", "update"])
    expect(api.puts()).toHaveLength(0)
  })

  it("treats a 404 as not defined here, not as an error", async () => {
    const { client } = setup()
    const plan = await planChanges(client, {
      workspaceId: WORKSPACE_ID,
      environmentId: QA_ENV.id,
      flags: ["checkout_missing"],
      operation,
    })
    expect(plan[0]).toEqual({
      flag: "checkout_missing",
      action: "skip",
      reason: "not defined in this environment",
    })
  })
})

describe("selectUpdates", () => {
  it("honours only and limit, and never selects skips", async () => {
    const { client } = setup()
    const plan = await planChanges(client, {
      workspaceId: WORKSPACE_ID,
      environmentId: QA_ENV.id,
      flags: [...NAMES, "checkout_missing"],
      operation,
    })
    expect(selectUpdates(plan).map((i) => i.flag)).toEqual(NAMES)
    expect(
      selectUpdates(plan, { only: ["checkout_b"] }).map((i) => i.flag),
    ).toEqual(["checkout_b"])
    expect(selectUpdates(plan, { limit: 2 }).map((i) => i.flag)).toEqual([
      "checkout_a",
      "checkout_b",
    ])
    expect(selectUpdates(plan, { only: ["checkout_missing"] })).toEqual([])
  })
})

describe("applyChanges", () => {
  it("backs up, then writes, then reads back, for each flag", async () => {
    const { api, client } = setup()
    const order: string[] = []
    const outcome = await run(
      client,
      {
        backup: ({ flag }) => {
          order.push(`backup ${flag}`)
          expect(api.puts().length).toBe(
            order.filter((o) => o.startsWith("backup")).length - 1,
          )
        },
      },
      ["checkout_a", "checkout_b"],
    )
    expect(outcome.ok).toBe(true)
    expect(outcome.results.map((r) => r.status)).toEqual(["applied", "applied"])
    expect(order).toEqual(["backup checkout_a", "backup checkout_b"])
    expect(api.puts()).toHaveLength(2)
    for (const name of ["checkout_a", "checkout_b"])
      expect(
        api.definitions.get(`${QA_ENV.id}/${name}`)?.treatments[0].keys,
      ).toEqual([KEY])
  })

  it("hands the backup the definition as it was before the write", async () => {
    const { client } = setup()
    const backup = vi.fn()
    await run(client, { backup }, ["checkout_a"])
    expect(backup).toHaveBeenCalledTimes(1)
    expect(
      backup.mock.calls[0][0].definition.treatments[0].keys,
    ).toBeUndefined()
  })

  it("sends only writable fields plus the title and comment", async () => {
    const { api, client } = setup()
    await run(client, { title: "T", comment: "C" }, ["checkout_a"])
    const body = api.puts()[0].body as Record<string, unknown>
    expect(body.title).toBe("T")
    expect(body.comment).toBe("C")
    expect(Object.keys(body).sort()).toEqual(
      [
        "baselineTreatment",
        "comment",
        "defaultRule",
        "defaultTreatment",
        "rules",
        "title",
        "trafficAllocation",
        "treatments",
      ].sort(),
    )
  })

  it("stops at the first failed write and leaves the rest untouched", async () => {
    const { api, client } = setup({ failPutFor: ["checkout_b"] })
    const outcome = await run(client)
    expect(outcome.ok).toBe(false)
    expect(outcome.results.map((r) => `${r.flag}:${r.status}`)).toEqual([
      "checkout_a:applied",
      "checkout_b:failed",
    ])
    expect(api.puts().map((p) => p.path)).toHaveLength(2)
    expect(
      api.definitions.get(`${QA_ENV.id}/checkout_c`)?.treatments[0].keys,
    ).toBeUndefined()
  })

  it("stops when the read-back does not match the plan", async () => {
    const { api, client } = setup({
      afterWrite: (flag, stored) =>
        flag === "checkout_a"
          ? {
              ...stored,
              treatments: stored.treatments.map((t) => ({ ...t, keys: [] })),
            }
          : stored,
    })
    const outcome = await run(client)
    expect(outcome.ok).toBe(false)
    expect(outcome.results).toHaveLength(1)
    expect(outcome.results[0].status).toBe("failed")
    expect(outcome.results[0].reason).toContain("read-back does not match")
    expect(api.puts()).toHaveLength(1)
  })

  it("stops when the write changed something it should not have", async () => {
    const { client } = setup({
      afterWrite: (_flag, stored) => ({ ...stored, killed: true }),
    })
    const outcome = await run(client)
    expect(outcome.ok).toBe(false)
    expect(outcome.results[0].reason).toContain("killed")
  })

  it("does not write when the backup fails", async () => {
    const { api, client } = setup()
    const outcome = await run(client, {
      backup: () => {
        throw new Error("disk full")
      },
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.results[0].reason).toContain("backup failed")
    expect(api.puts()).toHaveLength(0)
  })

  it("skips a flag whose state moved since the plan", async () => {
    const { api, client } = setup()
    const plan = await planChanges(client, {
      workspaceId: WORKSPACE_ID,
      environmentId: QA_ENV.id,
      flags: ["checkout_a"],
      operation,
    })
    api.definitions.set(
      `${QA_ENV.id}/checkout_a`,
      makeDefinition({
        name: "checkout_a",
        defaultRule: [{ treatment: "on", size: 100 }],
      }),
    )
    const outcome = await applyChanges(client, {
      workspaceId: WORKSPACE_ID,
      environmentId: QA_ENV.id,
      operation,
      items: selectUpdates(plan),
      title: "t",
      comment: "c",
      guard: { environmentName: "QA", environmentArg: "QA", go: true },
      backup: () => {},
    })
    expect(outcome.results[0].status).toBe("skipped")
    expect(api.puts()).toHaveLength(0)
  })

  it("makes no request at all without go", async () => {
    const { api, client } = setup()
    const plan = await planChanges(client, {
      workspaceId: WORKSPACE_ID,
      environmentId: QA_ENV.id,
      flags: NAMES,
      operation,
    })
    const before = api.calls.length
    const outcome = await applyChanges(client, {
      workspaceId: WORKSPACE_ID,
      environmentId: QA_ENV.id,
      operation,
      items: selectUpdates(plan),
      title: "t",
      comment: "c",
      guard: { environmentName: "QA", environmentArg: "QA", go: false },
      backup: () => {},
    })
    expect(outcome.ok).toBe(false)
    expect(api.calls.length).toBe(before)
  })

  it("refuses a production environment that was not named exactly", async () => {
    const definitions = {
      [`${PROD_ENV.id}/checkout_a`]: makeDefinition({ name: "checkout_a" }),
    }
    const api = makeFakeApi({ definitions })
    const client = createClient({ apiKey: "k", fetch: api.fetch })
    const plan = await planChanges(client, {
      workspaceId: WORKSPACE_ID,
      environmentId: PROD_ENV.id,
      flags: ["checkout_a"],
      operation,
    })
    const before = api.calls.length
    const outcome = await applyChanges(client, {
      workspaceId: WORKSPACE_ID,
      environmentId: PROD_ENV.id,
      operation,
      items: selectUpdates(plan),
      title: "t",
      comment: "c",
      guard: { environmentName: "Prod", environmentArg: "prod", go: true },
      backup: () => {},
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.results[0].reason).toContain("looks like production")
    expect(api.calls.length).toBe(before)
  })
})
