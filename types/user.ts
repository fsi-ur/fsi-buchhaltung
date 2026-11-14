import type { PermissionKey } from '~/config/permissions'
import type { SubdivisionPermissionMap } from '~/config/subdivisionPermissions'

export interface User {
  id: number
  username: string
  roles: number[]
  permissions: PermissionKey[]
  /**
   * Scoped permissions per subdivision, from the user's current subdivision-bound positions. Only
   * filled by the session endpoint for the client; server checks always re-read them
   * (server/utils/subdivisionLeadership.ts).
   */
  subdivision_permissions?: SubdivisionPermissionMap
  is_active: boolean
  must_change_password: boolean
}

export interface UserRow {
  id: number
  username: string
  password_hash: string
  is_active: number
  must_change_password: number
}
