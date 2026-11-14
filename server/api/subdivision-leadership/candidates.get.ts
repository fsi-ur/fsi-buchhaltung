import { defineEventHandler, getQuery } from 'h3'
import { loadLeadershipCandidates, requireSubdivisionPermission } from '~/server/utils/subdivisionLeadership'
import type { LeadershipCandidate } from '~/types/subdivisionLeadership'

interface GetCandidatesSuccess {
  ok: true
  members: LeadershipCandidate[]
}

interface GetCandidatesError {
  ok: false
  error: string
}

export type GetLeadershipCandidatesResponse = GetCandidatesSuccess | GetCandidatesError

export default defineEventHandler(async (event): Promise<GetLeadershipCandidatesResponse> => {
  const subdivisionId = Number(getQuery(event).subdivisionId)
  const current = await requireSubdivisionPermission(event, 'subdivision.members.manage', subdivisionId)
  if (!current.ok) return current

  return { ok: true, members: await loadLeadershipCandidates(subdivisionId) }
})
