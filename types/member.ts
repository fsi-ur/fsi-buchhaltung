export enum MemberStatus {
  Active = 'active',
  Passive = 'passive',
  Hold = 'hold',
  Left = 'left',
}

export interface MemberListItem {
  id: number
  first_name: string
  last_name: string
  birthdate: string
  status: MemberStatus
  honorary: boolean
  subject_name: string | null
  joined_at: string
  left_at: string | null
  has_account?: boolean | null
  account_is_active?: boolean | null
}

export type MemberExportDataColumnKey =
  | 'last_name'
  | 'first_name'
  | 'birthdate'
  | 'subject'
  | 'status'
  | 'email'
  | 'phone'
  | 'address'
  | 'joined_at'
  | 'left_at'

export type MemberExportColumnKey = MemberExportDataColumnKey | 'blank'

export interface MemberExportColumn {
  key: MemberExportColumnKey
  label: string
  /** Small secondary line below the column label, e.g. "(wenn anwesend)". */
  hint?: string
}

export interface MemberExportConfig {
  title: string
  columns: MemberExportColumn[]
  statuses: MemberStatus[]
}

export interface MemberSpotlightStats {
  total: number
  active: number
  passive: number
  hold: number
  left: number
  honorary: number
  active_accounts: number | null
  inactive_accounts: number | null
}

export interface MemberBirthday {
  id: number
  first_name: string
  last_name: string
  full_name: string
  birthdate: string
  subject_name: string | null
  status: MemberStatus
  days_until: number
  turning_age: number
}

export interface MemberPositionAssignment {
  id?: number
  position_id: number
  since: string
  until: string | null
}

export interface MemberStatusActionAccountChange {
  id: number
  username: string
}

export interface MemberStatusActionSubdivisionChange {
  id: number
  label: string
}

export interface MemberStatusActionPositionClose {
  id: number
  label: string
  since: string
  previous_until: string | null
  until: string
}

export interface MemberStatusActionPositionRemoval {
  id: number
  label: string
  since: string
  until: string | null
}

export interface MemberStatusActionSummary {
  left_at: string
  account_deactivated: MemberStatusActionAccountChange | null
  removed_subdivisions: MemberStatusActionSubdivisionChange[]
  closed_positions: MemberStatusActionPositionClose[]
  removed_positions: MemberStatusActionPositionRemoval[]
}

export interface NewMemberAccount {
  username: string
  password: string
  is_active: boolean
  must_change_password?: boolean
}

export interface MemberSubdivisionAssignment {
  id: number
  code: string
  name: string
  is_active: boolean
}

export interface Member {
  id: number
  account: number | null
  last_name: string
  first_name: string
  birthdate: string
  street: string
  street_number: string
  postal_code: string
  city: string
  subject: number
  subject_name: string
  phone: string
  email: string
  notes: string | null
  status: MemberStatus
  honorary: boolean
  applied_at: string
  joined_at: string
  left_at: string | null
  positions: MemberPositionAssignment[]
  subdivisions?: MemberSubdivisionAssignment[]
}

export interface SaveMemberBody {
  account?: number | null
  new_account?: NewMemberAccount | null
  last_name: string
  first_name: string
  birthdate: string
  street: string
  street_number: string
  postal_code: string
  city: string
  subject_name: string
  phone: string
  email: string
  notes?: string | null
  status: MemberStatus
  honorary: boolean
  applied_at: string
  joined_at: string
  left_at?: string | null
  positions: MemberPositionAssignment[]
  subdivision_ids?: number[]
  send_welcome_mail?: boolean
}
