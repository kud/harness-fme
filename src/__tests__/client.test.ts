import { describe, expect, it, vi } from "vitest"
import {
  API_KEY_ENV_VARS,
  createClient,
  rateLimitWaitMs,
  resolveApiKey,
} from "../client.js"

const respond = (status: number, body: unknown = {}, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers })

describe("createClient", () => {
  it("refuses to be built without a key", () => {
    expect(() => createClient({ apiKey: "" })).toThrow("apiKey is required")
  })

  it("sends the key as a bearer token and never exposes it on the client", async () => {
    const fetchMock = vi.fn(async () => respond(200, { ok: 1 }))
    const client = createClient({ apiKey: "secret-key-123", fetch: fetchMock })
    await client.request("/workspaces")
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-key-123",
    )
    expect(JSON.stringify(client)).not.toContain("secret-key-123")
  })

  it("does not put the key in a failure message", async () => {
    const fetchMock = vi.fn(async () => respond(401, { message: "denied" }))
    const client = createClient({ apiKey: "secret-key-123", fetch: fetchMock })
    const result = await client.request("/workspaces")
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
      expect(result.message).not.toContain("secret-key-123")
    }
  })

  it("spaces request starts by the minimum interval", async () => {
    const waits: number[] = []
    const client = createClient({
      apiKey: "k",
      fetch: vi.fn(async () => respond(200)),
      minIntervalMs: 550,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    await client.request("/a")
    await client.request("/b")
    await client.request("/c")
    // the fake sleep does not advance the clock, so slots stack up: 1 and 2 intervals out
    expect(waits).toHaveLength(2)
    expect(waits[0]).toBeGreaterThan(450)
    expect(waits[0]).toBeLessThanOrEqual(550)
    expect(waits[1]).toBeGreaterThan(waits[0] + 450)
  })

  it("waits out a 429 using the reset header, then retries", async () => {
    const waits: number[] = []
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respond(429, {}, { "x-ratelimit-reset-seconds-org": "3" }),
      )
      .mockResolvedValueOnce(respond(200, { done: true }))
    const client = createClient({
      apiKey: "k",
      fetch: fetchMock,
      sleep: async (ms) => {
        waits.push(ms)
      },
    })
    const result = await client.request<{ done: boolean }>("/a")
    expect(result).toEqual({ ok: true, data: { done: true } })
    expect(waits).toEqual([3250])
  })

  it("gives up after the retry budget and reports the 429", async () => {
    const fetchMock = vi.fn(async () => respond(429))
    const client = createClient({
      apiKey: "k",
      fetch: fetchMock,
      maxRetries: 2,
      sleep: async () => {},
    })
    const result = await client.request("/a")
    expect(result.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe("empty and non-JSON 2xx bodies", () => {
  it("reports an empty 200 as a success with null data", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }))
    const client = createClient({ apiKey: "k", fetch: fetchMock })
    const result = await client.request("/splits/ws/w/flag/kill", {
      method: "PUT",
    })
    expect(result).toEqual({ ok: true, data: null })
  })

  it("reports a 204 as a success with null data", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))
    const client = createClient({ apiKey: "k", fetch: fetchMock })
    const result = await client.request("/anything", { method: "DELETE" })
    expect(result).toEqual({ ok: true, data: null })
  })

  it("reports a 200 whose body is not JSON as a success with null data", async () => {
    const fetchMock = vi.fn(
      async () => new Response("gateway says hi", { status: 200 }),
    )
    const client = createClient({ apiKey: "k", fetch: fetchMock })
    const result = await client.request("/anything")
    expect(result).toEqual({ ok: true, data: null })
  })

  it("still parses a mock that only provides json()", async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ fine: true }),
        }) as unknown as Response,
    )
    const client = createClient({ apiKey: "k", fetch: fetchMock })
    const result = await client.request<{ fine: boolean }>("/anything")
    expect(result).toEqual({ ok: true, data: { fine: true } })
  })
})

describe("rateLimitWaitMs", () => {
  const withHeaders = (headers: Record<string, string>) =>
    ({ headers: new Headers(headers) }) as Response

  it("uses the org window, then the ip window, then a short default", () => {
    expect(
      rateLimitWaitMs(withHeaders({ "x-ratelimit-reset-seconds-org": "6" })),
    ).toBe(6250)
    expect(
      rateLimitWaitMs(withHeaders({ "x-ratelimit-reset-seconds-ip": "4" })),
    ).toBe(4250)
    expect(rateLimitWaitMs(withHeaders({}))).toBe(2250)
  })

  it("caps a long reset", () => {
    expect(
      rateLimitWaitMs(withHeaders({ "x-ratelimit-reset-seconds-org": "300" })),
    ).toBe(12250)
  })
})

describe("resolveApiKey", () => {
  it("prefers the neutral name and falls back to the MCP name", () => {
    expect(API_KEY_ENV_VARS).toEqual([
      "HARNESS_FME_API_KEY",
      "MCP_HARNESS_FME_API_KEY",
    ])
    expect(
      resolveApiKey({
        HARNESS_FME_API_KEY: "a",
        MCP_HARNESS_FME_API_KEY: "b",
      }),
    ).toBe("a")
    expect(resolveApiKey({ MCP_HARNESS_FME_API_KEY: "b" })).toBe("b")
    expect(resolveApiKey({})).toBeUndefined()
  })
})
