import {
  describeDefaultRule,
  findTreatment,
  isFullyServing,
  withDefaultRule,
  withTreatmentKey,
  withTreatmentSegment,
  withoutTreatmentKey,
  withoutTreatmentSegment,
} from "./definition.js"
import { diffValues } from "./definition.js"
import { type Bucket, type FlagDefinition } from "./types.js"

export type OperationOutcome =
  | { action: "update"; next: FlagDefinition; summary: string }
  | { action: "skip"; reason: string }

// A pure edit of one flag definition: what to do given its current state, and
// why not when it should be left alone. The same operation is run at plan time
// and again on a fresh read right before the write.
export type FlagOperation = {
  describe: string
  defaultTitle: string
  defaultComment: string
  apply: (def: FlagDefinition) => OperationOutcome
}

const skip = (reason: string): OperationOutcome => ({ action: "skip", reason })

const KILLED = "killed (restore it before changing its rules)"

const missingTreatment = (name: string) => skip(`no treatment named ${name}`)

export const addKeyOperation = ({
  key,
  treatment = "on",
}: {
  key: string
  treatment?: string
}): FlagOperation => ({
  describe: `add key to treatment ${treatment}`,
  defaultTitle: "Add key to treatment",
  defaultComment: `Add an individual key to the ${treatment} treatment.`,
  apply: (def) => {
    if (def.killed) return skip(KILLED)
    const target = findTreatment(def, treatment)
    if (!target) return missingTreatment(treatment)
    if (isFullyServing(def, treatment))
      return skip(`default rule already serves ${treatment} to everyone`)
    if ((target.keys ?? []).includes(key)) return skip("already has the key")
    return {
      action: "update",
      next: withTreatmentKey(def, treatment, key),
      summary: `add key to ${treatment}`,
    }
  },
})

export const removeKeyOperation = ({
  key,
  treatment = "on",
}: {
  key: string
  treatment?: string
}): FlagOperation => ({
  describe: `remove key from treatment ${treatment}`,
  defaultTitle: "Remove key from treatment",
  defaultComment: `Remove an individual key from the ${treatment} treatment.`,
  apply: (def) => {
    const target = findTreatment(def, treatment)
    if (!target) return missingTreatment(treatment)
    if (!(target.keys ?? []).includes(key)) return skip("key not present")
    return {
      action: "update",
      next: withoutTreatmentKey(def, treatment, key),
      summary: `remove key from ${treatment}`,
    }
  },
})

const sameBuckets = (a: Bucket[] | undefined, b: Bucket[]) => {
  const order = (list: Bucket[]) =>
    [...list].sort((x, y) => x.treatment.localeCompare(y.treatment))
  return diffValues(order(a ?? []), order(b)).length === 0
}

export type ToggleNames = { on?: string; off?: string }

export const turnOnOperation = ({
  segment,
  percent,
  on = "on",
  off = "off",
}: ToggleNames & {
  segment?: string
  percent?: number
} = {}): FlagOperation => {
  if (segment !== undefined && percent !== undefined)
    throw new Error("pass either a segment or a percentage, not both")
  if (
    percent !== undefined &&
    (!Number.isInteger(percent) || percent < 1 || percent > 100)
  )
    throw new Error("percent must be a whole number from 1 to 100")
  return {
    describe:
      segment !== undefined
        ? `serve ${on} to segment ${segment}`
        : percent !== undefined && percent < 100
          ? `serve ${on} to ${percent}% by default`
          : `serve ${on} to everyone by default`,
    defaultTitle: "Turn flag on",
    defaultComment:
      segment !== undefined
        ? `Serve ${on} to segment ${segment}.`
        : `Set the default rule to ${on}.`,
    apply: (def) => {
      if (def.killed) return skip(KILLED)
      const target = findTreatment(def, on)
      if (!target) return missingTreatment(on)
      if (segment !== undefined) {
        if ((target.segments ?? []).includes(segment))
          return skip(`segment ${segment} already on ${on}`)
        return {
          action: "update",
          next: withTreatmentSegment(def, on, segment),
          summary: `add segment ${segment} to ${on}`,
        }
      }
      const size = percent ?? 100
      const buckets: Bucket[] =
        size === 100
          ? [{ treatment: on, size: 100 }]
          : [
              { treatment: on, size },
              { treatment: off, size: 100 - size },
            ]
      if (size < 100 && !findTreatment(def, off)) return missingTreatment(off)
      if (sameBuckets(def.defaultRule, buckets))
        return skip(`default rule already ${describeDefaultRule(def)}`)
      return {
        action: "update",
        next: withDefaultRule(def, buckets),
        summary: `default rule ${describeDefaultRule(def)} -> ${buckets
          .map((b) => `${b.treatment} ${b.size}%`)
          .join(" / ")}`,
      }
    },
  }
}

export const turnOffOperation = ({
  segment,
  on = "on",
  off = "off",
}: ToggleNames & { segment?: string } = {}): FlagOperation => ({
  describe:
    segment !== undefined
      ? `stop serving ${on} to segment ${segment}`
      : `serve ${off} to everyone by default`,
  defaultTitle: "Turn flag off",
  defaultComment:
    segment !== undefined
      ? `Stop serving ${on} to segment ${segment}.`
      : `Set the default rule to ${off}.`,
  apply: (def) => {
    if (def.killed) return skip(KILLED)
    if (segment !== undefined) {
      const target = findTreatment(def, on)
      if (!target) return missingTreatment(on)
      if (!(target.segments ?? []).includes(segment))
        return skip(`segment ${segment} not on ${on}`)
      return {
        action: "update",
        next: withoutTreatmentSegment(def, on, segment),
        summary: `remove segment ${segment} from ${on}`,
      }
    }
    if (!findTreatment(def, off)) return missingTreatment(off)
    const buckets: Bucket[] = [{ treatment: off, size: 100 }]
    if (sameBuckets(def.defaultRule, buckets))
      return skip(`default rule already ${describeDefaultRule(def)}`)
    return {
      action: "update",
      next: withDefaultRule(def, buckets),
      summary: `default rule ${describeDefaultRule(def)} -> ${off} 100%`,
    }
  },
})
