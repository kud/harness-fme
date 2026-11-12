import {
  failure,
  withContext,
  type FmeClient,
  type FmeResult,
} from "./client.js"
import { collectAll } from "./pagination.js"
import {
  type FeatureFlag,
  type FlagDefinition,
  type FlagEnvRef,
  type FlagRef,
  type Page,
} from "./types.js"

const flattenTrafficType = (item: Record<string, unknown>): void => {
  const tt = item.trafficType
  if (tt && typeof tt === "object" && !Array.isArray(tt)) {
    const ttRecord = tt as Record<string, unknown>
    if (ttRecord.id !== undefined && item.trafficTypeId === undefined) {
      item.trafficTypeId = ttRecord.id
    }
  }
}

export type ListFlagsParams = {
  workspaceId: string
  limit?: number
  offset?: number
  tag?: string
  rolloutStatusId?: string
  name?: string
}

// The API reads the page size from `limit`. Sending `size` instead is
// ignored, so every page silently came back at the default of 20 and a
// workspace of ~1,000 flags took 50 round-trips instead of 20.
export const listFeatureFlags = async (
  client: FmeClient,
  {
    workspaceId,
    limit = 20,
    offset = 0,
    tag,
    rolloutStatusId,
    name,
  }: ListFlagsParams,
): Promise<FmeResult<Page<FeatureFlag>>> => {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
    ...(tag ? { tag } : {}),
    ...(rolloutStatusId ? { rolloutStatus: rolloutStatusId } : {}),
    ...(name ? { name } : {}),
  })
  const result = await client.request<Page<FeatureFlag>>(
    `/splits/ws/${encodeURIComponent(workspaceId)}?${query}`,
  )
  if (!result.ok) return withContext(result, "failed to fetch feature flags")
  for (const item of result.data.objects ?? []) {
    if (item && typeof item === "object")
      flattenTrafficType(item as Record<string, unknown>)
  }
  return result
}

export type ListAllFlagsParams = Omit<ListFlagsParams, "limit" | "offset"> & {
  pageSize?: number
}

// Every flag matching the filters, paged to the end at the API's maximum page
// size.
export const listAllFeatureFlags = (
  client: FmeClient,
  { pageSize, ...params }: ListAllFlagsParams,
) =>
  collectAll<FeatureFlag>(
    (offset, limit) => listFeatureFlags(client, { ...params, limit, offset }),
    { pageSize },
  )

export const getFeatureFlag = async (
  client: FmeClient,
  { workspaceId, flagName }: FlagRef,
): Promise<FmeResult<FeatureFlag>> => {
  const result = await client.request<FeatureFlag>(
    `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(flagName)}`,
  )
  if (!result.ok)
    return withContext(result, `failed to fetch feature flag: ${flagName}`)
  flattenTrafficType(result.data)
  return result
}

export const getFlagDefinition = async (
  client: FmeClient,
  { workspaceId, environmentId, flagName }: FlagEnvRef,
): Promise<FmeResult<FlagDefinition>> =>
  withContext(
    await client.request<FlagDefinition>(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(flagName)}/environments/${encodeURIComponent(environmentId)}`,
    ),
    `failed to fetch flag definition: ${flagName}`,
  )

export const killFeatureFlag = async (
  client: FmeClient,
  { workspaceId, environmentId, flagName }: FlagEnvRef,
) =>
  withContext(
    await client.request<unknown>(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(flagName)}/environments/${encodeURIComponent(environmentId)}/kill`,
      { method: "PUT" },
    ),
    `failed to kill feature flag: ${flagName}`,
  )

export const restoreFeatureFlag = async (
  client: FmeClient,
  { workspaceId, environmentId, flagName }: FlagEnvRef,
) =>
  withContext(
    await client.request<unknown>(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(flagName)}/environments/${encodeURIComponent(environmentId)}/restore`,
      { method: "PUT" },
    ),
    `failed to restore feature flag: ${flagName}`,
  )

export const createFeatureFlag = async (
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
      `/splits/ws/${encodeURIComponent(workspaceId)}/trafficTypes/${encodeURIComponent(trafficType)}`,
      {
        method: "POST",
        body: { name, ...(description ? { description } : {}) },
      },
    ),
    `failed to create feature flag: ${name}`,
  )

export const updateFeatureFlag = async (
  client: FmeClient,
  {
    workspaceId,
    flagName,
    description,
    tags,
    owners,
    rolloutStatusId,
  }: FlagRef & {
    description?: string
    tags?: Array<{ name: string } | string>
    owners?: Array<{ id: string; type: string }>
    rolloutStatusId?: string
  },
) => {
  const ops: Array<{ op: string; path: string; value: unknown }> = []
  if (description !== undefined)
    ops.push({ op: "replace", path: "/description", value: description })
  if (tags !== undefined)
    ops.push({
      op: "replace",
      path: "/tags",
      value: tags.map((t) => (typeof t === "string" ? { name: t } : t)),
    })
  if (owners !== undefined)
    ops.push({ op: "replace", path: "/owners", value: owners })
  if (rolloutStatusId !== undefined)
    ops.push({
      op: "replace",
      path: "/rolloutStatus/id",
      value: rolloutStatusId,
    })
  if (ops.length === 0) return failure("provide at least one field to update")
  return withContext(
    await client.request<unknown>(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(flagName)}`,
      {
        method: "PATCH",
        body: ops,
      },
    ),
    `failed to update feature flag: ${flagName}`,
  )
}

export const deleteFeatureFlag = async (
  client: FmeClient,
  { workspaceId, flagName }: FlagRef,
) => {
  const result = await client.request<undefined>(
    `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(flagName)}`,
    { method: "DELETE", expectBody: false },
  )
  return result.ok
    ? ({ ok: true, data: { deleted: flagName } } as const)
    : withContext(result, `failed to delete feature flag: ${flagName}`)
}

export const archiveFeatureFlag = async (
  client: FmeClient,
  { workspaceId, flagName }: FlagRef,
) =>
  withContext(
    await client.request<unknown>(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(flagName)}/archive`,
      { method: "POST" },
    ),
    `failed to archive feature flag: ${flagName}`,
  )

export const unarchiveFeatureFlag = async (
  client: FmeClient,
  { workspaceId, flagName }: FlagRef,
) =>
  withContext(
    await client.request<unknown>(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(flagName)}/unarchive`,
      { method: "POST" },
    ),
    `failed to unarchive feature flag: ${flagName}`,
  )

// ─── Definitions ───

export const listFlagDefinitions = async (
  client: FmeClient,
  {
    workspaceId,
    environmentId,
    limit = 20,
    offset = 0,
  }: {
    workspaceId: string
    environmentId: string
    limit?: number
    offset?: number
  },
): Promise<FmeResult<Page<FlagDefinition>>> => {
  const query = new URLSearchParams({
    limit: String(limit),
    offset: String(offset),
  })
  // Split.io serves feature flag *definitions* from the /splits path (not a
  // /splitDefinitions resource): GET /splits/ws/{ws}/environments/{env}
  // https://docs.split.io/reference/list-feature-flag-definitions-in-environment
  return withContext(
    await client.request<Page<FlagDefinition>>(
      `/splits/ws/${encodeURIComponent(workspaceId)}/environments/${encodeURIComponent(environmentId)}?${query}`,
    ),
    "failed to fetch flag definitions",
  )
}

export const listAllFlagDefinitions = (
  client: FmeClient,
  {
    workspaceId,
    environmentId,
    pageSize,
  }: { workspaceId: string; environmentId: string; pageSize?: number },
) =>
  collectAll<FlagDefinition>(
    (offset, limit) =>
      listFlagDefinitions(client, {
        workspaceId,
        environmentId,
        limit,
        offset,
      }),
    { pageSize },
  )

const parseDefinition = (definition: string): unknown => {
  try {
    return JSON.parse(definition)
  } catch {
    return null
  }
}

// Merge optional top-level title/comment into a definition body. Workspaces
// with `requiresTitleAndComments: true` reject writes without them. Fails loud
// when title/comment are supplied but the definition is not a mergeable
// object (e.g. a JSON array), rather than silently dropping them.
export const withTitleComment = (
  parsed: unknown,
  title?: string,
  comment?: string,
): { body: unknown } | { error: string } => {
  if (!title && !comment) return { body: parsed }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { error: "definition must be a JSON object to attach title/comment" }
  return {
    body: {
      ...(parsed as Record<string, unknown>),
      ...(title ? { title } : {}),
      ...(comment ? { comment } : {}),
    },
  }
}

export type WriteDefinitionParams = FlagEnvRef & {
  // A JSON string, as the MCP tool receives it.
  definition: string
  title?: string
  comment?: string
}

const writeDefinition = async (
  client: FmeClient,
  method: "POST" | "PUT",
  verb: string,
  {
    workspaceId,
    environmentId,
    flagName,
    definition,
    title,
    comment,
  }: WriteDefinitionParams,
) => {
  const parsed = parseDefinition(definition)
  if (!parsed) return failure("definition must be valid JSON")
  const merged = withTitleComment(parsed, title, comment)
  if ("error" in merged) return failure(merged.error)
  return withContext(
    await client.request<unknown>(
      `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(flagName)}/environments/${encodeURIComponent(environmentId)}`,
      { method, body: merged.body },
    ),
    `failed to ${verb} flag definition for: ${flagName}`,
  )
}

export const createFlagDefinition = (
  client: FmeClient,
  params: WriteDefinitionParams,
) => writeDefinition(client, "POST", "create", params)

export const updateFlagDefinition = (
  client: FmeClient,
  params: WriteDefinitionParams,
) => writeDefinition(client, "PUT", "update", params)

// Add a segment to a named treatment via read-modify-write, instead of a full
// definition replace where a dropped field silently wipes existing targeting.
// treatments[].segments is a plain string array of segment names. Idempotent:
// if the segment is already present, it returns unchanged without writing.
export const addSegmentToTreatment = async (
  client: FmeClient,
  {
    workspaceId,
    environmentId,
    flagName,
    treatment,
    segment,
    title,
    comment,
  }: FlagEnvRef & {
    treatment: string
    segment: string
    title?: string
    comment?: string
  },
): Promise<FmeResult<{ unchanged: true; message: string } | unknown>> => {
  const path = `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(flagName)}/environments/${encodeURIComponent(environmentId)}`
  const current = await client.request<Record<string, unknown>>(path)
  if (!current.ok)
    return withContext(current, `failed to fetch flag definition: ${flagName}`)
  const def = current.data
  const treatments = def.treatments as
    { name: string; segments?: string[] }[] | undefined
  const target = treatments?.find((t) => t.name === treatment)
  if (!target)
    return failure(
      `treatment "${treatment}" not found on ${flagName}. Available: ${
        treatments?.map((t) => t.name).join(", ") || "none"
      }`,
    )
  const segments = target.segments ?? []
  if (segments.includes(segment))
    return {
      ok: true,
      data: {
        unchanged: true,
        message: `segment "${segment}" already on treatment "${treatment}"`,
      },
    }
  target.segments = [...segments, segment]

  const merged = withTitleComment(def, title, comment)
  if ("error" in merged) return failure(merged.error)
  return withContext(
    await client.request<unknown>(path, { method: "PUT", body: merged.body }),
    `failed to add segment to treatment on ${flagName}`,
  )
}

export const deleteFlagDefinition = async (
  client: FmeClient,
  { workspaceId, environmentId, flagName }: FlagEnvRef,
) => {
  const result = await client.request<undefined>(
    `/splits/ws/${encodeURIComponent(workspaceId)}/${encodeURIComponent(flagName)}/environments/${encodeURIComponent(environmentId)}`,
    { method: "DELETE", expectBody: false },
  )
  return result.ok
    ? ({
        ok: true,
        data: { deleted: flagName, environment: environmentId },
      } as const)
    : withContext(result, `failed to delete flag definition: ${flagName}`)
}
