import { describe, expect, it } from "vitest"
import { createClient } from "../client.js"
import {
  listAllFeatureFlags,
  listFeatureFlags,
  listFlagDefinitions,
  updateFlagDefinition,
} from "../flags.js"
import {
  QA_ENV,
  WORKSPACE_ID,
  flagNamed,
  makeDefinition,
  makeFakeApi,
} from "./fake-api.js"

const manyFlags = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    flagNamed(`checkout_flag_${String(i).padStart(4, "0")}`),
  )

const clientFor = (api: ReturnType<typeof makeFakeApi>) =>
  createClient({ apiKey: "test-key", fetch: api.fetch })

describe("listFeatureFlags page size", () => {
  it("sends limit, not size", async () => {
    const api = makeFakeApi({ flags: manyFlags(5) })
    await listFeatureFlags(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      limit: 50,
      offset: 0,
    })
    const query = new URL(`https://x${api.calls[0].path}`).searchParams
    expect(query.get("limit")).toBe("50")
    expect(query.has("size")).toBe(false)
  })

  it("returns a full page of 50 when 50 are asked for", async () => {
    const api = makeFakeApi({ flags: manyFlags(120) })
    const result = await listFeatureFlags(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      limit: 50,
    })
    expect(result.ok && result.data.objects).toHaveLength(50)
  })
})

describe("listAllFeatureFlags", () => {
  it("pages 1,000 flags in 20 requests, not 50", async () => {
    const api = makeFakeApi({ flags: manyFlags(1000) })
    const result = await listAllFeatureFlags(clientFor(api), {
      workspaceId: WORKSPACE_ID,
    })
    expect(result.ok && result.data).toHaveLength(1000)
    expect(api.calls).toHaveLength(20)
  })

  it("returns every flag exactly once, in order", async () => {
    const api = makeFakeApi({ flags: manyFlags(130) })
    const result = await listAllFeatureFlags(clientFor(api), {
      workspaceId: WORKSPACE_ID,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const names = result.data.map((f) => f.name)
      expect(new Set(names).size).toBe(130)
      expect(names).toEqual([...names].sort())
    }
  })

  it("still gets everything from a server that caps pages below the request", async () => {
    const api = makeFakeApi({ flags: manyFlags(95), pageCap: 20 })
    const result = await listAllFeatureFlags(clientFor(api), {
      workspaceId: WORKSPACE_ID,
    })
    expect(result.ok && result.data).toHaveLength(95)
  })

  it("passes the tag and name filters through", async () => {
    const api = makeFakeApi({
      flags: [
        flagNamed("checkout_a", { tags: [{ name: "payments" }] }),
        flagNamed("checkout_b"),
        flagNamed("search_a", { tags: [{ name: "payments" }] }),
      ],
    })
    const result = await listAllFeatureFlags(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      tag: "payments",
      name: "checkout",
    })
    expect(result.ok && result.data.map((f) => f.name)).toEqual(["checkout_a"])
  })

  it("surfaces a failing page", async () => {
    const result = await listAllFeatureFlags(
      createClient({
        apiKey: "k",
        fetch: async () => new Response("nope", { status: 500 }),
      }),
      { workspaceId: WORKSPACE_ID },
    )
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.message).toContain("failed to fetch feature flags")
  })
})

describe("listFlagDefinitions", () => {
  it("sends limit as well", async () => {
    const api = makeFakeApi({})
    await listFlagDefinitions(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      environmentId: QA_ENV.id,
      limit: 50,
    })
    expect(api.calls[0].path).toContain("limit=50")
    expect(api.calls[0].path).not.toContain("size=")
  })
})

describe("updateFlagDefinition", () => {
  it("attaches title and comment to the body", async () => {
    const api = makeFakeApi({
      definitions: { [`${QA_ENV.id}/checkout_new_flow`]: makeDefinition() },
    })
    const result = await updateFlagDefinition(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      environmentId: QA_ENV.id,
      flagName: "checkout_new_flow",
      definition: JSON.stringify({ treatments: [{ name: "on" }] }),
      title: "A title",
      comment: "A comment",
    })
    expect(result.ok).toBe(true)
    expect(api.puts()[0].body).toMatchObject({
      title: "A title",
      comment: "A comment",
    })
  })

  it("rejects a definition that is not JSON before any request", async () => {
    const api = makeFakeApi({})
    const result = await updateFlagDefinition(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      environmentId: QA_ENV.id,
      flagName: "checkout_new_flow",
      definition: "{nope",
    })
    expect(result.ok).toBe(false)
    expect(api.calls).toHaveLength(0)
  })
})
