import { describe, expect, it } from "vitest"
import { API_BASE, createClient } from "../client.js"
import { deleteFeatureFlag, getFeatureFlag } from "../flags.js"
import { deleteSegment, enableSegmentInEnvironment } from "../segments.js"

const WS_ID = "11111111-2222-4333-8444-555555555555"
const ENV_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"

const setup = () => {
  const urls: string[] = []
  const client = createClient({
    apiKey: "test-key",
    fetch: async (input) => {
      urls.push(String(input))
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    },
  })
  return { client, urls }
}

describe("path segment encoding", () => {
  it("sends a flag name with spaces, slashes and question marks as one encoded path segment", async () => {
    const { client, urls } = setup()
    const result = await getFeatureFlag(client, {
      workspaceId: WS_ID,
      flagName: "new flow/v2?x",
    })
    expect(result.ok).toBe(true)
    expect(urls[0]).toBe(`${API_BASE}/splits/ws/${WS_ID}/new%20flow%2Fv2%3Fx`)
  })

  it("encodes segment names in segment paths", async () => {
    const { client, urls } = setup()
    await enableSegmentInEnvironment(client, {
      environmentId: ENV_ID,
      segmentName: "beta testers",
    })
    expect(urls[0]).toBe(`${API_BASE}/segments/${ENV_ID}/beta%20testers`)
    const result = await deleteSegment(client, {
      workspaceId: WS_ID,
      segmentName: "beta testers",
    })
    expect(result.ok).toBe(true)
    expect(urls[1]).toBe(`${API_BASE}/segments/ws/${WS_ID}/beta%20testers`)
  })

  it("leaves simple names unchanged", async () => {
    const { client, urls } = setup()
    const result = await deleteFeatureFlag(client, {
      workspaceId: WS_ID,
      flagName: "checkout_new_flow",
    })
    expect(result.ok).toBe(true)
    expect(urls[0]).toBe(`${API_BASE}/splits/ws/${WS_ID}/checkout_new_flow`)
  })
})
