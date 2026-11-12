import { failure, GUID_RE, type FmeClient, type FmeResult } from "./client.js"
import { listWorkspaces, resolveEnvironmentId } from "./workspaces.js"

// Assemble a Harness FME web-UI deep-link. Accepts workspace/flag/environment
// by name or id and resolves the GUIDs the URL needs (org slug, project, flag
// id, env id) via the same endpoints the caller would otherwise hit, so a call
// is just "which flag, which env". The account ID and org GUID are Harness
// *platform* identifiers not exposed by the Split API, so the caller supplies
// them.
export const buildFlagUrl = async (
  client: FmeClient,
  {
    accountId,
    orgGuid,
    workspace,
    flag,
    environment,
  }: {
    accountId: string
    orgGuid: string
    workspace: string
    flag: string
    environment: string
  },
): Promise<FmeResult<{ url: string }>> => {
  const workspaces = await listWorkspaces(client, { limit: 50, offset: 0 })
  if (!workspaces.ok)
    return failure(`failed to resolve workspace (${workspaces.message})`)
  const ws = workspaces.data.objects.find(
    (w) => w.id === workspace || w.name === workspace,
  )
  if (!ws) return failure(`workspace not found: ${workspace}`)
  if (!ws.organizationIdentifier || !ws.projectIdentifier)
    return failure(
      `workspace ${ws.name} has no organizationIdentifier/projectIdentifier to build a URL from`,
    )

  let flagId = flag
  if (!GUID_RE.test(flag)) {
    const resolved = await client.request<{ id?: string }>(
      `/splits/ws/${ws.id}/${flag}`,
    )
    if (!resolved.ok)
      return failure(`failed to resolve flag: ${flag} (${resolved.message})`)
    if (!resolved.data.id) return failure(`flag has no id: ${flag}`)
    flagId = resolved.data.id
  }

  const env = await resolveEnvironmentId(client, ws.id, environment)
  if ("error" in env) return failure(env.error)

  return {
    ok: true,
    data: {
      url:
        `https://app.harness.io/ng/account/${accountId}/all/fme/orgs/${ws.organizationIdentifier}` +
        `/projects/${ws.projectIdentifier}/org/${orgGuid}/ws/${ws.id}/splits/${flagId}` +
        `/env/${env.id}/definition`,
    },
  }
}
