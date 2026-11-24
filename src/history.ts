import { withContext, type FmeClient, type FmeResult } from "./client.js"
import {
  describeDefaultRule,
  diffValues,
  normaliseDefinition,
  type DiffEntry,
} from "./definition.js"
import { toIso } from "./time.js"
import { type FlagDefinition } from "./types.js"

// The admin API has no audit log for flags: the per-environment audit log is
// web-UI only (or pushed out through an audit-log webhook). What the API does
// keep is every change request, each carrying the full definition it proposed:
//   GET /changeRequests?environmentId=&status=&limit=&after=
//   https://developer.harness.io/feature-management-experimentation/split-api-reference/change-requests
// so a flag's history here is its change requests in one environment, each
// diffed against the one before. Changes made without an approval flow never
// become change requests and do not show up.

export const CHANGE_REQUEST_STATUSES = [
  "REQUESTED",
  "SCHEDULE_REQUESTED",
  "APPROVED",
  "REJECTED",
  "WITHDRAWN",
  "PUBLISHED",
] as const

export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number]

export type ChangeRequestComment = {
  comment?: string | null
  user?: string
  role?: string
  timestamp?: number
}

export type ChangeRequest = {
  id: string
  status?: string
  title?: string | null
  comment?: string | null
  requester?: string
  operationType?: string
  approvers?: unknown[]
  comments?: ChangeRequestComment[]
  split?:
    (FlagDefinition & { environment?: { id?: string; name?: string } }) | null
  segment?: unknown
  scheduledFor?: number | null
  [key: string]: unknown
}

export type ChangeRequestPage = {
  data: ChangeRequest[]
  nextMarker?: string | null
  previousMarker?: string | null
}

// The page size the endpoint allows at most.
export const MAX_CHANGE_REQUEST_PAGE = 100

export const listChangeRequests = async (
  client: FmeClient,
  {
    environmentId,
    workspaceId,
    status,
    limit = 20,
    after,
  }: {
    environmentId?: string
    workspaceId?: string
    status?: string
    limit?: number
    after?: string
  },
): Promise<FmeResult<ChangeRequestPage>> => {
  const query = new URLSearchParams({
    ...(environmentId ? { environmentId } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    ...(status ? { status } : {}),
    limit: String(limit),
    ...(after ? { after } : {}),
  })
  const result = await client.request<ChangeRequestPage | ChangeRequest[]>(
    `/changeRequests?${query}`,
  )
  if (!result.ok) return withContext(result, "failed to fetch change requests")
  const data = result.data
  return {
    ok: true,
    data: Array.isArray(data) ? { data } : { ...data, data: data?.data ?? [] },
  }
}

// The fields of a definition that say what users are served; the diff of a
// change is taken over these only.
export const HISTORY_FIELDS = [
  "killed",
  "defaultTreatment",
  "defaultRule",
  "trafficAllocation",
  "treatments",
  "rules",
] as const

export type FlagChange = {
  id: string
  title: string | null
  changeType: string | null
  status: string | null
  editedBy: string | null
  approvers: string[]
  time: number | null
  timeIso: string | null
  comment: string | null
  defaultRuleBefore: string | null
  defaultRuleAfter: string | null
  // Null for the oldest change found: there is nothing older to compare with.
  diff: DiffEntry[] | null
  definition: FlagDefinition | null
}

const personOf = (value: unknown): string | null => {
  if (typeof value === "string") return value
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>
    for (const key of ["name", "email", "id"])
      if (typeof v[key] === "string") return v[key] as string
  }
  return null
}

const timeOf = (cr: ChangeRequest): number | null => {
  const stamps = (cr.comments ?? [])
    .map((c) => c.timestamp)
    .filter((t): t is number => typeof t === "number")
  if (stamps.length > 0) return Math.max(...stamps)
  const updated = cr.split?.lastUpdateTime
  return typeof updated === "number" ? updated : null
}

const servedView = (def: FlagDefinition | null | undefined) => {
  if (!def) return null
  const view: Record<string, unknown> = {}
  for (const field of HISTORY_FIELDS)
    if (def[field] !== undefined) view[field] = def[field]
  return normaliseDefinition(view)
}

// Pure: change requests for one flag, newest first, each with the diff from
// the change before it.
export const buildFlagHistory = (
  changeRequests: ChangeRequest[],
): FlagChange[] => {
  const sorted = [...changeRequests].sort(
    (a, b) => (timeOf(b) ?? 0) - (timeOf(a) ?? 0),
  )
  return sorted.map((cr, i) => {
    const older = sorted[i + 1]
    const def = cr.split ?? null
    const before = older?.split ?? null
    const time = timeOf(cr)
    const approverComments = (cr.comments ?? [])
      .filter((c) => c.role === "APPROVER" && c.user)
      .map((c) => c.user as string)
    const approvers = [
      ...new Set([
        ...(cr.approvers ?? []).map(personOf).filter((p): p is string => !!p),
        ...approverComments,
      ]),
    ]
    const submitter = (cr.comments ?? []).find((c) => c.role === "SUBMITTER")
    return {
      id: cr.id,
      title: cr.title ?? null,
      changeType: cr.operationType ?? null,
      status: cr.status ?? null,
      editedBy: cr.requester ?? submitter?.user ?? null,
      approvers,
      time,
      timeIso: time === null ? null : toIso(time),
      comment: cr.comment ?? submitter?.comment ?? null,
      defaultRuleBefore: before ? describeDefaultRule(before) : null,
      defaultRuleAfter: def ? describeDefaultRule(def) : null,
      diff:
        older && def
          ? diffValues(servedView(before), servedView(def)).filter(
              (e) => e.path !== "",
            )
          : null,
      definition: def,
    }
  })
}

export type FlagHistoryParams = {
  environmentId: string
  flagName: string
  // Defaults to PUBLISHED: the changes that actually reached the flag.
  status?: string
  // How many changes to return at most.
  limit?: number
  // How many change-request pages to read at most while looking for them.
  maxPages?: number
}

// The endpoint cannot filter by flag, so pages are read and filtered here
// until enough changes are found or the pages run out. One more change than
// asked for is kept so the oldest returned one still gets its diff.
export const getFlagHistory = async (
  client: FmeClient,
  {
    environmentId,
    flagName,
    status = "PUBLISHED",
    limit = 20,
    maxPages = 10,
  }: FlagHistoryParams,
): Promise<FmeResult<FlagChange[]>> => {
  const matching: ChangeRequest[] = []
  let after: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const result = await listChangeRequests(client, {
      environmentId,
      status,
      limit: MAX_CHANGE_REQUEST_PAGE,
      after,
    })
    if (!result.ok) return result
    for (const cr of result.data.data)
      if (cr.split?.name === flagName) matching.push(cr)
    if (matching.length > limit) break
    const next = result.data.nextMarker
    if (!next || next === after || result.data.data.length === 0) break
    after = next
  }
  return { ok: true, data: buildFlagHistory(matching).slice(0, limit) }
}
