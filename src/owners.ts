import { type FmeClient, type FmeResult } from "./client.js"
import { type FeatureFlag } from "./types.js"

export type OwnerRef = { id: string; type: string; [key: string]: unknown }

export type ResolvedOwner = {
  id: string
  type: string
  // Null when the API would not say who this is (a deleted user, or a key
  // without the right to read users and groups). The id is always kept.
  name: string | null
  email?: string
}

type Person = { id?: string; name?: string; email?: string }

// Users are read from /users/{id}, groups from /groups/{id}. Each id is read
// once per resolver, so a flag list sharing a handful of owners costs a
// handful of calls, not one per flag.
export const createOwnerResolver = (client: FmeClient) => {
  const cache = new Map<string, Promise<FmeResult<Person>>>()

  const lookup = (ref: OwnerRef) => {
    const kind = ref.type?.toLowerCase() === "group" ? "groups" : "users"
    const cacheKey = `${kind}/${ref.id}`
    let pending = cache.get(cacheKey)
    if (!pending) {
      pending = client.request<Person>(`/${kind}/${encodeURIComponent(ref.id)}`)
      cache.set(cacheKey, pending)
    }
    return pending
  }

  const resolve = async (ref: OwnerRef): Promise<ResolvedOwner> => {
    const found = await lookup(ref)
    const person = found.ok && found.data ? found.data : undefined
    return {
      id: ref.id,
      type: ref.type,
      name: person?.name ?? null,
      ...(person?.email ? { email: person.email } : {}),
    }
  }

  return {
    resolve,
    resolveAll: async (refs: OwnerRef[]) => {
      const out: ResolvedOwner[] = []
      for (const ref of refs) out.push(await resolve(ref))
      return out
    },
  }
}

export type OwnerResolver = ReturnType<typeof createOwnerResolver>

const ownersOf = (flag: FeatureFlag): OwnerRef[] =>
  Array.isArray(flag.owners)
    ? (flag.owners as unknown[]).filter(
        (o): o is OwnerRef =>
          !!o &&
          typeof o === "object" &&
          typeof (o as OwnerRef).id === "string",
      )
    : []

// The flag with each owner carrying its display name beside its id. Owners
// the API cannot name keep `name: null`; a failed lookup never fails the read.
export const withOwnerNames = async (
  client: FmeClient,
  flag: FeatureFlag,
  resolver: OwnerResolver = createOwnerResolver(client),
): Promise<FeatureFlag> => {
  const owners = ownersOf(flag)
  if (owners.length === 0) return flag
  return {
    ...flag,
    owners: await resolver.resolveAll(owners),
  }
}
