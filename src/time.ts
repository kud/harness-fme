// The admin API stamps times as epoch milliseconds (`lastUpdateTime`,
// `creationTime`, `lastTrafficReceivedAt`, …). Nobody reads those by eye, so
// every such field gets an ISO 8601 UTC twin beside it, named `<field>Iso`.

// Between 2001-09-09 and 2286-11-20 in epoch milliseconds. Anything outside is
// not a timestamp in milliseconds: a count, a size, or a value in seconds.
const MIN_EPOCH_MS = 1_000_000_000_000
const MAX_EPOCH_MS = 9_999_999_999_999

const TIME_FIELD_RE = /(Time|At|Timestamp|Date)$/

export const ISO_SUFFIX = "Iso"

export const isEpochMs = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= MIN_EPOCH_MS &&
  value <= MAX_EPOCH_MS

export const toIso = (epochMs: number): string =>
  new Date(epochMs).toISOString()

export const isTimeField = (key: string, value: unknown): boolean =>
  TIME_FIELD_RE.test(key) && isEpochMs(value)

// A deep copy of `value` where every epoch-millisecond time field carries an
// ISO twin. The original fields are kept untouched, so code that reads the
// numbers keeps working.
export const withIsoTimes = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((v) => withIsoTimes(v)) as T
  if (!value || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = withIsoTimes(v)
    if (isTimeField(key, v) && !(`${key}${ISO_SUFFIX}` in (value as object)))
      out[`${key}${ISO_SUFFIX}`] = toIso(v as number)
  }
  return out as T
}
