import type { PermissionKey } from '~/config/permissions'

export interface SettingsTabDef {
  key: string
  labelKey: string
  permission?: PermissionKey | PermissionKey[]
}

export const SETTINGS_TABS: SettingsTabDef[] = [
  { key: 'general', labelKey: 'settings.tabs.general' },
  { key: 'association', labelKey: 'settings.tabs.association', permission: 'settings.association.manage' },
  { key: 'spheres', labelKey: 'settings.tabs.spheres', permission: 'settings.spheres.manage' },
  { key: 'costCentres', labelKey: 'settings.tabs.costCentres', permission: 'settings.cost_centres.manage' },
  { key: 'subdivisions', labelKey: 'settings.tabs.subdivisions', permission: 'settings.subdivisions.manage' },
  { key: 'positions', labelKey: 'settings.tabs.positions', permission: 'settings.positions.manage' },
  { key: 'appointmentTypes', labelKey: 'settings.tabs.appointmentTypes', permission: 'calendar.manage' },
  { key: 'users', labelKey: 'settings.tabs.users', permission: 'users.manage' },
  { key: 'permissions', labelKey: 'settings.tabs.permissions', permission: ['permissions.manage', 'settings.viewAs'] },
  { key: 'app', labelKey: 'settings.tabs.app', permission: 'settings.app.access' },
  { key: 'notifications', labelKey: 'settings.tabs.notifications', permission: 'settings.notifications.manage' },
  { key: 'documents', labelKey: 'settings.tabs.documents', permission: ['settings.documents.manage', 'documents.view'] },
  { key: 'audit', labelKey: 'settings.tabs.audit', permission: 'audit.view' },
]
