import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { loadPathsForAdmin } from '~/server/utils/wiki/paths'
import type { WikiPathAdminView } from '~/types/wiki'
import { internalError } from '~/server/utils/api/errors'

export type WikiPathManageResponse =
  | { ok: true, paths: WikiPathAdminView[] }
  | { ok: false, error: string }

export default defineEventHandler(async (event): Promise<WikiPathManageResponse> => {
  const current = await requirePermission(event, 'wiki.manage')
  if (!current.ok) return current

  try {
    return { ok: true, paths: await loadPathsForAdmin() }
  } catch (err: any) {
    return internalError('Failed to load the wiki learning paths', err)
  }
})
