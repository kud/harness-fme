import { describe, expect, it } from "vitest"
import { createClient } from "../client.js"
import { buildFlagUrl } from "../url.js"

const makeWorkspaceApi = (count: number) => {
  const workspaces = Array.from({ length: count }, (_, i) => ({
    id: `ws-${i}`,
    name: `Workspace ${i}`,
    organizationIdentifier: i === 54 ? "org-1" : undefined,
    projectIdentifier: i === 54 ? "proj-1" : undefined,
  }))
  // The wanted workspace is the 55th of 60, just past the first page of 50.
  workspaces[54] = {
    id: "ws-54",
    name: "late_workspace",
    organizationIdentifier: "org-1",
    projectIdentifier: "proj-1",
  }
  const calls: string[] = []
  const page = (params: URLSearchParams) => {
    const limit = Math.min(Number(params.get("limit") ?? 20), 50)
    const offset = Number(params.get("offset") ?? 0)
    return new Response(
      JSON.stringify({
        objects: workspaces.slice(offset, offset + limit),
        totalCount: workspaces.length,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }
  const handler = async (url: string | URL | Request) => {
    const full = new URL(String(url))
    calls.push(full.pathname + full.search)
    if (full.pathname.endsWith("/workspaces")) return page(full.searchParams)
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  return { fetch: handler as typeof fetch, calls }
}

describe("buildFlagUrl", () => {
  it("finds a workspace beyond the first page of 50", async () => {
    const api = makeWorkspaceApi(60)
    const client = createClient({ apiKey: "k", fetch: api.fetch })
    const result = await buildFlagUrl(client, {
      accountId: "acct-1",
      orgGuid: "org-guid-1",
      workspace: "late_workspace",
      flag: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      environment: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.url).toContain("/ws/ws-54/splits/")
    expect(api.calls).toHaveLength(2)
  })
})
