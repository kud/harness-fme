import {
  GUID_RE,
  failure,
  withContext,
  type FmeClient,
  type FmeResult,
} from "./client.js"
import { collectAll } from "./pagination.js"
import {
  type Environment,
  type Page,
  type RolloutStatus,
  type Workspace,
} from "./types.js"

export const listWorkspaces = async (
  client: FmeClient,
  { limit = 20, offset = 0 }: { limit?: number; offset?: number } = {},
) =>
  withContext(
    await client.request<Page<Workspace>>(
      `/workspaces?size=${limit}&offset=${offset}`,
    ),
    "failed to fetch workspaces",
  )

// The API answers with a bare array; some deployments wrap it in `objects`.
const asArray = <T>(data: T[] | { objects?: T[] }): T[] =>
  Array.isArray(data) ? data : (data.objects ?? [])

export const listEnvironments = async (
  client: FmeClient,
  { workspaceId }: { workspaceId: string },
): Promise<FmeResult<unknown>> =>
  withContext(
    await client.request<unknown>(`/environments/ws/${workspaceId}`),
    "failed to fetch environments",
  )

export const getEnvironments = async (
  client: FmeClient,
  { workspaceId }: { workspaceId: string },
): Promise<FmeResult<Environment[]>> => {
  const result = await client.request<
    Environment[] | { objects?: Environment[] }
  >(`/environments/ws/${workspaceId}`)
  return result.ok
    ? { ok: true, data: asArray(result.data) }
    : withContext(result, "failed to fetch environments")
}

export const listTrafficTypes = async (
  client: FmeClient,
  { workspaceId }: { workspaceId: string },
) =>
  withContext(
    await client.request<{ objects: unknown[] }>(
      `/trafficTypes/ws/${workspaceId}`,
    ),
    "failed to fetch traffic types",
  )

export const listRolloutStatuses = async (
  client: FmeClient,
  { workspaceId }: { workspaceId: string },
) =>
  withContext(
    await client.request<RolloutStatus[] | { objects?: RolloutStatus[] }>(
      `/rolloutStatuses/ws/${workspaceId}`,
    ),
    "failed to fetch rollout statuses",
  )

export const getAllWorkspaces = (client: FmeClient) =>
  collectAll<Workspace>(async (offset, limit) =>
    listWorkspaces(client, { limit, offset }),
  )

// Resolve a workspace by id or name. With no reference, the account's only
// workspace is used; several workspaces is an error that names them all.
export const resolveWorkspace = async (
  client: FmeClient,
  reference?: string,
): Promise<FmeResult<Workspace>> => {
  const all = await getAllWorkspaces(client)
  if (!all.ok) return all
  const workspaces = all.data
  if (!reference) {
    if (workspaces.length === 1) return { ok: true, data: workspaces[0] }
    return failure(
      workspaces.length === 0
        ? "no workspace found for this API key"
        : `several workspaces found, pick one. Available: ${workspaces
            .map((w) => w.name)
            .join(", ")}`,
    )
  }
  const found = workspaces.find(
    (w) =>
      w.id === reference ||
      w.name === reference ||
      w.name.toLowerCase() === reference.toLowerCase(),
  )
  if (!found)
    return failure(
      `workspace not found: ${reference}. Available: ${
        workspaces.map((w) => w.name).join(", ") || "none"
      }`,
    )
  return { ok: true, data: found }
}

// Resolve an environment by id or name (name matching ignores case). A bare
// GUID passes through without a lookup only when the caller does not need the
// name; `resolveEnvironment` always looks the environment up so safety checks
// can see its real name.
export const resolveEnvironment = async (
  client: FmeClient,
  workspaceId: string,
  reference: string,
): Promise<FmeResult<Environment>> => {
  const result = await getEnvironments(client, { workspaceId })
  if (!result.ok) return result
  const found = result.data.find(
    (e) =>
      e.id === reference ||
      e.name === reference ||
      e.name.toLowerCase() === reference.toLowerCase(),
  )
  if (!found)
    return failure(
      `environment not found: ${reference}. Available: ${
        result.data.map((e) => e.name).join(", ") || "none"
      }`,
    )
  return { ok: true, data: found }
}

// Id-or-name reference helpers for callers that only need the id.
export const resolveEnvironmentId = async (
  client: FmeClient,
  workspaceId: string,
  reference: string,
): Promise<{ id: string } | { error: string }> => {
  if (GUID_RE.test(reference)) return { id: reference }
  const result = await getEnvironments(client, { workspaceId })
  if (!result.ok)
    return { error: `failed to resolve environment (${result.message})` }
  const env = result.data.find(
    (e) => e.id === reference || e.name === reference,
  )
  if (!env)
    return {
      error: `environment not found: ${reference}. Available: ${
        result.data.map((e) => e.name).join(", ") || "none"
      }`,
    }
  return { id: env.id }
}
