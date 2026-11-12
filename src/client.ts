export const API_BASE = "https://api.split.io/internal/api/v2"

// The admin API's request budget is shared by the whole organisation (about 20
// requests per 10-second window, per its x-ratelimit-* headers), so another
// integration can drain it and a single call gets 429 through no fault of its
// own. Waiting out the window the API names, instead of failing on the first
// 429, is what keeps writes usable while the organisation is busy.
export const DEFAULT_MAX_RETRIES = 3
const RATE_LIMIT_FALLBACK_WAIT_MS = 2000
const RATE_LIMIT_MAX_WAIT_MS = 12_000

export type FmeFailure = { ok: false; message: string; status?: number }

export type FmeResult<T> = { ok: true; data: T } | FmeFailure

export type FmeClientOptions = {
  apiKey: string
  baseUrl?: string
  fetch?: typeof fetch
  // Minimum gap between two request starts, retries included. Zero disables
  // spacing; the 429 handling below still applies either way.
  minIntervalMs?: number
  maxRetries?: number
  sleep?: (ms: number) => Promise<void>
  onError?: (message: string, path: string) => void
  onRateLimit?: (waitMs: number, path: string) => void
}

export type RequestOptions = {
  method?: string
  body?: unknown
  // DELETE and similar calls answer with an empty body; skip JSON parsing.
  expectBody?: boolean
}

export type FmeClient = {
  readonly baseUrl: string
  request: <T>(path: string, options?: RequestOptions) => Promise<FmeResult<T>>
}

export const rateLimitWaitMs = (response: Response) => {
  const header =
    response.headers?.get("x-ratelimit-reset-seconds-org") ??
    response.headers?.get("x-ratelimit-reset-seconds-ip")
  const seconds = Number(header)
  const waitMs =
    header && Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : RATE_LIMIT_FALLBACK_WAIT_MS
  return Math.min(waitMs, RATE_LIMIT_MAX_WAIT_MS) + 250
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

// A 2xx from a write (kill, restore, enable and friends) may carry an empty or
// non-JSON body, 204 included: throwing in response.json() there would report
// a write that already happened as a failure and invite a retry. Mocks that
// only provide json() still take that path.
const parseJsonBody = async (response: Response): Promise<unknown> => {
  if (typeof response.text !== "function") return response.json()
  const text = await response.text().catch(() => "")
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const createClient = (options: FmeClientOptions): FmeClient => {
  // The key lives in this closure only, so logging or serialising the client
  // can never print it.
  const { apiKey } = options
  if (!apiKey) throw new Error("apiKey is required")
  const baseUrl = options.baseUrl ?? API_BASE
  const minIntervalMs = options.minIntervalMs ?? 0
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
  const sleep = options.sleep ?? defaultSleep

  let nextSlotAt = 0
  const throttle = async () => {
    if (minIntervalMs <= 0) return
    const now = Date.now()
    const slot = Math.max(now, nextSlotAt)
    nextSlotAt = slot + minIntervalMs
    if (slot > now) await sleep(slot - now)
  }

  const send = async (
    path: string,
    init: RequestInit,
    retriesLeft: number,
  ): Promise<Response> => {
    await throttle()
    const doFetch = options.fetch ?? globalThis.fetch
    const response = await doFetch(`${baseUrl}${path}`, init)
    if (response.status !== 429 || retriesLeft === 0) return response
    const waitMs = rateLimitWaitMs(response)
    options.onRateLimit?.(waitMs, path)
    await sleep(waitMs)
    return send(path, init, retriesLeft - 1)
  }

  const request = async <T>(
    path: string,
    { method = "GET", body, expectBody = true }: RequestOptions = {},
  ): Promise<FmeResult<T>> => {
    try {
      const response = await send(
        path,
        {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        },
        maxRetries,
      )
      if (!response.ok) {
        const text =
          typeof response.text === "function"
            ? await response.text().catch(() => "")
            : ""
        const message = `${response.status}${text ? `: ${text}` : ""}`
        options.onError?.(message, path)
        return { ok: false, message, status: response.status }
      }
      if (!expectBody) return { ok: true, data: undefined as T }
      return { ok: true, data: (await parseJsonBody(response)) as T }
    } catch (e) {
      const message = e instanceof Error ? e.message : "network error"
      options.onError?.(message, path)
      return { ok: false, message }
    }
  }

  return { baseUrl, request }
}

// Prefix a failure with what the caller was trying to do, keeping the status
// code for programmatic checks (a 404 is often an answer, not an error).
export const withContext = <T>(
  result: FmeResult<T>,
  context: string,
): FmeResult<T> =>
  result.ok
    ? result
    : {
        ok: false,
        status: result.status,
        message: `${context} (${result.message})`,
      }

export const failure = (message: string): FmeFailure => ({
  ok: false,
  message,
})

// A Split/FME resource GUID (8-4-4-4-12). Used to tell an already-resolved id
// from a human name so callers can pass either.
export const GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const KEY_ENV_VARS = ["HARNESS_FME_API_KEY", "MCP_HARNESS_FME_API_KEY"] as const

// First non-empty value among the supported variables. HARNESS_FME_API_KEY is
// the neutral name; MCP_HARNESS_FME_API_KEY is what the MCP server has always
// read, kept so one exported key serves every surface.
export const resolveApiKey = (
  env: Record<string, string | undefined> = process.env,
): string | undefined => {
  for (const name of KEY_ENV_VARS) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

export const API_KEY_ENV_VARS: readonly string[] = KEY_ENV_VARS
