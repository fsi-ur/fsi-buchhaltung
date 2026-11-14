import { defineEventHandler, getQuery } from 'h3'
import { getScopedAuditGroups, type AuditGroup } from '~/server/utils/audit/log'
import {
  LEADERSHIP_HISTORY_TABLE_NAMES,
  LEADERSHIP_HISTORY_TABLES,
  requireSubdivisionPermission,
} from '~/server/utils/subdivisionLeadership'

interface GetLeadershipHistorySuccess { ok: true, groups: AuditGroup[] }
interface GetLeadershipHistoryError { ok: false, error: string }
export type GetLeadershipHistoryResponse = GetLeadershipHistorySuccess | GetLeadershipHistoryError

export default defineEventHandler(async (event): Promise<GetLeadershipHistoryResponse> => {
  const subdivisionId = Number(getQuery(event).parentId)
  const current = await requireSubdivisionPermission(event, null, subdivisionId)
  if (!current.ok) return current

  const allowed = current.access.permissions.includes('subdivision.history.view')
    || current.user.permissions.includes('subdivisions.leadership.view')
  if (!allowed) return { ok: false, error: 'Not authorized' }

  return await getScopedAuditGroups(current.user, LEADERSHIP_HISTORY_TABLES, subdivisionId, {
    preauthorizedTables: LEADERSHIP_HISTORY_TABLE_NAMES,
  })
})
