import { PAGES } from '~/config/pages'
import type { AppPage, PageName } from '~/types/page'

export const usePageAccess = () => {
  const { user, hasPermission, hasAllPermissions, canOpenSubdivisionLeadership } = useAuth()

  function findPage(name: string): AppPage | undefined {
    return Object.hasOwn(PAGES, name) ? PAGES[name] : undefined
  }

  /** Whether the signed-in user may open the page (ignores guest pages and the forced password change). */
  function canOpenPage(page: AppPage) {
    if (!user.value) return false
    if (!page.permissions.length) return true
    if (page.allowSubdivisionLeaders && canOpenSubdivisionLeadership()) return true
    return page.requireAllPermissions ? hasAllPermissions(page.permissions) : hasPermission(page.permissions)
  }

  /** Home if the user may open it, otherwise the first main page they can reach. */
  function firstAccessiblePage(): PageName | null {
    const home = findPage('Home')
    if (home && canOpenPage(home)) return 'Home'
    const entry = Object.entries(PAGES).find(([, page]) => page.main && !page.allowGuest && canOpenPage(page))
    return entry ? entry[0] : null
  }

  return { findPage, canOpenPage, firstAccessiblePage }
}
