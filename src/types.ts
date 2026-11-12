export type Page<T> = { objects: T[]; totalCount?: number }

export type Workspace = {
  id: string
  name: string
  organizationIdentifier?: string
  projectIdentifier?: string
  requiresTitleAndComments?: boolean
  [key: string]: unknown
}

export type Environment = {
  id: string
  name: string
  [key: string]: unknown
}

export type RolloutStatus = {
  id: string
  name: string
  [key: string]: unknown
}

export type FeatureFlag = {
  id?: string
  name: string
  description?: string
  status?: string
  tags?: { name: string }[]
  rolloutStatus?: { id?: string; name?: string }
  trafficType?: { id?: string; name?: string }
  trafficTypeId?: string
  [key: string]: unknown
}

export type Treatment = {
  name: string
  configurations?: string
  description?: string
  keys?: string[]
  segments?: string[]
  [key: string]: unknown
}

export type Bucket = { treatment: string; size: number }

export type FlagDefinition = {
  name?: string
  killed?: boolean
  treatments: Treatment[]
  defaultTreatment: string
  baselineTreatment?: string
  trafficAllocation?: number
  rules?: unknown[]
  defaultRule?: Bucket[]
  lastUpdateTime?: number
  [key: string]: unknown
}

export type FlagRef = { workspaceId: string; flagName: string }

export type FlagEnvRef = FlagRef & { environmentId: string }
