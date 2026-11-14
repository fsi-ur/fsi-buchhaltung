import type { PermissionKey } from '~/config/permissions'
import type { Component } from 'vue'
import { PAGES } from '~/config/pages'

export type AppPage = MainPage | SubPage

interface PageAccess {
  /**
   * Also open to subdivision leaders (anyone holding a scoped permission in some subdivision),
   * in addition to the global `permissions`.
   */
  allowSubdivisionLeaders?: boolean
}

interface MainPage extends PageAccess {
  main: true
  labelKey: string
  component: Component
  icon: string
  permissions: PermissionKey[]
  requireAllPermissions?: boolean
  allowGuest?: boolean
  preserveOnRefresh?: boolean
}

interface SubPage extends PageAccess {
  main: false
  labelKey: string
  component: Component
  permissions: PermissionKey[]
  requireAllPermissions?: boolean
  allowGuest?: boolean
  preserveOnRefresh?: boolean
}

export type PageName = keyof typeof PAGES

export interface PageTarget {
  page: PageName
  meta?: Record<string, any> | null
}
