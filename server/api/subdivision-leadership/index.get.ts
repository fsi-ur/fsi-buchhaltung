import { defineEventHandler } from 'h3'
import { requireAuth } from '~/server/utils/api/guards'
import {
  getUserSubdivisionPermissions,
  loadLeaderAssignablePositions,
  loadLeadershipSubdivisions,
} from '~/server/utils/subdivisionLeadership'
import { canOpenLeadershipPage } from '~/shared/subdivisionAccess'
import type { LeadershipPositionOption, LeadershipSubdivision } from '~/types/subdivisionLeadership'

interface GetLeadershipSuccess {
  ok: true
  subdivisions: LeadershipSubdivision[]
  assignable_positions: LeadershipPositionOption[]
}

interface GetLeadershipError {
  ok: false
  error: string
}

export type GetLeadershipResponse = GetLeadershipSuccess | GetLeadershipError

export default defineEventHandler(async (event): Promise<GetLeadershipResponse> => {
  const current = await requireAuth(event)
  if (!current.ok) return current

  const scoped = await getUserSubdivisionPermissions(Number(current.user.id))
  if (!canOpenLeadershipPage(current.user.permissions, scoped)) return { ok: false, error: 'Not authorized' }

  const [subdivisions, assignablePositions] = await Promise.all([
    loadLeadershipSubdivisions(current.user, scoped),
    loadLeaderAssignablePositions(),
  ])

  return { ok: true, subdivisions, assignable_positions: assignablePositions }
})
