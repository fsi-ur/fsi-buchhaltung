import { defineEventHandler, getQuery } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { listAuditGroups, type AuditFilters, type AuditGroup, type AuditOperation } from '~/server/utils/audit/log'

interface GetAuditLogSuccess { ok: true, groups: AuditGroup[], nextCursor: number | null }
interface GetAuditLogError { ok: false, error: string }
export type GetAuditLogResponse = GetAuditLogSuccess | GetAuditLogError

function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string' && value.length) return value.split(',')
  return undefined
}

export default defineEventHandler(async (event): Promise<GetAuditLogResponse> => {
  const current = await requirePermission(event, 'audit.view')
  if (!current.ok) return current

  const q = getQuery(event)

  const filters: AuditFilters = {
    from: typeof q.from === 'string' ? q.from : undefined,
    to: typeof q.to === 'string' ? q.to : undefined,
    userIds: toStringArray(q.userIds)
      ?.map(id => (id === 'system' ? 'system' as const : Number(id)))
      .filter(id => id === 'system' || Number.isInteger(id)),
    tables: toStringArray(q.tables),
    domains: toStringArray(q.domains),
    operations: toStringArray(q.operations) as AuditOperation[] | undefined,
    search: typeof q.search === 'string' ? q.search : undefined,
  }

  const parsedBefore = Number(q.before)
  const parsedLimit = Number(q.limit)
  const before = q.before && Number.isFinite(parsedBefore) ? parsedBefore : undefined
  const limit = q.limit && Number.isFinite(parsedLimit) ? Math.trunc(parsedLimit) : undefined

  const result = await listAuditGroups(current.user, filters, { before, limit })
  return result
})
