import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getEffectiveLevel, getWikiAccess, levelAtLeast } from '~/server/utils/wiki/access'
import { loadScopeGrants, type GrantView } from '~/server/utils/wiki/grants'
import type { WikiAccessLevel } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export type WikiScopeAccessResponse =
  | { ok: true, grants: GrantView[], accessLevel: WikiAccessLevel, canManage: boolean }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<WikiScopeAccessResponse> => {
  const current = await requirePermission(event, 'wiki.view')
  if (!current.ok) return current

  const articleId = Number(event.context.params?.id)
  if (!Number.isInteger(articleId) || articleId <= 0) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const { index, subjects } = await getWikiAccess(event, current.user)
  if (!index.articles.has(articleId)) return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  const level = getEffectiveLevel(index, subjects, articleId)
  if (level === 'none') return { ok: false, error: 'Der Artikel wurde nicht gefunden.' }

  try {
    return {
      ok: true,
      grants: await loadScopeGrants(index, 'article', articleId),
      accessLevel: level as WikiAccessLevel,
      canManage: subjects.canManage || levelAtLeast(level, 'admin'),
    }
  } catch (err: any) {
    return internalError('Failed to load wiki access grants', err)
  }
})
