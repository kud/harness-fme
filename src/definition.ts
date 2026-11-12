import { type Bucket, type FlagDefinition, type Treatment } from "./types.js"

// Fields the API stamps on every read; they change without anyone editing the
// flag, so they never count as a difference.
const VOLATILE_FIELDS = new Set([
  "lastUpdateTime",
  "changeNumber",
  "lastTrafficReceivedAt",
  "lastUpdated",
])

// The fields a definition write carries. Sending exactly these (plus title and
// comment) keeps a read-modify-write from echoing back read-only fields.
export const WRITABLE_FIELDS = [
  "treatments",
  "defaultTreatment",
  "baselineTreatment",
  "rules",
  "defaultRule",
  "trafficAllocation",
] as const

export type DiffEntry = { path: string; before: unknown; after: unknown }

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v)

export const diffValues = (
  before: unknown,
  after: unknown,
  path = "",
): DiffEntry[] => {
  if (Array.isArray(before) && Array.isArray(after)) {
    const entries: DiffEntry[] = []
    const length = Math.max(before.length, after.length)
    for (let i = 0; i < length; i++)
      entries.push(...diffValues(before[i], after[i], `${path}[${i}]`))
    return entries
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const entries: DiffEntry[] = []
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    for (const key of keys.sort())
      entries.push(
        ...diffValues(before[key], after[key], path ? `${path}.${key}` : key),
      )
    return entries
  }
  return Object.is(before, after) ? [] : [{ path, before, after }]
}

// Order-insensitive membership lists, no empty lists, no volatile stamps: two
// definitions that mean the same thing compare equal.
export const normaliseDefinition = (
  def: Record<string, unknown>,
): Record<string, unknown> => {
  const copy = structuredClone(def)
  for (const field of VOLATILE_FIELDS) delete copy[field]
  const treatments = copy.treatments
  if (Array.isArray(treatments))
    for (const t of treatments as Record<string, unknown>[]) {
      for (const list of ["keys", "segments"] as const) {
        const value = t[list]
        if (Array.isArray(value)) {
          if (value.length === 0) delete t[list]
          else t[list] = [...value].sort()
        }
      }
    }
  return copy
}

export const writableView = (def: FlagDefinition): Record<string, unknown> => {
  const view: Record<string, unknown> = {}
  for (const field of WRITABLE_FIELDS)
    if (def[field] !== undefined) view[field] = def[field]
  return normaliseDefinition(view)
}

export const otherView = (def: FlagDefinition): Record<string, unknown> => {
  const view: Record<string, unknown> = {}
  const writable = new Set<string>(WRITABLE_FIELDS)
  for (const [key, value] of Object.entries(def))
    if (!writable.has(key)) view[key] = value
  return normaliseDefinition(view)
}

export const buildWriteBody = (
  def: FlagDefinition,
  { title, comment }: { title: string; comment: string },
) => {
  const body: Record<string, unknown> = {}
  for (const field of WRITABLE_FIELDS)
    if (def[field] !== undefined) body[field] = def[field]
  return { ...body, title, comment }
}

// ─── Reading a definition ───

export const describeDefaultRule = (def: FlagDefinition): string =>
  Array.isArray(def.defaultRule) && def.defaultRule.length > 0
    ? def.defaultRule.map((b) => `${b.treatment} ${b.size}%`).join(" / ")
    : "none"

export const isFullyServing = (
  def: FlagDefinition,
  treatment = "on",
): boolean =>
  Array.isArray(def.defaultRule) &&
  def.defaultRule.some(
    (b: Bucket) => b.treatment === treatment && Number(b.size) === 100,
  )

export type RolloutState = "killed" | "on" | "off" | "partial" | "unknown"

// A coarse read of what the default rule does for everyone no targeting rule
// catches. `killed` wins over everything: a killed flag serves its default
// treatment whatever its rules say.
export const classifyRollout = (
  def: FlagDefinition,
  { on = "on", off = "off" }: { on?: string; off?: string } = {},
): RolloutState => {
  if (def.killed) return "killed"
  if (isFullyServing(def, on)) return "on"
  if (isFullyServing(def, off)) return "off"
  return Array.isArray(def.defaultRule) && def.defaultRule.length > 0
    ? "partial"
    : "unknown"
}

export const findTreatment = (
  def: FlagDefinition,
  name: string,
): Treatment | undefined => def.treatments?.find((t) => t.name === name)

// ─── Pure edits. Each returns a modified copy and never touches its input. ───

export const withTreatmentKey = (
  def: FlagDefinition,
  treatment: string,
  key: string,
): FlagDefinition => {
  const next = structuredClone(def)
  const target = findTreatment(next, treatment)
  if (target)
    target.keys = [
      ...new Set([...(Array.isArray(target.keys) ? target.keys : []), key]),
    ]
  return next
}

export const withoutTreatmentKey = (
  def: FlagDefinition,
  treatment: string,
  key: string,
): FlagDefinition => {
  const next = structuredClone(def)
  const target = findTreatment(next, treatment)
  if (target && Array.isArray(target.keys)) {
    target.keys = target.keys.filter((k) => k !== key)
    if (target.keys.length === 0) delete target.keys
  }
  return next
}

export const withTreatmentSegment = (
  def: FlagDefinition,
  treatment: string,
  segment: string,
): FlagDefinition => {
  const next = structuredClone(def)
  const target = findTreatment(next, treatment)
  if (target)
    target.segments = [
      ...new Set([
        ...(Array.isArray(target.segments) ? target.segments : []),
        segment,
      ]),
    ]
  return next
}

export const withoutTreatmentSegment = (
  def: FlagDefinition,
  treatment: string,
  segment: string,
): FlagDefinition => {
  const next = structuredClone(def)
  const target = findTreatment(next, treatment)
  if (target && Array.isArray(target.segments)) {
    target.segments = target.segments.filter((s) => s !== segment)
    if (target.segments.length === 0) delete target.segments
  }
  return next
}

export const withDefaultRule = (
  def: FlagDefinition,
  buckets: Bucket[],
): FlagDefinition => {
  const next = structuredClone(def)
  next.defaultRule = buckets
  return next
}
