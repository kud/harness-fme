import { type FmeClient } from "./client.js"
import {
  buildWriteBody,
  diffValues,
  otherView,
  writableView,
  type DiffEntry,
} from "./definition.js"
import { getFlagDefinition } from "./flags.js"
import { type FlagOperation } from "./operations.js"
import { evaluateWriteGate, type WriteGuardInput } from "./safety.js"
import { type FlagDefinition } from "./types.js"

export type PlanItem =
  | {
      flag: string
      action: "update"
      summary: string
      before: FlagDefinition
      next: FlagDefinition
      changes: DiffEntry[]
    }
  | { flag: string; action: "skip"; reason: string }
  | { flag: string; action: "error"; reason: string }

// Read every flag in the environment and decide, flag by flag, what the
// operation would do. Nothing is written.
export const planChanges = async (
  client: FmeClient,
  {
    workspaceId,
    environmentId,
    flags,
    operation,
    onProgress,
  }: {
    workspaceId: string
    environmentId: string
    flags: string[]
    operation: FlagOperation
    onProgress?: (done: number, total: number) => void
  },
): Promise<PlanItem[]> => {
  const plan: PlanItem[] = []
  for (const flag of flags) {
    const read = await getFlagDefinition(client, {
      workspaceId,
      environmentId,
      flagName: flag,
    })
    if (!read.ok) {
      plan.push(
        read.status === 404
          ? { flag, action: "skip", reason: "not defined in this environment" }
          : { flag, action: "error", reason: read.message },
      )
    } else {
      const outcome = operation.apply(read.data)
      plan.push(
        outcome.action === "update"
          ? {
              flag,
              action: "update",
              summary: outcome.summary,
              before: read.data,
              next: outcome.next,
              changes: diffValues(
                writableView(read.data),
                writableView(outcome.next),
              ),
            }
          : { flag, action: "skip", reason: outcome.reason },
      )
    }
    onProgress?.(plan.length, flags.length)
  }
  return plan
}

// Narrow a plan to the items a write will touch: only the named flags, and at
// most `limit` of them. Skips and errors are never selected.
export const selectUpdates = (
  plan: PlanItem[],
  { only, limit }: { only?: string[]; limit?: number } = {},
): Extract<PlanItem, { action: "update" }>[] => {
  const wanted = only && only.length > 0 ? new Set(only) : undefined
  const selected = plan.filter(
    (item): item is Extract<PlanItem, { action: "update" }> =>
      item.action === "update" && (!wanted || wanted.has(item.flag)),
  )
  return limit !== undefined ? selected.slice(0, Math.max(0, limit)) : selected
}

export type ApplyResult = {
  flag: string
  status: "applied" | "skipped" | "failed"
  reason?: string
  changes?: DiffEntry[]
}

export type BackupInfo = {
  flag: string
  environmentId: string
  // The definition exactly as read, immediately before the write.
  definition: FlagDefinition
}

export type ApplyOptions = {
  workspaceId: string
  environmentId: string
  operation: FlagOperation
  // Already narrowed with selectUpdates.
  items: Extract<PlanItem, { action: "update" }>[]
  title: string
  comment: string
  guard: WriteGuardInput
  // Must persist the original definition before the write goes out. If it
  // throws, the write for that flag never happens and the run stops.
  backup: (info: BackupInfo) => void | Promise<void>
  onResult?: (result: ApplyResult) => void
}

export type ApplyOutcome = {
  results: ApplyResult[]
  ok: boolean
}

// Write the selected flags one at a time. For each: read it fresh, re-run the
// operation on that fresh read (state may have moved since the plan), back up
// the original, write, read it back, and compare the result with what was
// intended. The first failure of any kind stops the run, so one bad flag can
// never become fifty.
export const applyChanges = async (
  client: FmeClient,
  options: ApplyOptions,
): Promise<ApplyOutcome> => {
  const { workspaceId, environmentId, operation, title, comment } = options
  const results: ApplyResult[] = []
  const record = (result: ApplyResult) => {
    results.push(result)
    options.onResult?.(result)
    return result
  }
  const stop = (result: ApplyResult): ApplyOutcome => {
    record(result)
    return { results, ok: false }
  }

  const gate = evaluateWriteGate(options.guard)
  if (gate.mode === "plan")
    return stop({
      flag: "*",
      status: "failed",
      reason: "no --go given: nothing was written",
    })
  if (gate.mode === "refused")
    return stop({ flag: "*", status: "failed", reason: gate.reason })

  for (const item of options.items) {
    const flag = item.flag
    const ref = { workspaceId, environmentId, flagName: flag }

    const fresh = await getFlagDefinition(client, ref)
    if (!fresh.ok)
      return stop({
        flag,
        status: "failed",
        reason: `fresh read failed: ${fresh.message}`,
      })
    const before = fresh.data
    const outcome = operation.apply(before)
    if (outcome.action === "skip") {
      record({
        flag,
        status: "skipped",
        reason: `state changed since the plan: ${outcome.reason}`,
      })
      continue
    }

    try {
      await options.backup({ flag, environmentId, definition: before })
    } catch (e) {
      return stop({
        flag,
        status: "failed",
        reason: `backup failed, nothing written: ${
          e instanceof Error ? e.message : String(e)
        }`,
      })
    }

    const written = await client.request<unknown>(
      `/splits/ws/${workspaceId}/${flag}/environments/${environmentId}`,
      { method: "PUT", body: buildWriteBody(outcome.next, { title, comment }) },
    )
    if (!written.ok)
      return stop({
        flag,
        status: "failed",
        reason: `write failed: ${written.message}`,
      })

    const reread = await getFlagDefinition(client, ref)
    if (!reread.ok)
      return stop({
        flag,
        status: "failed",
        reason: `read-back failed after the write: ${reread.message}`,
      })
    const after = reread.data
    const mismatches = [
      ...diffValues(writableView(outcome.next), writableView(after)),
      ...diffValues(otherView(before), otherView(after)),
    ]
    if (mismatches.length > 0)
      return stop({
        flag,
        status: "failed",
        reason: `read-back does not match the plan (${mismatches
          .map((m) => m.path)
          .join(", ")})`,
        changes: mismatches,
      })

    record({
      flag,
      status: "applied",
      changes: diffValues(writableView(before), writableView(after)),
    })
  }
  return { results, ok: true }
}
