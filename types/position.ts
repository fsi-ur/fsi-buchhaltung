export interface SavePositionAssignmentBody {
  id?: number
  member_id: number
  since: string
  until: string | null
  /** Required exactly when the position is subdivision-bound. */
  subdivision_id?: number | null
}

export interface SavePositionBody {
  id?: number
  code: string
  name: string
  is_active?: boolean
  description?: string
  subdivision_bound?: boolean
  assignable_by_leaders?: boolean
  assignments?: SavePositionAssignmentBody[]
}

export interface PositionMemberAssignment extends SavePositionAssignmentBody {
  full_name: string
  subdivision_name?: string | null
}

export interface PositionMemberOption {
  id: number
  full_name: string
}

export interface PositionRow {
  id: number
  code: string
  name: string
  is_active: boolean
  description: string
  subdivision_bound: boolean
  assignable_by_leaders: boolean
  assignments?: PositionMemberAssignment[]
}
