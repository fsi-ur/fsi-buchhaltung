import type { AssociationDocument } from '~/types/document'
import type { ListDocumentsResponse } from '~/server/api/documents/index.get'

const documents = ref<AssociationDocument[]>([])
const loading = ref(false)
let inflight: Promise<void> | null = null

const STALE_AFTER_MS = 5 * 60 * 1000
let loadedAt = 0

function isStale() {
  return !loadedAt || Date.now() - loadedAt > STALE_AFTER_MS
}

async function fetchDocuments() {
  loading.value = true
  try {
    const res = await $fetch<ListDocumentsResponse>('/api/documents?activeOnly=true')
    documents.value = res.ok ? res.documents.filter(document => document.file_id !== null) : []
    loadedAt = Date.now()
  } catch {
    documents.value = []
  } finally {
    loading.value = false
    inflight = null
  }
}

export function useAssociationDocuments() {
  function ensureLoaded() {
    if (!isStale()) return Promise.resolve()
    inflight ??= fetchDocuments()
    return inflight
  }

  function refresh() {
    loadedAt = 0
    inflight ??= fetchDocuments()
    return inflight
  }

  function byId(id: number) {
    return documents.value.find(document => document.id === id) ?? null
  }

  return { documents, loading, ensureLoaded, refresh, byId }
}
