import { type FmeResult } from "./client.js"
import { type Page } from "./types.js"

// The admin API caps every list endpoint at 50 objects per page.
export const MAX_PAGE_SIZE = 50

export type FetchPage<T> = (
  offset: number,
  limit: number,
) => Promise<FmeResult<Page<T>>>

// Walks a paged endpoint to the end. The offset advances by what the API
// actually returned, not by what was asked for, and the walk ends on
// totalCount (or a short page when the API omits it), so a server that caps
// pages below the requested size still yields every object exactly once.
export const collectAll = async <T>(
  fetchPage: FetchPage<T>,
  { pageSize = MAX_PAGE_SIZE }: { pageSize?: number } = {},
): Promise<FmeResult<T[]>> => {
  const all: T[] = []
  let offset = 0
  for (;;) {
    const page = await fetchPage(offset, pageSize)
    if (!page.ok) return page
    const objects = page.data.objects ?? []
    all.push(...objects)
    offset += objects.length
    const total = page.data.totalCount
    if (objects.length === 0) break
    if (typeof total === "number" ? offset >= total : objects.length < pageSize)
      break
  }
  return { ok: true, data: all }
}
