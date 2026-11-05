import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getSpaceEffectiveLevel, getWikiAccess, levelAtLeast } from '~/server/utils/wiki/access'
import { loadScopeGrants } from '~/server/utils/wiki/grants'
import type { WikiScopeAccessResponse } from '~/server/api/wiki/articles/[id]/access.get'
import type { WikiAccessLevel } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export default defineEventHandler(async (event): Promise<WikiScopeAccessResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const spaceId = Number(event.context.params?.id)
  if (!Number.isInteger(spaceId) || spaceId <= 0) return { ok: false, error: 'Der Bereich wurde nicht gefunden.' }

  const { index, subjects } = await getWikiAccess(event, current.user)
  if (!index.spaceIds.has(spaceId)) return { ok: false, error: 'Der Bereich wurde nicht gefunden.' }

  const level = getSpaceEffectiveLevel(index, subjects, spaceId)
  if (level === 'none') return { ok: false, error: 'Der Bereich wurde nicht gefunden.' }

  try {
    return {
      ok: true,
      grants: await loadScopeGrants(index, 'space', spaceId),
      accessLevel: level as WikiAccessLevel,
      canManage: subjects.canManage || levelAtLeast(level, 'admin'),
    }
  } catch (err: any) {
    return internalError('Failed to load wiki access grants', err)
  }
})
