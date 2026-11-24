import { type FmeClient, type FmeResult } from "./client.js"
import {
  classifyRollout,
  describeDefaultRule,
  normaliseDefinition,
  type RolloutState,
} from "./definition.js"
import { getFlagDefinition } from "./flags.js"
import { toIso } from "./time.js"
import { type Bucket, type Environment, type FlagDefinition } from "./types.js"
import { getEnvironments } from "./workspaces.js"

// The parts of a definition that decide what a user is served. These are the
// fields a comparison looks at; stamps such as lastUpdateTime are shown but
// never count as a difference.
export const COMPARED_FIELDS = [
  "defined",
  "killed",
  "defaultTreatment",
  "defaultRule",
  "trafficAllocation",
  "treatments",
  "rules",
] as const

export type ComparedField = (typeof COMPARED_FIELDS)[number]

export type TreatmentSummary = {
  name: string
  keys: number
  segments: string[]
}

export type EnvironmentDefinition = {
  environment: string
  environmentId: string
  defined: boolean
  state: RolloutState | "undefined"
  killed: boolean | null
  defaultTreatment: string | null
  defaultRule: Bucket[]
  defaultRuleText: string
  trafficAllocation: number | null
  treatments: TreatmentSummary[]
  rules: unknown[]
  changeNumber: number | null
  lastUpdateTime: number | null
  lastUpdateTimeIso: string | null
  // The untouched definition, for callers that need more than the summary.
  definition?: FlagDefinition
}

export type FlagComparison = {
  flag: string
  environments: EnvironmentDefinition[]
  // The compared fields whose value is not the same in every environment.
  differences: ComparedField[]
}

const summariseTreatments = (def: FlagDefinition): TreatmentSummary[] =>
  (def.treatments ?? []).map((t) => ({
    name: t.name,
    keys: Array.isArray(t.keys) ? t.keys.length : 0,
    segments: Array.isArray(t.segments) ? [...t.segments].sort() : [],
  }))

export const summariseDefinition = (
  environment: Pick<Environment, "id" | "name">,
  def: FlagDefinition | undefined,
): EnvironmentDefinition => {
  if (!def)
    return {
      environment: environment.name,
      environmentId: environment.id,
      defined: false,
      state: "undefined",
      killed: null,
      defaultTreatment: null,
      defaultRule: [],
      defaultRuleText: "none",
      trafficAllocation: null,
      treatments: [],
      rules: [],
      changeNumber: null,
      lastUpdateTime: null,
      lastUpdateTimeIso: null,
    }
  const lastUpdateTime =
    typeof def.lastUpdateTime === "number" ? def.lastUpdateTime : null
  return {
    environment: environment.name,
    environmentId: environment.id,
    defined: true,
    state: classifyRollout(def),
    killed: Boolean(def.killed),
    defaultTreatment: def.defaultTreatment ?? null,
    defaultRule: Array.isArray(def.defaultRule) ? def.defaultRule : [],
    defaultRuleText: describeDefaultRule(def),
    trafficAllocation:
      typeof def.trafficAllocation === "number" ? def.trafficAllocation : null,
    treatments: summariseTreatments(def),
    rules: Array.isArray(def.rules) ? def.rules : [],
    changeNumber:
      typeof def.changeNumber === "number" ? def.changeNumber : null,
    lastUpdateTime,
    lastUpdateTimeIso: lastUpdateTime === null ? null : toIso(lastUpdateTime),
    definition: def,
  }
}

// The value a field is compared on. Treatments are compared on their full,
// order-insensitive membership (two environments with three keys each but not
// the same three keys differ), not only on the counts the summary shows.
const comparable = (view: EnvironmentDefinition, field: ComparedField) => {
  if (field === "defined") return view.defined
  if (!view.definition) return null
  const normalised = normaliseDefinition(view.definition)
  if (field === "killed") return Boolean(normalised.killed)
  if (field === "rules") return normalised.rules ?? []
  if (field === "treatments") {
    const treatments = (normalised.treatments ?? []) as {
      name: string
    }[]
    return [...treatments].sort((a, b) => a.name.localeCompare(b.name))
  }
  return normalised[field] ?? null
}

// Fields that are not the same across every environment. An environment where
// the flag is not defined differs on `defined` only; its other fields are not
// compared, so a single missing environment does not light up every row.
export const differingFields = (
  views: EnvironmentDefinition[],
): ComparedField[] => {
  if (views.length < 2) return []
  const differences: ComparedField[] = []
  for (const field of COMPARED_FIELDS) {
    const pool = field === "defined" ? views : views.filter((v) => v.defined)
    const values = new Set(
      pool.map((v) => JSON.stringify(comparable(v, field))),
    )
    if (values.size > 1) differences.push(field)
  }
  return differences
}

export const compareDefinitions = (
  flag: string,
  views: EnvironmentDefinition[],
): FlagComparison => ({
  flag,
  environments: views,
  differences: differingFields(views),
})

// One flag, read in every environment (or the ones given), side by side. A
// flag with no definition in an environment shows there as not defined rather
// than failing the whole comparison.
export const compareFlagEnvironments = async (
  client: FmeClient,
  {
    workspaceId,
    flagName,
    environments,
  }: {
    workspaceId: string
    flagName: string
    environments?: Environment[]
  },
): Promise<FmeResult<FlagComparison>> => {
  let selected = environments
  if (!selected) {
    const all = await getEnvironments(client, { workspaceId })
    if (!all.ok) return all
    selected = all.data
  }
  const views: EnvironmentDefinition[] = []
  for (const environment of selected) {
    const read = await getFlagDefinition(client, {
      workspaceId,
      environmentId: environment.id,
      flagName,
    })
    if (read.ok) views.push(summariseDefinition(environment, read.data))
    else if (read.status === 404)
      views.push(summariseDefinition(environment, undefined))
    else return read
  }
  return { ok: true, data: compareDefinitions(flagName, views) }
}
