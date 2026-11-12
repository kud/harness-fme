import { describe, expect, it } from "vitest"
import { createClient } from "../client.js"
import { buildFlagRows, countFlags, findFlags } from "../rollout.js"
import {
  PROD_ENV,
  QA_ENV,
  WORKSPACE_ID,
  flagNamed,
  makeDefinition,
  makeFakeApi,
} from "./fake-api.js"

describe("findFlags", () => {
  it("narrows a partial name match to a true prefix and drops archived flags", async () => {
    const api = makeFakeApi({
      flags: [
        flagNamed("checkout_a"),
        flagNamed("old_checkout_b"),
        flagNamed("checkout_c", { status: "ARCHIVED" }),
      ],
    })
    const client = createClient({ apiKey: "k", fetch: api.fetch })
    const result = await findFlags(client, WORKSPACE_ID, { prefix: "checkout" })
    expect(result.ok && result.data.map((f) => f.name)).toEqual(["checkout_a"])
  })
})

describe("buildFlagRows", () => {
  const names = ["checkout_a", "checkout_b"]
  const setup = () => {
    const definitions: Record<string, ReturnType<typeof makeDefinition>> = {}
    for (const name of names) {
      definitions[`${QA_ENV.id}/${name}`] = makeDefinition({
        name,
        defaultRule: [{ treatment: "on", size: 100 }],
      })
    }
    definitions[`${PROD_ENV.id}/checkout_a`] = makeDefinition({
      name: "checkout_a",
    })
    const api = makeFakeApi({ definitions })
    return {
      api,
      client: createClient({ apiKey: "k", fetch: api.fetch }),
    }
  }

  it("reads per flag when that is cheaper than listing the environment", async () => {
    const { api, client } = setup()
    const result = await buildFlagRows(client, {
      workspaceId: WORKSPACE_ID,
      flags: [flagNamed("checkout_a")],
      environments: [QA_ENV],
      totalFlags: 400,
    })
    expect(result.ok).toBe(true)
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0].path).toContain("/checkout_a/environments/")
  })

  it("lists the environment once when many flags are wanted", async () => {
    const { api, client } = setup()
    const result = await buildFlagRows(client, {
      workspaceId: WORKSPACE_ID,
      flags: names.map((n) => flagNamed(n)),
      environments: [QA_ENV],
      totalFlags: 2,
    })
    expect(result.ok).toBe(true)
    expect(api.calls).toHaveLength(1)
    expect(api.calls[0].path).toContain("/splits/ws/")
    expect(api.calls[0].path).toContain("limit=50")
  })

  it("marks a flag missing from an environment as undefined", async () => {
    const { client } = setup()
    const result = await buildFlagRows(client, {
      workspaceId: WORKSPACE_ID,
      flags: names.map((n) => flagNamed(n)),
      environments: [QA_ENV, PROD_ENV],
      totalFlags: 2,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const b = result.data.find((r) => r.flag === "checkout_b")!
      expect(b.environments.map((e) => e.state)).toEqual(["on", "undefined"])
      const a = result.data.find((r) => r.flag === "checkout_a")!
      expect(a.environments.map((e) => e.state)).toEqual(["on", "off"])
    }
  })
})

describe("countFlags", () => {
  it("reads the total from one page", async () => {
    const api = makeFakeApi({
      flags: Array.from({ length: 7 }, (_, i) => flagNamed(`f_${i}`)),
    })
    const client = createClient({ apiKey: "k", fetch: api.fetch })
    const result = await countFlags(client, WORKSPACE_ID)
    expect(result).toEqual({ ok: true, data: 7 })
    expect(api.calls).toHaveLength(1)
  })
})
