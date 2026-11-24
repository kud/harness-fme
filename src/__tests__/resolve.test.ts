import { describe, expect, it } from "vitest"
import { createClient } from "../client.js"
import { resolveTrafficType, resolveWorkspaceId } from "../workspaces.js"

const ACME_ID = "11111111-2222-4333-8444-555555555555"

const fakeFetch = (calls: string[]) =>
  (async (url: string | URL | Request) => {
    const full = new URL(String(url))
    const path = full.pathname.replace("/internal/api/v2", "")
    calls.push(path)
    const body =
      path === "/workspaces"
        ? { objects: [{ id: ACME_ID, name: "acme" }], totalCount: 1 }
        : path.startsWith("/trafficTypes/ws/")
          ? [
              { id: "tt-user", name: "user" },
              { id: "tt-account", name: "account" },
            ]
          : null
    return body
      ? new Response(JSON.stringify(body), { status: 200 })
      : new Response("not found", { status: 404 })
  }) as typeof fetch

describe("resolveWorkspaceId", () => {
  it("takes a GUID as an id without a lookup", async () => {
    const calls: string[] = []
    const client = createClient({ apiKey: "k", fetch: fakeFetch(calls) })
    const result = await resolveWorkspaceId(client, ACME_ID)
    expect(result).toEqual({ ok: true, data: ACME_ID })
    expect(calls).toHaveLength(0)
  })

  it("resolves a name, ignoring case", async () => {
    const client = createClient({ apiKey: "k", fetch: fakeFetch([]) })
    expect(await resolveWorkspaceId(client, "ACME")).toEqual({
      ok: true,
      data: ACME_ID,
    })
  })

  it("names the available workspaces when a name is unknown", async () => {
    const client = createClient({ apiKey: "k", fetch: fakeFetch([]) })
    const result = await resolveWorkspaceId(client, "globex")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("Available: acme")
  })
})

describe("resolveTrafficType", () => {
  it("resolves by name or id", async () => {
    const client = createClient({ apiKey: "k", fetch: fakeFetch([]) })
    const byName = await resolveTrafficType(client, ACME_ID, "Account")
    const byId = await resolveTrafficType(client, ACME_ID, "tt-user")
    expect(byName.ok && byName.data.id).toBe("tt-account")
    expect(byId.ok && byId.data.name).toBe("user")
  })

  it("fails with the available names", async () => {
    const client = createClient({ apiKey: "k", fetch: fakeFetch([]) })
    const result = await resolveTrafficType(client, ACME_ID, "device")
    expect(!result.ok && result.message).toContain("Available: user, account")
  })
})
