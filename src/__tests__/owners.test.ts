import { describe, expect, it } from "vitest"
import { createClient } from "../client.js"
import { withOwnerNames } from "../owners.js"

const fakeFetch = (calls: string[]) =>
  (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname.replace("/internal/api/v2", "")
    calls.push(path)
    if (path === "/users/u-ada")
      return new Response(
        JSON.stringify({
          id: "u-ada",
          name: "Ada Example",
          email: "ada@acme.test",
        }),
      )
    if (path === "/groups/g-payments")
      return new Response(
        JSON.stringify({ id: "g-payments", name: "Payments" }),
      )
    return new Response("not found", { status: 404 })
  }) as typeof fetch

describe("withOwnerNames", () => {
  it("names users and groups and keeps their ids", async () => {
    const calls: string[] = []
    const client = createClient({ apiKey: "k", fetch: fakeFetch(calls) })
    const flag = await withOwnerNames(client, {
      name: "checkout-redesign",
      owners: [
        { id: "u-ada", type: "user" },
        { id: "g-payments", type: "group" },
        { id: "u-gone", type: "user" },
      ],
    })
    expect(flag.owners).toEqual([
      {
        id: "u-ada",
        type: "user",
        name: "Ada Example",
        email: "ada@acme.test",
      },
      { id: "g-payments", type: "group", name: "Payments" },
      { id: "u-gone", type: "user", name: null },
    ])
    expect(calls).toEqual([
      "/users/u-ada",
      "/groups/g-payments",
      "/users/u-gone",
    ])
  })

  it("reads a repeated owner once", async () => {
    const calls: string[] = []
    const client = createClient({ apiKey: "k", fetch: fakeFetch(calls) })
    await withOwnerNames(client, {
      name: "checkout-redesign",
      owners: [
        { id: "u-ada", type: "user" },
        { id: "u-ada", type: "user" },
      ],
    })
    expect(calls).toHaveLength(1)
  })

  it("returns a flag without owners unchanged and without calls", async () => {
    const calls: string[] = []
    const client = createClient({ apiKey: "k", fetch: fakeFetch(calls) })
    const flag = { name: "checkout-redesign" }
    expect(await withOwnerNames(client, flag)).toBe(flag)
    expect(calls).toHaveLength(0)
  })
})
