import type { SessionResponse } from '~/server/utils/sessionGuard'
import type { LoginResponse } from '~/server/api/auth/login.post'
import type { User } from '~/types/user'
import type { PermissionKey } from '~/config/permissions'

export const useAuth = () => {
  const user = useState<User | null>('auth_user', () => null)

  function redirectToLogin() {
    user.value = null

    if (!import.meta.client) return

    const { currentPage, setPage } = usePage()
    if (currentPage.value !== 'Login') setPage('Login')
  }

  async function fetchSession() {
    try {
      const data = await apiFetch<SessionResponse>('/api/auth/session')
      if (data.ok) {
        user.value = data.user
        return user.value
      } else {
        redirectToLogin()
        return null
      }
    } catch (err: any) {
      redirectToLogin()
      return null
    }
  }

  async function login(username: string, password: string): Promise<LoginResponse> {
    try {
      const res = await apiFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: { username, password }
      })

      if (res.ok) {
        await fetchSession()
        if (!user.value) {
          return { ok: false, error: 'Session cookie was not established', code: 'session_not_established' }
        }
        return res
      }

      return res
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Network error', code: 'network_error' }
    }
  }

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    redirectToLogin()
  }

  function effectivePermissions(): PermissionKey[] {
    if (!user.value) return []
    const { simulation } = useViewAsSimulation()
    return simulation.value ? simulation.value.permissions : user.value.permissions
  }

  function hasPermission(permissions: PermissionKey[] | PermissionKey) {
    if (!user.value) return false
    const granted = effectivePermissions()
    if (Array.isArray(permissions)) return permissions.some(p => granted.includes(p))
    return granted.includes(permissions)
  }

  function hasAllPermissions(permissions: PermissionKey[]) {
    if (!user.value) return false
    const granted = effectivePermissions()
    return permissions.every(p => granted.includes(p))
  }

  function isSimulating() {
    const { simulation } = useViewAsSimulation()
    return !!simulation.value
  }

  function resolveFlag(realFlag: boolean, permissions: PermissionKey[] | PermissionKey) {
    return isSimulating() ? hasPermission(permissions) : realFlag
  }

  return { user, fetchSession, login, logout, redirectToLogin, hasPermission, hasAllPermissions, isSimulating, resolveFlag }
}
