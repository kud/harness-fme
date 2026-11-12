import { failure, withContext, type FmeClient } from "./client.js"
import { type Page } from "./types.js"

type Paging = { limit?: number; offset?: number }

const paging = ({ limit = 20, offset = 0 }: Paging) =>
  new URLSearchParams({ size: String(limit), offset: String(offset) })

const deleted = async (
  client: FmeClient,
  path: string,
  context: string,
  payload: Record<string, unknown>,
) => {
  const result = await client.request<undefined>(path, {
    method: "DELETE",
    expectBody: false,
  })
  return result.ok
    ? ({ ok: true, data: payload } as const)
    : withContext(result, context)
}

// ─── Classic segments ───

export const listSegments = async (
  client: FmeClient,
  { workspaceId, ...page }: { workspaceId: string } & Paging,
) =>
  withContext(
    await client.request<Page<unknown>>(
      `/segments/ws/${workspaceId}?${paging(page)}`,
    ),
    "failed to fetch segments",
  )

export const listSegmentDefinitions = async (
  client: FmeClient,
  {
    workspaceId,
    environmentId,
    ...page
  }: { workspaceId: string; environmentId: string } & Paging,
) =>
  withContext(
    await client.request<Page<unknown>>(
      `/segments/ws/${workspaceId}/environments/${environmentId}?${paging(page)}`,
    ),
    "failed to fetch segment definitions",
  )

// Reads a classic segment's member keys in an environment: the one thing
// list_segments/list_segment_definitions can't answer, whether a given person
// is already in this segment. No workspace id: the API scopes this endpoint by
// environment + segment name only, same as the rule-based segment definition
// endpoints.
export const listSegmentKeys = async (
  client: FmeClient,
  {
    environmentId,
    segmentName,
    ...page
  }: { environmentId: string; segmentName: string } & Paging,
) =>
  withContext(
    await client.request<{ keys: { key: string }[]; count: number }>(
      `/segments/${environmentId}/${segmentName}/keys?${paging(page)}`,
    ),
    `failed to fetch segment keys: ${segmentName}`,
  )

export const createSegment = async (
  client: FmeClient,
  {
    workspaceId,
    trafficType,
    name,
    description,
    owners,
  }: {
    workspaceId: string
    trafficType: string
    name: string
    description?: string
    owners?: Array<{ id: string; type: string }>
  },
) =>
  withContext(
    await client.request<unknown>(
      `/segments/ws/${workspaceId}/trafficTypes/${trafficType}`,
      {
        method: "POST",
        body: {
          name,
          ...(description ? { description } : {}),
          ...(owners ? { owners } : {}),
        },
      },
    ),
    `failed to create segment: ${name}`,
  )

export const enableSegmentInEnvironment = async (
  client: FmeClient,
  {
    environmentId,
    segmentName,
  }: { environmentId: string; segmentName: string },
) =>
  withContext(
    await client.request<unknown>(`/segments/${environmentId}/${segmentName}`, {
      method: "POST",
      body: {},
    }),
    `failed to enable segment: ${segmentName}`,
  )

// Harness FME caps a single uploadKeys call at 10,000 keys and a segment's
// total membership at 100,000. The per-call cap is checked here so an
// oversized batch fails with a clear message instead of an opaque API
// rejection; the total-membership cap isn't checkable without an extra
// round-trip to count existing members, so it isn't enforced client-side.
export const MAX_SEGMENT_KEYS_PER_CALL = 10000

const segmentKeysBody = (keys: string[], title?: string, comment?: string) => ({
  keys,
  ...(title ? { title } : {}),
  ...(comment ? { comment } : {}),
})

export const addSegmentKeys = async (
  client: FmeClient,
  {
    environmentId,
    segmentName,
    keys,
    replace,
    title,
    comment,
  }: {
    environmentId: string
    segmentName: string
    keys: string[]
    replace?: boolean
    title?: string
    comment?: string
  },
) => {
  if (keys.length === 0) return failure("keys must be a non-empty array")
  if (keys.length > MAX_SEGMENT_KEYS_PER_CALL)
    return failure(
      `too many keys: ${keys.length} exceeds the Harness FME limit of ${MAX_SEGMENT_KEYS_PER_CALL} per call — split into multiple calls`,
    )
  const query = new URLSearchParams({ replace: String(Boolean(replace)) })
  return withContext(
    await client.request<unknown>(
      `/segments/${environmentId}/${segmentName}/uploadKeys?${query}`,
      { method: "PUT", body: segmentKeysBody(keys, title, comment) },
    ),
    `failed to add keys to segment: ${segmentName}`,
  )
}

export const removeSegmentKeys = async (
  client: FmeClient,
  {
    environmentId,
    segmentName,
    keys,
    title,
    comment,
  }: {
    environmentId: string
    segmentName: string
    keys: string[]
    title?: string
    comment?: string
  },
) => {
  if (keys.length === 0) return failure("keys must be a non-empty array")
  return withContext(
    await client.request<unknown>(
      `/segments/${environmentId}/${segmentName}/removeKeys`,
      { method: "PUT", body: segmentKeysBody(keys, title, comment) },
    ),
    `failed to remove keys from segment: ${segmentName}`,
  )
}

export const disableSegmentInEnvironment = (
  client: FmeClient,
  {
    environmentId,
    segmentName,
  }: { environmentId: string; segmentName: string },
) =>
  deleted(
    client,
    `/segments/${environmentId}/${segmentName}`,
    `failed to disable segment: ${segmentName}`,
    { disabled: segmentName, environment: environmentId },
  )

export const deleteSegment = (
  client: FmeClient,
  { workspaceId, segmentName }: { workspaceId: string; segmentName: string },
) =>
  deleted(
    client,
    `/segments/ws/${workspaceId}/${segmentName}`,
    `failed to delete segment: ${segmentName}`,
    { deleted: segmentName },
  )

// ─── Rule-based segments ───

export const listRuleBasedSegments = async (
  client: FmeClient,
  { workspaceId, ...page }: { workspaceId: string } & Paging,
) =>
  withContext(
    await client.request<unknown>(
      `/rule-based-segments/ws/${workspaceId}?${paging(page)}`,
    ),
    "failed to fetch rule-based segments",
  )

export const getRuleBasedSegment = async (
  client: FmeClient,
  { workspaceId, segmentName }: { workspaceId: string; segmentName: string },
) =>
  withContext(
    await client.request<unknown>(
      `/rule-based-segments/ws/${workspaceId}/${segmentName}`,
    ),
    `failed to fetch rule-based segment: ${segmentName}`,
  )

export const createRuleBasedSegment = async (
  client: FmeClient,
  {
    workspaceId,
    trafficType,
    name,
    description,
  }: {
    workspaceId: string
    trafficType: string
    name: string
    description?: string
  },
) =>
  withContext(
    await client.request<unknown>(
      `/rule-based-segments/ws/${workspaceId}/trafficTypes/${trafficType}`,
      {
        method: "POST",
        body: { name, ...(description ? { description } : {}) },
      },
    ),
    `failed to create rule-based segment: ${name}`,
  )

export const deleteRuleBasedSegment = (
  client: FmeClient,
  { workspaceId, segmentName }: { workspaceId: string; segmentName: string },
) =>
  deleted(
    client,
    `/rule-based-segments/ws/${workspaceId}/${segmentName}`,
    `failed to delete rule-based segment: ${segmentName}`,
    { deleted: segmentName },
  )

export const listRuleBasedSegmentDefinitions = async (
  client: FmeClient,
  {
    workspaceId,
    environmentId,
  }: { workspaceId: string; environmentId: string },
) =>
  withContext(
    await client.request<unknown>(
      `/rule-based-segments/ws/${workspaceId}/environments/${environmentId}`,
    ),
    "failed to fetch rule-based segment definitions",
  )

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const updateRuleBasedSegmentDefinition = async (
  client: FmeClient,
  {
    workspaceId,
    environmentId,
    segmentName,
    definition,
  }: {
    workspaceId: string
    environmentId: string
    segmentName: string
    // A JSON string, as the MCP tool receives it.
    definition: string
  },
) => {
  const parsed = parseJson(definition)
  if (!parsed) return failure("definition must be valid JSON")
  return withContext(
    await client.request<unknown>(
      `/rule-based-segments/ws/${workspaceId}/${segmentName}/environments/${environmentId}`,
      { method: "PUT", body: parsed },
    ),
    `failed to update rule-based segment definition for: ${segmentName}`,
  )
}

export const enableRuleBasedSegmentDefinition = async (
  client: FmeClient,
  {
    environmentId,
    segmentName,
  }: { environmentId: string; segmentName: string },
) =>
  withContext(
    await client.request<unknown>(
      `/rule-based-segments/${environmentId}/${segmentName}`,
      { method: "POST", body: {} },
    ),
    `failed to enable rule-based segment: ${segmentName}`,
  )

export const disableRuleBasedSegmentDefinition = (
  client: FmeClient,
  {
    environmentId,
    segmentName,
  }: { environmentId: string; segmentName: string },
) =>
  deleted(
    client,
    `/rule-based-segments/${environmentId}/${segmentName}`,
    `failed to disable rule-based segment: ${segmentName}`,
    { disabled: segmentName, environment: environmentId },
  )

export const createRuleBasedSegmentChangeRequest = async (
  client: FmeClient,
  {
    workspaceId,
    environmentId,
    title,
    operationType,
    ruleBasedSegment,
    comment,
    approvers,
  }: {
    workspaceId: string
    environmentId: string
    title: string
    operationType: string
    // A JSON string, as the MCP tool receives it.
    ruleBasedSegment: string
    comment?: string
    approvers?: string[]
  },
) => {
  const parsed = parseJson(ruleBasedSegment)
  if (!parsed) return failure("rule_based_segment must be valid JSON")
  return withContext(
    await client.request<unknown>(
      `/changeRequests/ws/${workspaceId}/environments/${environmentId}`,
      {
        method: "POST",
        body: {
          title,
          operationType,
          ruleBasedSegment: parsed,
          ...(comment ? { comment } : {}),
          ...(approvers ? { approvers } : {}),
        },
      },
    ),
    "failed to create change request",
  )
}
