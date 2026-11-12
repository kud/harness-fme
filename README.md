<div align="center">

🚩

# Harness FME

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![npm](https://img.shields.io/npm/v/@kud/harness-fme?style=flat-square&color=CB3837)
![MIT](https://img.shields.io/badge/licence-MIT-22C55E?style=flat-square)

**Headless Harness FME (Split) admin API client: typed reads, rate-limited requests and a safe plan, backup, write and read-back engine for flag changes.**

<a href="https://kud.io/projects/harness-fme">Website</a> · <a href="https://kud.io/projects/harness-fme/docs">Documentation</a>

</div>

## Features

- **Results, not exceptions** — every call returns an `FmeResult`: `{ ok: true, data }` or `{ ok: false, message, status? }`
- **Key kept in a closure** — the API key is never stored on the client object, so logging or serialising the client cannot print it
- **Rate-limit aware** — optional request spacing, and 429s are retried by waiting out the window named in the `x-ratelimit-reset-seconds-org` / `-ip` headers
- **Broad resource coverage** — workspaces, environments, feature flags, flag definitions, classic and rule-based segments, and a flag URL builder
- **Honest paging** — pages are walked to the end by what the API actually returns, using `limit` (the API ignores `size`), never by what was asked for
- **A safe-write engine** — plan from reads only, take a backup before each write, write with a title and comment, read back and diff against the plan, stop at the first failure
- **A production gate** — writes stay a plan until you say go; an environment matching `/prod/i` also needs its exact name typed
- **Pure helpers** — diffing, definition normalisation, rollout classification and rollout-table builders
- **Zero runtime dependencies** — ESM only, Node.js 20 or later

Surface-agnostic by design: this package holds no terminal, no MCP and no prompts, just data, actions and the write engine. Three siblings sit on top of it:

- [`@kud/harness-fme-cli`](https://www.npmjs.com/package/@kud/harness-fme-cli) for the terminal
- [`@kud/harness-fme-ink`](https://www.npmjs.com/package/@kud/harness-fme-ink) for the interactive terminal UI
- [`@kud/mcp-harness-fme`](https://www.npmjs.com/package/@kud/mcp-harness-fme) for MCP clients

## Install

```sh
npm install @kud/harness-fme
```

Requires Node.js 20 or later. The package is ESM only.

## Usage

### Create a client

```ts
import { createClient, resolveApiKey } from "@kud/harness-fme"

const apiKey = resolveApiKey()
if (!apiKey) throw new Error("set HARNESS_FME_API_KEY")

const client = createClient({ apiKey, minIntervalMs: 120 })
```

`resolveApiKey()` reads `HARNESS_FME_API_KEY`, then `MCP_HARNESS_FME_API_KEY`, and returns the first non-empty value.

### Read, with results instead of exceptions

```ts
import { resolveWorkspace, listAllFeatureFlags } from "@kud/harness-fme"

const workspace = await resolveWorkspace(client, "web-shop")
if (!workspace.ok) {
  console.error(workspace.message)
  process.exit(1)
}

const flags = await listAllFeatureFlags(client, {
  workspaceId: workspace.data.id,
  tag: "checkout",
})
if (flags.ok) console.log(flags.data.map((f) => f.name))
```

### Plan, then write safely

```ts
import {
  applyChanges,
  getEnvironments,
  planChanges,
  selectUpdates,
  turnOnOperation,
} from "@kud/harness-fme"

const environments = await getEnvironments(client, {
  workspaceId: "11111111-2222-4333-8444-555555555555",
})
if (!environments.ok) throw new Error(environments.message)
const environment = environments.data.find((e) => e.name === "Staging")!

const operation = turnOnOperation({ percent: 10 })

const plan = await planChanges(client, {
  workspaceId: "11111111-2222-4333-8444-555555555555",
  environmentId: environment.id,
  flags: ["checkout_new_flow"],
  operation,
})

const outcome = await applyChanges(client, {
  workspaceId: "11111111-2222-4333-8444-555555555555",
  environmentId: environment.id,
  operation,
  items: selectUpdates(plan, { limit: 5 }),
  title: operation.defaultTitle,
  comment: operation.defaultComment,
  guard: {
    environmentName: environment.name,
    environmentArg: "Staging",
    go: true,
  },
  backup: async ({ flag, definition }) => {
    await saveSomewhereDurable(flag, definition)
  },
  onResult: (result) => console.log(result.flag, result.status),
})
```

`planChanges` only reads. `applyChanges` refuses to write unless `guard.go` is true, and for a production-looking environment `guard.environmentArg` must equal the environment's exact name.

Adding a tester to a segment-backed treatment is the same idea in one call:

```ts
import { addSegmentToTreatment } from "@kud/harness-fme"

const result = await addSegmentToTreatment(client, {
  workspaceId: "11111111-2222-4333-8444-555555555555",
  environmentId: environment.id,
  flagName: "checkout_new_flow",
  treatment: "on",
  segment: "beta_testers",
})
```

## API reference

Everything is exported from the package root. Parameters are plain objects; ids are workspace, environment and flag identifiers as the API reports them.

### Client

| Export                       | Purpose                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `createClient(options)`      | Build a client. Throws only if `apiKey` is empty.                                                    |
| `resolveApiKey(env?)`        | Read `HARNESS_FME_API_KEY`, then `MCP_HARNESS_FME_API_KEY`. Returns `undefined` when neither is set. |
| `client.request(path, opts)` | Low-level escape hatch: `{ method?, body?, expectBody? }`, returns an `FmeResult`.                   |
| `withContext(result, text)`  | Prefix a failure's message with what you were doing, keeping its `status`.                           |
| `failure(message)`           | Build an `FmeFailure`.                                                                               |
| `rateLimitWaitMs(response)`  | The wait derived from the rate-limit headers.                                                        |
| `API_BASE`, `GUID_RE`        | The default base URL and a GUID matcher.                                                             |

`createClient` options:

| Option          | Default                                | Meaning                                                                     |
| --------------- | -------------------------------------- | --------------------------------------------------------------------------- |
| `apiKey`        | required                               | Admin API key, sent as a bearer token.                                      |
| `baseUrl`       | `https://api.split.io/internal/api/v2` | Override the API base.                                                      |
| `fetch`         | `globalThis.fetch`                     | Inject a fetch implementation, handy in tests.                              |
| `minIntervalMs` | `0`                                    | Minimum gap between two request starts, retries included. Zero disables it. |
| `maxRetries`    | `3`                                    | How many times a 429 is retried.                                            |
| `sleep`         | `setTimeout`-based                     | Inject a sleep function, handy in tests.                                    |
| `onError`       | none                                   | Called with `(message, path)` on any failed request.                        |
| `onRateLimit`   | none                                   | Called with `(waitMs, path)` before each rate-limit wait.                   |

The wait on a 429 comes from `x-ratelimit-reset-seconds-org` or `-ip`, capped at 12 seconds, with a two-second fallback when the headers are missing.

### Result type

```ts
type FmeResult<T> =
  { ok: true; data: T } | { ok: false; message: string; status?: number }
```

Network failures and non-2xx responses both come back as `ok: false`. The `status` is present for HTTP failures, so a 404 can be treated as an answer rather than an error.

### Workspaces and environments

| Export                                        | Purpose                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `listWorkspaces(client, { limit?, offset? })` | One page of workspaces.                                                          |
| `getAllWorkspaces(client)`                    | Every workspace, paged to the end.                                               |
| `resolveWorkspace(client, reference?)`        | By id or name; with no reference, the only workspace, else an error naming them. |
| `listEnvironments(client, { workspaceId })`   | The raw environments response.                                                   |
| `getEnvironments(client, { workspaceId })`    | Environments as a normalised array.                                              |
| `resolveEnvironment(client, wsId, ref)`       | By id or name (case-insensitive), always looked up so its real name is known.    |
| `resolveEnvironmentId(client, wsId, ref)`     | Id-only variant; a bare GUID passes through without a lookup.                    |
| `listTrafficTypes`, `listRolloutStatuses`     | Reference data for a workspace.                                                  |

### Feature flags

| Export                                                                                      | Purpose                                               |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `listFeatureFlags(client, { workspaceId, limit?, offset?, tag?, rolloutStatusId?, name? })` | One page.                                             |
| `listAllFeatureFlags(client, params)`                                                       | Every matching flag, paged to the end.                |
| `getFeatureFlag`                                                                            | One flag, by `{ workspaceId, flagName }`.             |
| `createFeatureFlag`                                                                         | `{ workspaceId, trafficType, name, description? }`.   |
| `updateFeatureFlag`                                                                         | Description, tags, owners or rollout status.          |
| `deleteFeatureFlag`, `archiveFeatureFlag`, `unarchiveFeatureFlag`                           | Lifecycle changes.                                    |
| `killFeatureFlag`, `restoreFeatureFlag`                                                     | Kill or restore a flag in one environment.            |
| `buildFlagUrl(client, { accountId, orgGuid, workspace, flag, environment })`                | The web UI deep link, resolving names to ids for you. |

### Flag definitions

| Export                                          | Purpose                                                                           |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `getFlagDefinition`                             | One flag's definition in one environment.                                         |
| `listFlagDefinitions`, `listAllFlagDefinitions` | One page, or every definition in an environment.                                  |
| `createFlagDefinition`, `updateFlagDefinition`  | Write a definition passed as a JSON string, with optional `title` and `comment`.  |
| `deleteFlagDefinition`                          | Remove a flag from an environment.                                                |
| `addSegmentToTreatment`                         | Read-modify-write, so a dropped field cannot wipe existing targeting. Idempotent. |
| `withTitleComment(parsed, title?, comment?)`    | Merge a title and comment into a definition body.                                 |

### Segments

| Export                                                                                                                                         | Purpose                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `listSegments`, `createSegment`, `deleteSegment`                                                                                               | Classic segments.                                         |
| `listSegmentDefinitions`, `enableSegmentInEnvironment`, `disableSegmentInEnvironment`                                                          | Per-environment segment state.                            |
| `listSegmentKeys`, `addSegmentKeys`, `removeSegmentKeys`                                                                                       | Keys in a segment; `MAX_SEGMENT_KEYS_PER_CALL` is 10,000. |
| `listRuleBasedSegments`, `getRuleBasedSegment`, `createRuleBasedSegment`, `deleteRuleBasedSegment`                                             | Rule-based segments.                                      |
| `listRuleBasedSegmentDefinitions`, `updateRuleBasedSegmentDefinition`, `enableRuleBasedSegmentDefinition`, `disableRuleBasedSegmentDefinition` | Their per-environment definitions.                        |
| `createRuleBasedSegmentChangeRequest`                                                                                                          | Raise a change request for a rule-based segment.          |

### Paging

| Export                         | Purpose                                                               |
| ------------------------------ | --------------------------------------------------------------------- |
| `MAX_PAGE_SIZE`                | `50`, the API's cap on every list endpoint.                           |
| `collectAll(fetchPage, opts?)` | Walk any `(offset, limit) => Promise<FmeResult<Page<T>>>` to the end. |

`listFeatureFlags` sends `limit` because the API ignores `size`, so a page is up to 50 flags. `collectAll` advances the offset by the number of objects actually returned and stops on `totalCount`, or on a short page when the API omits it, so a server that caps pages lower than requested still yields every object exactly once.

### The safe-write engine

A `FlagOperation` is a pure edit of one definition: given the current state, either an update or a reason to skip.

| Export                                                                               | Purpose                                                                                                  |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `addKeyOperation({ key, treatment? })`                                               | Add an individual key to a treatment (default `on`).                                                     |
| `removeKeyOperation({ key, treatment? })`                                            | Remove an individual key from a treatment (default `on`).                                                |
| `turnOnOperation({ segment?, percent?, on?, off? })`                                 | Serve `on` by default, to a segment, or to a percentage. Passing both a segment and a percentage throws. |
| `turnOffOperation({ segment?, on?, off? })`                                          | Serve `off` by default, or stop serving `on` to a segment.                                               |
| `planChanges(client, { workspaceId, environmentId, flags, operation, onProgress? })` | Read each flag and decide update, skip or error. Writes nothing.                                         |
| `selectUpdates(plan, { only?, limit? })`                                             | Narrow a plan to the updates a write will touch. Skips and errors are never selected.                    |
| `applyChanges(client, options)`                                                      | Write the selected items one at a time; returns `{ results, ok }`.                                       |
| `evaluateWriteGate({ environmentName, environmentArg, go })`                         | `plan`, `write` or `refused`.                                                                            |
| `isProductionEnvironment(name)`, `PRODUCTION_ENVIRONMENT_PATTERN`                    | The `/prod/i` check.                                                                                     |

For each flag, `applyChanges` does this in order:

1. Evaluates the write gate. Without `go`, nothing is written. A production-looking environment also needs `environmentArg` to equal its exact name.
2. Reads the flag fresh and re-runs the operation on that read, because state may have moved since the plan.
3. Calls your `backup` callback with the original definition. If it throws, that write never happens and the run stops.
4. `PUT`s the new definition with your `title` and `comment`.
5. Reads it back and diffs it against the plan.

The first failure of any kind stops the run, so one bad flag can never become fifty. Each `ApplyResult` is `applied`, `skipped` or `failed`, with a `reason` and the diff where relevant.

### Pure helpers

| Export                                                                                                          | Purpose                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `diffValues(before, after)`                                                                                     | Path-by-path `DiffEntry[]` between two values.                                                                          |
| `normaliseDefinition(def)`                                                                                      | Drop volatile fields and sort key and segment lists so definitions compare cleanly.                                     |
| `classifyRollout(def, { on?, off? })`                                                                           | `killed`, `on`, `off`, `partial` or `unknown`.                                                                          |
| `describeDefaultRule(def)`                                                                                      | Text such as `on 10% / off 90%`, or `none`.                                                                             |
| `isFullyServing`, `findTreatment`                                                                               | Small readers over a definition.                                                                                        |
| `withTreatmentKey`, `withoutTreatmentKey`, `withTreatmentSegment`, `withoutTreatmentSegment`, `withDefaultRule` | Immutable definition edits.                                                                                             |
| `writableView`, `otherView`, `buildWriteBody`, `WRITABLE_FIELDS`                                                | What a write may change, and what it must leave alone.                                                                  |
| `findFlags(client, workspaceId, { tag?, prefix?, includeInactive? })`                                           | Flags by tag or name prefix; archived ones are left out unless asked for.                                               |
| `buildFlagRows(client, { workspaceId, flags, environments, totalFlags? })`                                      | One row per flag with a view per environment, for rollout tables. Chooses per-flag or bulk reads, whichever is cheaper. |
| `countFlags(client, workspaceId)`                                                                               | The workspace's flag count from one tiny page.                                                                          |

All types (`Workspace`, `Environment`, `FeatureFlag`, `Treatment`, `FlagDefinition`, `PlanItem`, `ApplyOptions`, `FlagRow` and more) are exported too.

## Development

```sh
git clone https://github.com/kud/harness-fme.git
cd harness-fme
npm install
npm run build
```

| Script                | What it does                            |
| --------------------- | --------------------------------------- |
| `npm run build`       | Bundle with tsup and emit declarations. |
| `npm run build:watch` | Rebuild on change.                      |
| `npm run typecheck`   | Type-check without emitting.            |
| `npm test`            | Run the vitest suite once.              |
| `npm run test:watch`  | Run vitest in watch mode.               |

The tests run against an in-memory fake of the API (`src/__tests__/fake-api.ts`), so they need no key and make no network calls.

📚 **Full documentation → [harness-fme/docs](https://kud.io/projects/harness-fme/docs)**
