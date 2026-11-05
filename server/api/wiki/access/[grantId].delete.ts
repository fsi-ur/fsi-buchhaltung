import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { invalidateWikiAccess, requireScopeAdmin } from '~/server/utils/wiki/access'
import { checkLastAdmin, findGrant, isOwnerDerivedGrant, loadScopeOwner } from '~/server/utils/wiki/grants'
import { internalError } from '~/server/utils/api/errors'

export type DeleteWikiGrantResponse = { ok: true } | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<DeleteWikiGrantResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const grantId = Number(event.context.params?.grantId)
  if (!Number.isInteger(grantId) || grantId <= 0) return { ok: false, error: 'Die Berechtigung wurde nicht gefunden.' }

  const grant = await findGrant(grantId)
  if (!grant) return { ok: false, error: 'Die Berechtigung wurde nicht gefunden.' }

  const access = await requireScopeAdmin(event, current.user, grant.scope_type, Number(grant.scope_id))
  if (!access.ok) return access

  const owner = await loadScopeOwner(grant.scope_type, Number(grant.scope_id))
  if (isOwnerDerivedGrant(grant, owner)) {
    return { ok: false, error: 'Diese Berechtigung stammt aus der Zuständigkeit (Amt/Untergliederung). Entferne zuerst die Zuständigkeit, um sie zu entfernen.' }
  }

  const lastAdmin = checkLastAdmin(access.index, access.subjects, grant)
  if (lastAdmin) return { ok: false, error: lastAdmin }

  try {
    await withAuditTransaction(current.user, async (conn) => {
      await query('DELETE FROM wiki_access_grants WHERE id = ?', [grantId], conn)
    })

    invalidateWikiAccess(event)
    return { ok: true }
  } catch (err: any) {
    return internalError('Failed to remove wiki access grant', err)
  }
})
