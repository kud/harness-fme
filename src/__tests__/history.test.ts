import { describe, expect, it } from "vitest"
import { createClient } from "../client.js"
import {
  buildFlagHistory,
  getFlagHistory,
  type ChangeRequest,
} from "../history.js"
import { makeDefinition } from "./fake-api.js"

const PRODUCTION_ID = "99999999-8888-4777-8666-555555555555"

const changeRequest = (
  id: string,
  time: number,
  overrides: Partial<ChangeRequest> = {},
  definition = {},
): ChangeRequest => ({
  id,
  status: "PUBLISHED",
  title: `change ${id}`,
  comment: null,
  requester: "ada@acme.test",
  operationType: "UPDATE",
  approvers: [],
  comments: [
    {
      comment: "please",
      user: "ada@acme.test",
      role: "SUBMITTER",
      timestamp: time,
    },
  ],
  split: {
    ...makeDefinition({ name: "checkout-redesign", ...definition }),
    environment: { id: PRODUCTION_ID, name: "production" },
  },
  ...overrides,
})

describe("buildFlagHistory", () => {
  it("shows a default rule switch with its author and before/after", () => {
    const history = buildFlagHistory([
      changeRequest("cr-1", 1_767_323_000_000),
      changeRequest(
        "cr-2",
        1_767_323_045_678,
        {
          title: "Turn on for everyone",
          approvers: [{ name: "Grace Example" }],
          comments: [
            {
              comment: "ship",
              user: "ada@acme.test",
              role: "SUBMITTER",
              timestamp: 1_767_323_040_000,
            },
            {
              comment: "ok",
              user: "grace@acme.test",
              role: "APPROVER",
              timestamp: 1_767_323_045_678,
            },
          ],
        },
        { defaultRule: [{ treatment: "on", size: 100 }] },
      ),
    ])
    expect(history.map((c) => c.id)).toEqual(["cr-2", "cr-1"])
    const latest = history[0]
    expect(latest).toMatchObject({
      title: "Turn on for everyone",
      changeType: "UPDATE",
      status: "PUBLISHED",
      editedBy: "ada@acme.test",
      approvers: ["Grace Example", "grace@acme.test"],
      timeIso: "2026-01-02T03:04:05.678Z",
      defaultRuleBefore: "off 100%",
      defaultRuleAfter: "on 100%",
    })
    expect(latest.diff).toEqual([
      { path: "defaultRule[0].treatment", before: "off", after: "on" },
    ])
    expect(history[1].diff).toBeNull()
  })

  it("ignores stamps and list order in the diff", () => {
    const history = buildFlagHistory([
      changeRequest(
        "cr-1",
        1,
        {},
        {
          treatments: [{ name: "on", keys: ["a", "b"] }, { name: "off" }],
          lastUpdateTime: 5,
        },
      ),
      changeRequest(
        "cr-2",
        2,
        {},
        {
          treatments: [{ name: "on", keys: ["b", "a"] }, { name: "off" }],
          lastUpdateTime: 9,
        },
      ),
    ])
    expect(history[0].diff).toEqual([])
  })

  it("falls back to the submitter comment for the author", () => {
    const [change] = buildFlagHistory([
      changeRequest("cr-1", 1_767_323_045_678, { requester: undefined }),
    ])
    expect(change.editedBy).toBe("ada@acme.test")
  })
})

describe("getFlagHistory", () => {
  const pages: Record<string, unknown> = {
    first: {
      data: [
        changeRequest("cr-1", 1_767_323_000_000),
        {
          ...changeRequest("cr-x", 1_767_323_010_000),
          split: { ...makeDefinition({ name: "search-v2" }) },
        },
      ],
      nextMarker: "m2",
    },
    m2: {
      data: [
        changeRequest(
          "cr-2",
          1_767_323_045_678,
          {},
          {
            defaultRule: [{ treatment: "on", size: 100 }],
          },
        ),
      ],
      nextMarker: null,
    },
  }

  const fakeFetch = (urls: URL[]) =>
    (async (url: string | URL | Request) => {
      const full = new URL(String(url))
      urls.push(full)
      const after = full.searchParams.get("after") ?? "first"
      return new Response(JSON.stringify(pages[after]))
    }) as typeof fetch

  it("pages change requests and keeps only the flag's own", async () => {
    const urls: URL[] = []
    const client = createClient({ apiKey: "k", fetch: fakeFetch(urls) })
    const result = await getFlagHistory(client, {
      environmentId: PRODUCTION_ID,
      flagName: "checkout-redesign",
    })
    expect(result.ok && result.data.map((c) => c.id)).toEqual(["cr-2", "cr-1"])
    expect(urls).toHaveLength(2)
    expect(urls[0].pathname).toBe("/internal/api/v2/changeRequests")
    expect(urls[0].searchParams.get("environmentId")).toBe(PRODUCTION_ID)
    expect(urls[0].searchParams.get("status")).toBe("PUBLISHED")
    expect(urls[0].searchParams.get("limit")).toBe("100")
    expect(urls[1].searchParams.get("after")).toBe("m2")
  })

  it("stops reading once it has more than the limit", async () => {
    const urls: URL[] = []
    const client = createClient({ apiKey: "k", fetch: fakeFetch(urls) })
    await getFlagHistory(client, {
      environmentId: PRODUCTION_ID,
      flagName: "checkout-redesign",
      limit: 0,
    })
    expect(urls).toHaveLength(1)
  })

  it("passes an API failure through with context", async () => {
    const client = createClient({
      apiKey: "k",
      fetch: (async () => new Response("no", { status: 401 })) as typeof fetch,
    })
    const result = await getFlagHistory(client, {
      environmentId: PRODUCTION_ID,
      flagName: "checkout-redesign",
    })
    expect(!result.ok && result.message).toContain(
      "failed to fetch change requests (401",
    )
  })
})
