import { defineEventHandler, readBody } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { invalidateWikiAccess, requireScopeAdmin } from '~/server/utils/wiki/access'
import { checkNoEscalation, parseGrantInput, subjectExists } from '~/server/utils/wiki/grants'
import { internalError } from '~/server/utils/api/errors'

export type AddWikiGrantResponse = { ok: true } | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<AddWikiGrantResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const input = parseGrantInput(await readBody(event))
  if (typeof input === 'string') return { ok: false, error: input }

  const access = await requireScopeAdmin(event, current.user, input.scopeType, input.scopeId)
  if (!access.ok) return access

  const escalation = checkNoEscalation(access.index, access.subjects, input)
  if (escalation) return { ok: false, error: escalation }

  if (!(await subjectExists(input))) {
    return { ok: false, error: 'Die ausgewählten Berechtigten wurden nicht gefunden.' }
  }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query(
        `INSERT IGNORE INTO wiki_access_grants
           (scope_type, scope_id, include_descendants, subject_type, subject_id, subject_key, access_level, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.scopeType,
          input.scopeId,
          input.includeDescendants ? 1 : 0,
          input.subjectType,
          input.subjectId,
          input.subjectKey,
          input.accessLevel,
          current.user.id,
        ],
        conn,
      )
    })

    invalidateWikiAccess(event)
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to add wiki access grant', err)
  }
})
