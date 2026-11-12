import { describe, expect, it } from "vitest"
import { createClient } from "../client.js"
import {
  listWorkspaces,
  getAllWorkspaces,
  resolveWorkspace,
} from "../workspaces.js"

const WORKSPACE_ID = "11111111-2222-4333-8444-555555555555"

const makeFakeApi = (
  options: { workspaces?: Array<{ id: string; name: string }> } = {},
) => {
  const workspaces = options.workspaces ?? [
    { id: WORKSPACE_ID, name: "Default" },
  ]
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

    if (method === "GET" && path === "/workspaces") {
      return page(workspaces, full.searchParams)
    }
    return new Response(
      JSON.stringify({ message: `unhandled ${method} ${path}` }),
      { status: 500 },
    )
  }

  return { fetch: handler as typeof fetch, calls, workspaces }
}

const clientFor = (api: ReturnType<typeof makeFakeApi>) =>
  createClient({ apiKey: "test-key", fetch: api.fetch })

describe("listWorkspaces page size", () => {
  it("sends limit, not size", async () => {
    const api = makeFakeApi({
      workspaces: Array.from({ length: 5 }, (_, i) => ({
        id: `ws-${i}`,
        name: `Workspace ${i}`,
      })),
    })
    await listWorkspaces(clientFor(api), { limit: 50, offset: 0 })
    const query = new URL(`https://x${api.calls[0].path}`).searchParams
    expect(query.get("limit")).toBe("50")
    expect(query.has("size")).toBe(false)
  })

  it("returns a full page of 50 when 50 are asked for", async () => {
    const api = makeFakeApi({
      workspaces: Array.from({ length: 120 }, (_, i) => ({
        id: `ws-${i}`,
        name: `Workspace ${i}`,
      })),
    })
    const result = await listWorkspaces(clientFor(api), { limit: 50 })
    expect(result.ok && result.data.objects).toHaveLength(50)
  })
})

describe("getAllWorkspaces", () => {
  it("pages 120 workspaces in 3 requests of 50, 50, 20", async () => {
    const api = makeFakeApi({
      workspaces: Array.from({ length: 120 }, (_, i) => ({
        id: `ws-${i}`,
        name: `Workspace ${i}`,
      })),
    })
    const result = await getAllWorkspaces(clientFor(api))
    expect(result.ok && result.data).toHaveLength(120)
    expect(api.calls).toHaveLength(3)
  })
})

describe("resolveWorkspace with many workspaces", () => {
  it("finds a workspace beyond the first page", async () => {
    const api = makeFakeApi({
      workspaces: Array.from({ length: 60 }, (_, i) => ({
        id: `ws-${i}`,
        name: `Workspace ${i}`,
      })),
    })
    const result = await resolveWorkspace(clientFor(api), "Workspace 55")
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.name).toBe("Workspace 55")
  })
})
