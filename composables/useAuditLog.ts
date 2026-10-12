import { ref, computed } from 'vue'
import { useToast } from '~/composables/useToast'
import type { AuditFilters, AuditGroup } from '~/types/audit'
import type { GetAuditLogResponse } from '~/server/api/audit/index.get'
import { startOfLocalDate, todayLocalDate } from '~/shared/time'
import { useAppTimeZone } from '~/composables/useAppTimeZone'

export interface AuditQuickRange {
  key: 'today' | '7d' | '30d' | 'all'
}

function quickRangeFrom(key: AuditQuickRange['key'], timeZone: string): string | undefined {
  if (key === 'all') return undefined
  const now = new Date()
  if (key === 'today') return startOfLocalDate(todayLocalDate(timeZone, now), timeZone).toISOString()
  const days = key === '7d' ? 7 : 30
  return new Date(now.getTime() - days * 86400000).toISOString()
}

export function useAuditLog() {
  const toast = useToast()
  const { timeZone } = useAppTimeZone()

  const groups = ref<AuditGroup[]>([])
  const loading = ref(false)
  const loadingMore = ref(false)
  const nextCursor = ref<number | null>(null)

  const search = ref('')
  const quickRange = ref<AuditQuickRange['key']>('30d')
  const domainFilter = ref<string[]>([])
  const tableFilter = ref<string[]>([])
  const operationFilter = ref<string[]>([])
  const userFilter = ref<Array<number | 'system'>>([])

  const hasMore = computed(() => nextCursor.value !== null)

  function buildFilters(): AuditFilters {
    return {
      from: quickRangeFrom(quickRange.value, timeZone.value),
      userIds: userFilter.value.length ? [...userFilter.value] : undefined,
      tables: tableFilter.value.length ? tableFilter.value : undefined,
      domains: domainFilter.value.length ? domainFilter.value : undefined,
      operations: operationFilter.value.length ? operationFilter.value as any : undefined,
      search: search.value.trim() || undefined,
    }
  }

  async function fetchPage(before?: number) {
    const filters = buildFilters()
    const query: Record<string, string> = {}
    if (filters.from) query.from = filters.from
    if (filters.to) query.to = filters.to
    if (filters.userIds?.length) query.userIds = filters.userIds.join(',')
    if (filters.tables) query.tables = filters.tables.join(',')
    if (filters.domains) query.domains = filters.domains.join(',')
    if (filters.operations) query.operations = filters.operations.join(',')
    if (filters.search) query.search = filters.search
    if (before) query.before = String(before)

    return await $fetch<GetAuditLogResponse>('/api/audit', { query })
  }

  async function load() {
    loading.value = true
    try {
      const res = await fetchPage()
      if (res.ok) {
        groups.value = res.groups
        nextCursor.value = res.nextCursor
      } else {
        toast.error(res.error)
      }
    } finally {
      loading.value = false
    }
  }

  async function loadMore() {
    if (!hasMore.value || loadingMore.value) return
    loadingMore.value = true
    try {
      const res = await fetchPage(nextCursor.value ?? undefined)
      if (res.ok) {
        groups.value = [...groups.value, ...res.groups]
        nextCursor.value = res.nextCursor
      } else {
        toast.error(res.error)
      }
    } finally {
      loadingMore.value = false
    }
  }

  return {
    groups,
    loading,
    loadingMore,
    hasMore,
    search,
    quickRange,
    domainFilter,
    tableFilter,
    operationFilter,
    userFilter,
    load,
    loadMore,
  }
}
