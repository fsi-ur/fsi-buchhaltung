import type { WikiPageHelpArticle, WikiPageHelpResponse } from '~/server/api/wiki/page-help.get'

const cache = new Map<string, WikiPageHelpArticle[]>()
const pending = new Map<string, Promise<WikiPageHelpArticle[]>>()

async function fetchPageHelp(pageName: string) {
  try {
    const res = await apiFetch<WikiPageHelpResponse>('/api/wiki/page-help', { query: { page: pageName } })
    const entries = res.ok ? res.entries : []
    cache.set(pageName, entries)
    return entries
  } catch {
    cache.set(pageName, [])
    return []
  } finally {
    pending.delete(pageName)
  }
}

export function useWikiHelp() {
  function loadPageHelp(pageName: string): Promise<WikiPageHelpArticle[]> {
    const cached = cache.get(pageName)
    if (cached) return Promise.resolve(cached)

    const inFlight = pending.get(pageName)
    if (inFlight) return inFlight

    const request = fetchPageHelp(pageName)
    pending.set(pageName, request)
    return request
  }

  function invalidatePageHelp(pageName?: string) {
    if (pageName) cache.delete(pageName)
    else cache.clear()
  }

  return { loadPageHelp, invalidatePageHelp }
}
