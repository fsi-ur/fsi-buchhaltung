import { defineEventHandler } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { listUsersWithActivity, type UserListRow } from '~/server/utils/userAccounts'

interface GetUsersSuccess {
  ok: true
  users: UserListRow[]
}

interface GetUsersError {
  ok: false
  error: string
}

type GetUsersResponse = GetUsersSuccess | GetUsersError

export default defineEventHandler(async (event): Promise<GetUsersResponse> => {
  const current = await requirePermission(event, ['users.view', 'users.manage'])
  if (!current.ok) return current

  return { ok: true, users: await listUsersWithActivity() }
})
