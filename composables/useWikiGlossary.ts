import type { WikiGlossaryResponse } from '~/server/api/wiki/glossary/index.get'
import type { GlossaryTermView } from '~/server/utils/wiki/glossary'

let cache: GlossaryTermView[] | null = null
let pending: Promise<GlossaryTermView[]> | null = null

const UMLAUTS: Record<string, string> = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' }

export function wikiGlossaryKey(value: string) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[äöüß]/g, char => UMLAUTS[char] ?? char)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
}

async function fetchGlossary() {
  try {
    const res = await apiFetch<WikiGlossaryResponse>('/api/wiki/glossary')
    cache = res.ok ? res.terms : []
  } catch {
    cache = []
  } finally {
    pending = null
  }
  return cache ?? []
}

export function useWikiGlossary() {
  function loadGlossary(): Promise<GlossaryTermView[]> {
    if (cache) return Promise.resolve(cache)
    if (pending) return pending
    pending = fetchGlossary()
    return pending
  }

  async function lookupTerm(key: string): Promise<GlossaryTermView | null> {
    const terms = await loadGlossary()
    const wanted = wikiGlossaryKey(key)
    return terms.find(term => term.key === wanted
      || term.aliases.some(alias => wikiGlossaryKey(alias) === wanted)) ?? null
  }

  function invalidateGlossary() {
    cache = null
    pending = null
  }

  return { loadGlossary, lookupTerm, invalidateGlossary }
}
