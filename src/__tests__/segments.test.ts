import { describe, expect, it } from "vitest"
import { createClient } from "../client.js"
import {
  listSegments,
  listSegmentDefinitions,
  listSegmentKeys,
  listRuleBasedSegments,
} from "../segments.js"

const WORKSPACE_ID = "11111111-2222-4333-8444-555555555555"
const ENV_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

const makeFakeApi = (
  options: {
    segments?: Array<{ id: string; name: string }>
    segmentDefs?: Array<{ id: string; name: string }>
    segmentKeys?: Array<{ key: string }>
    ruleBasedSegments?: Array<{ id: string; name: string }>
  } = {},
) => {
  const segments =
    options.segments ??
    Array.from({ length: 5 }, (_, i) => ({
      id: `seg-${i}`,
      name: `Segment ${i}`,
    }))
  const segmentDefs =
    options.segmentDefs ??
    Array.from({ length: 5 }, (_, i) => ({
      id: `segdef-${i}`,
      name: `SegmentDef ${i}`,
    }))
  const segmentKeys =
    options.segmentKeys ??
    Array.from({ length: 5 }, (_, i) => ({ key: `key-${i}` }))
  const ruleBasedSegments =
    options.ruleBasedSegments ??
    Array.from({ length: 5 }, (_, i) => ({
      id: `rbs-${i}`,
      name: `RuleBasedSegment ${i}`,
    }))
  const calls: Array<{ method: string; path: string; body?: unknown }> = []

  const page = <T>(items: T[], params: URLSearchParams) => {
    const limit = Math.min(Number(params.get("limit") ?? 20), 50)
    const offset = Number(params.get("offset") ?? 0)
    return new Response(
      JSON.stringify({
        objects: items.slice(offset, offset + limit),
        totalCount: items.length,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    )
  }

  const handler = async (url: string | URL | Request, init?: RequestInit) => {
    const full = new URL(String(url))
    const path = full.pathname.replace("/internal/api/v2", "")
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: path + full.search, body })
    const parts = path.split("/").filter(Boolean)

    if (
      method === "GET" &&
      parts[0] === "segments" &&
      parts[1] === "ws" &&
      parts.length === 3
    ) {
      return page(segments, full.searchParams)
    }
    if (
      method === "GET" &&
      parts[0] === "segments" &&
      parts[1] === "ws" &&
      parts.length === 5 &&
      parts[3] === "environments"
    ) {
      return page(segmentDefs, full.searchParams)
    }
    if (
      method === "GET" &&
      parts[0] === "segments" &&
      parts.length === 4 &&
      parts[3] === "keys"
    ) {
      return new Response(
        JSON.stringify({
          keys: segmentKeys.slice(0, 50),
          count: segmentKeys.length,
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      )
    }
    if (
      method === "GET" &&
      parts[0] === "rule-based-segments" &&
      parts[1] === "ws" &&
      parts.length === 3
    ) {
      return page(ruleBasedSegments, full.searchParams)
    }
    return new Response(
      JSON.stringify({ message: `unhandled ${method} ${path}` }),
      { status: 500 },
    )
  }

  return { fetch: handler as typeof fetch, calls }
}

const clientFor = (api: ReturnType<typeof makeFakeApi>) =>
  createClient({ apiKey: "test-key", fetch: api.fetch })

describe("segments paging - sends limit not size", () => {
  it("listSegments sends limit", async () => {
    const api = makeFakeApi({
      segments: Array.from({ length: 10 }, (_, i) => ({
        id: `seg-${i}`,
        name: `Segment ${i}`,
      })),
    })
    await listSegments(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      limit: 50,
      offset: 0,
    })
    const query = new URL(`https://x${api.calls[0].path}`).searchParams
    expect(query.get("limit")).toBe("50")
    expect(query.has("size")).toBe(false)
  })

  it("listSegmentDefinitions sends limit", async () => {
    const api = makeFakeApi({
      segmentDefs: Array.from({ length: 10 }, (_, i) => ({
        id: `segdef-${i}`,
        name: `SegmentDef ${i}`,
      })),
    })
    await listSegmentDefinitions(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      environmentId: ENV_ID,
      limit: 50,
      offset: 0,
    })
    const query = new URL(`https://x${api.calls[0].path}`).searchParams
    expect(query.get("limit")).toBe("50")
    expect(query.has("size")).toBe(false)
  })

  it("listSegmentKeys sends limit", async () => {
    const api = makeFakeApi({
      segmentKeys: Array.from({ length: 10 }, (_, i) => ({ key: `key-${i}` })),
    })
    await listSegmentKeys(clientFor(api), {
      environmentId: ENV_ID,
      segmentName: "Test Segment",
      limit: 50,
      offset: 0,
    })
    const query = new URL(`https://x${api.calls[0].path}`).searchParams
    expect(query.get("limit")).toBe("50")
    expect(query.has("size")).toBe(false)
  })

  it("listRuleBasedSegments sends limit", async () => {
    const api = makeFakeApi({
      ruleBasedSegments: Array.from({ length: 10 }, (_, i) => ({
        id: `rbs-${i}`,
        name: `RuleBasedSegment ${i}`,
      })),
    })
    await listRuleBasedSegments(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      limit: 50,
      offset: 0,
    })
    const query = new URL(`https://x${api.calls[0].path}`).searchParams
    expect(query.get("limit")).toBe("50")
    expect(query.has("size")).toBe(false)
  })
})

describe("segments paging - returns correct page size", () => {
  it("listSegments returns 50 when 50 asked for", async () => {
    const api = makeFakeApi({
      segments: Array.from({ length: 120 }, (_, i) => ({
        id: `seg-${i}`,
        name: `Segment ${i}`,
      })),
    })
    const result = await listSegments(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      limit: 50,
    })
    expect(result.ok && result.data.objects).toHaveLength(50)
  })

  it("listSegmentDefinitions returns 50 when 50 asked for", async () => {
    const api = makeFakeApi({
      segmentDefs: Array.from({ length: 120 }, (_, i) => ({
        id: `segdef-${i}`,
        name: `SegmentDef ${i}`,
      })),
    })
    const result = await listSegmentDefinitions(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      environmentId: ENV_ID,
      limit: 50,
    })
    expect(result.ok && result.data.objects).toHaveLength(50)
  })

  it("listRuleBasedSegments returns 50 when 50 asked for", async () => {
    const api = makeFakeApi({
      ruleBasedSegments: Array.from({ length: 120 }, (_, i) => ({
        id: `rbs-${i}`,
        name: `RuleBasedSegment ${i}`,
      })),
    })
    const result = await listRuleBasedSegments(clientFor(api), {
      workspaceId: WORKSPACE_ID,
      limit: 50,
    })
    expect(result.ok).toBe(true)
    if (result.ok)
      expect((result.data as { objects: unknown[] }).objects).toHaveLength(50)
  })
})
