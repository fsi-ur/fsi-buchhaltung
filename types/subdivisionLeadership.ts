import type { SubdivisionPermissionKey } from '~/config/subdivisionPermissions'
import type { MemberStatus } from '~/types/member'

export interface LeadershipMember {
  id: number
  full_name: string
  subject_name: string | null
  email: string | null
  phone: string | null
  status: MemberStatus
  /** The member linked to the signed-in user — they cannot remove themselves. */
  is_self: boolean
}

export interface LeadershipAssignment {
  id: number
  member_id: number
  member_name: string
  position_id: number
  position_name: string
  since: string
  until: string | null
  /** The position may be handed out by leaders — only those assignments are editable here. */
  assignable_by_leaders: boolean
  is_self: boolean
}

export interface LeadershipSubdivision {
  id: number
  code: string
  name: string
  description: string | null
  /** Scoped permissions the signed-in user holds here (all of them with subdivisions.leadership.edit). */
  permissions: SubdivisionPermissionKey[]
  members: LeadershipMember[]
  assignments: LeadershipAssignment[]
}

export interface LeadershipPositionOption {
  id: number
  code: string
  name: string
}

export interface LeadershipCandidate {
  id: number
  full_name: string
  subject_name: string | null
  email: string | null
  phone: string | null
}

/** What leaders and admins are told about (notification payload `leader_action`). */
export type LeadershipAction = 'member_added' | 'member_removed' | 'position_assigned' | 'position_changed' | 'position_ended'
