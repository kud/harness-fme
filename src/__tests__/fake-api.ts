import { type FeatureFlag, type FlagDefinition } from "../types.js"

export const WORKSPACE_ID = "11111111-2222-4333-8444-555555555555"
export const QA_ENV = { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "QA" }
export const PROD_ENV = {
  id: "99999999-8888-4777-8666-555555555555",
  name: "Prod",
}

export const makeDefinition = (
  overrides: Partial<FlagDefinition> = {},
): FlagDefinition => ({
  name: "checkout_new_flow",
  killed: false,
  treatments: [{ name: "on" }, { name: "off" }],
  defaultTreatment: "off",
  baselineTreatment: "off",
  trafficAllocation: 100,
  rules: [],
  defaultRule: [{ treatment: "off", size: 100 }],
  lastUpdateTime: 1,
  ...overrides,
})

export type FakeApiOptions = {
  flags?: FeatureFlag[]
  definitions?: Record<string, FlagDefinition>
  // The most objects one list page returns, whatever `limit` asks for.
  pageCap?: number
  // Runs on each stored definition after a PUT; lets a test simulate a server
  // that silently drops part of a write.
  afterWrite?: (flag: string, stored: FlagDefinition) => FlagDefinition
  failPutFor?: string[]
}

export type RecordedCall = { method: string; path: string; body?: unknown }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

export const makeFakeApi = (options: FakeApiOptions = {}) => {
  const flags = options.flags ?? []
  const definitions = new Map<string, FlagDefinition>(
    Object.entries(options.definitions ?? {}),
  )
  const calls: RecordedCall[] = []

  const page = <T>(items: T[], params: URLSearchParams) => {
    // The real API reads `limit`; `size` is ignored.
    const cap = Math.min(Number(params.get("limit") ?? 20), 50)
    const limit = Math.min(cap, options.pageCap ?? 50)
    const offset = Number(params.get("offset") ?? 0)
    return json({
      objects: items.slice(offset, offset + limit),
      totalCount: items.length,
    })
  }

  const handler = async (url: string | URL | Request, init?: RequestInit) => {
    const full = new URL(String(url))
    const path = full.pathname.replace("/internal/api/v2", "")
    const method = init?.method ?? "GET"
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: path + full.search, body })
    const parts = path.split("/").filter(Boolean)

    if (method === "GET" && path === "/workspaces")
      return page([{ id: WORKSPACE_ID, name: "Default" }], full.searchParams)
    if (method === "GET" && parts[0] === "environments")
      return json([QA_ENV, PROD_ENV])

    if (parts[0] === "splits" && parts[1] === "ws") {
      // /splits/ws/:ws
      if (parts.length === 3 && method === "GET") {
        const name = full.searchParams.get("name")
        const tag = full.searchParams.get("tag")
        const matching = flags.filter(
          (f) =>
            (!name || f.name.includes(name)) &&
            (!tag || (f.tags ?? []).some((t) => t.name === tag)),
        )
        return page(matching, full.searchParams)
      }
      // /splits/ws/:ws/environments/:env
      if (
        parts.length === 5 &&
        parts[3] === "environments" &&
        method === "GET"
      ) {
        const env = parts[4]
        const defs = [...definitions.entries()]
          .filter(([key]) => key.startsWith(`${env}/`))
          .map(([, def]) => def)
        return page(defs, full.searchParams)
      }
      // /splits/ws/:ws/:flag/environments/:env
      if (parts.length === 6 && parts[4] === "environments") {
        const flag = parts[3]
        const key = `${parts[5]}/${flag}`
        if (method === "GET") {
          const def = definitions.get(key)
          return def ? json(def) : json({ message: "not found" }, 404)
        }
        if (method === "PUT") {
          if (options.failPutFor?.includes(flag))
            return json({ message: "boom" }, 500)
          const current = definitions.get(key)
          if (!current) return json({ message: "not found" }, 404)
          let stored: FlagDefinition = {
            ...current,
            ...(body as Partial<FlagDefinition>),
            lastUpdateTime: (current.lastUpdateTime ?? 0) + 1,
          }
          delete (stored as Record<string, unknown>).title
          delete (stored as Record<string, unknown>).comment
          if (options.afterWrite) stored = options.afterWrite(flag, stored)
          definitions.set(key, stored)
          return json(stored)
        }
      }
    }
    return json({ message: `unhandled ${method} ${path}` }, 500)
  }

  return {
    fetch: handler as typeof fetch,
    calls,
    definitions,
    puts: () => calls.filter((c) => c.method === "PUT"),
  }
}

export const flagNamed = (name: string, extra: Partial<FeatureFlag> = {}) =>
  ({
    id: `id-${name}`,
    name,
    status: "ACTIVE",
    rolloutStatus: { id: "r1", name: "Ramping" },
    ...extra,
  }) as FeatureFlag
