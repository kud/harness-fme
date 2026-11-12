import { type FmeClient, type FmeResult } from "./client.js"
import {
  classifyRollout,
  describeDefaultRule,
  type RolloutState,
} from "./definition.js"
import {
  getFlagDefinition,
  listAllFeatureFlags,
  listAllFlagDefinitions,
  listFeatureFlags,
} from "./flags.js"
import { MAX_PAGE_SIZE } from "./pagination.js"
import {
  type Environment,
  type FeatureFlag,
  type FlagDefinition,
} from "./types.js"

export type FlagFilter = {
  tag?: string
  prefix?: string
  // Archived flags are left out unless asked for.
  includeInactive?: boolean
}

// The API's `name` filter is a partial match; a prefix is narrowed client-side
// from that, so the request stays small without a second round of paging.
export const findFlags = async (
  client: FmeClient,
  workspaceId: string,
  { tag, prefix, includeInactive = false }: FlagFilter = {},
): Promise<FmeResult<FeatureFlag[]>> => {
  const result = await listAllFeatureFlags(client, {
    workspaceId,
    tag,
    ...(prefix ? { name: prefix } : {}),
  })
  if (!result.ok) return result
  return {
    ok: true,
    data: result.data.filter(
      (f) =>
        (!prefix || f.name.startsWith(prefix)) &&
        (includeInactive || !f.status || f.status === "ACTIVE"),
    ),
  }
}

export type EnvironmentView = {
  environment: string
  // Absent when the flag has no definition in this environment.
  definition?: FlagDefinition
  state: RolloutState | "undefined"
  defaultRule: string
}

export type FlagRow = {
  flag: string
  rolloutStatus?: string
  environments: EnvironmentView[]
}

// Reading definitions one flag at a time costs one call per flag; listing the
// whole environment costs one call per 50 flags. Pick whichever is cheaper for
// this selection.
const fetchDefinitions = async (
  client: FmeClient,
  workspaceId: string,
  environment: Environment,
  names: string[],
  totalFlags: number,
): Promise<FmeResult<Map<string, FlagDefinition>>> => {
  const byName = new Map<string, FlagDefinition>()
  const bulkCost = Math.ceil(totalFlags / MAX_PAGE_SIZE)
  if (names.length <= bulkCost) {
    for (const name of names) {
      const read = await getFlagDefinition(client, {
        workspaceId,
        environmentId: environment.id,
        flagName: name,
      })
      if (read.ok) byName.set(name, read.data)
      else if (read.status !== 404) return read
    }
    return { ok: true, data: byName }
  }
  const all = await listAllFlagDefinitions(client, {
    workspaceId,
    environmentId: environment.id,
  })
  if (!all.ok) return all
  for (const def of all.data) if (def.name) byName.set(def.name, def)
  return { ok: true, data: byName }
}

const viewOf = (
  environment: string,
  definition: FlagDefinition | undefined,
): EnvironmentView =>
  definition
    ? {
        environment,
        definition,
        state: classifyRollout(definition),
        defaultRule: describeDefaultRule(definition),
      }
    : { environment, state: "undefined", defaultRule: "none" }

// One row per flag, one view per environment. `totalFlags` is the workspace's
// flag count, used only to choose between per-flag and bulk reads.
export const buildFlagRows = async (
  client: FmeClient,
  {
    workspaceId,
    flags,
    environments,
    totalFlags = flags.length,
  }: {
    workspaceId: string
    flags: FeatureFlag[]
    environments: Environment[]
    totalFlags?: number
  },
): Promise<FmeResult<FlagRow[]>> => {
  const names = flags.map((f) => f.name)
  const perEnvironment = new Map<string, Map<string, FlagDefinition>>()
  for (const environment of environments) {
    const defs = await fetchDefinitions(
      client,
      workspaceId,
      environment,
      names,
      totalFlags,
    )
    if (!defs.ok) return defs
    perEnvironment.set(environment.name, defs.data)
  }
  return {
    ok: true,
    data: flags.map((flag) => ({
      flag: flag.name,
      rolloutStatus: flag.rolloutStatus?.name,
      environments: environments.map((env) =>
        viewOf(env.name, perEnvironment.get(env.name)?.get(flag.name)),
      ),
    })),
  }
}

// The workspace's total flag count, from one tiny page.
export const countFlags = async (
  client: FmeClient,
  workspaceId: string,
): Promise<FmeResult<number>> => {
  const page = await listFeatureFlags(client, { workspaceId, limit: 1 })
  return page.ok
    ? { ok: true, data: page.data.totalCount ?? page.data.objects.length }
    : page
}
