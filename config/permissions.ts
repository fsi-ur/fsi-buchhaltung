export type PermissionKey = 
  | 'cash_register.use'
  | 'cash_register.manage'
  | 'pages.home.view'
  | 'members.view'
  | 'members.edit'
  | 'members.editOwnData'
  | 'members.approveChanges'
  | 'members.configureSelfEditFields'
  | 'subjects.view'
  | 'subjects.edit'
  | 'positions.view'
  | 'receipts.view'
  | 'receipts.edit'
  | 'invoices.view'
  | 'invoices.edit'
  | 'reimbursements.view'
  | 'reimbursements.edit'
  | 'cash_counts.view'
  | 'cash_counts.edit'
  | 'budgets.view'
  | 'budgets.edit'
  | 'events.access'
  | 'events.view'
  | 'events.shifts.signup'
  | 'events.edit'
  | 'companies.view'
  | 'companies.edit'
  | 'spheres.view'
  | 'cost_centres.view'
  | 'subdivisions.view'
  | 'settings.access'
  | 'settings.spheres.manage'
  | 'settings.association.manage'
  | 'settings.cost_centres.manage'
  | 'settings.subdivisions.manage'
  | 'settings.positions.manage'
  | 'settings.viewAs'
  | 'settings.app.access'
  | 'settings.app.snapshots.manage'
  | 'permissions.manage'
  | 'files.view'
  | 'users.view'
  | 'users.manage'
  | 'bank_statements.view'
  | 'bank_statements.edit'
  | 'notifications.view'
  | 'notifications.send'
  | 'settings.notifications.manage'
  | 'documents.view'
  | 'settings.documents.manage'
  | 'wiki.view'
  | 'wiki.edit'
  | 'wiki.review'
  | 'wiki.manage'
  | 'audit.view'
  | 'audit.viewAll'
  | 'calendar.view'
  | 'calendar.create'
  | 'calendar.manage'

export interface PermissionDefinition {
  key: PermissionKey
  labelKey: string
  descriptionKey?: string
  categoryKey: string
}

export const PERMISSIONS: PermissionDefinition[] = [
  { key: 'cash_register.use', labelKey: 'permissions.items.cashRegisterUse', categoryKey: 'permissions.categories.apps' },
  { key: 'cash_register.manage', labelKey: 'permissions.items.cashRegisterManage', categoryKey: 'permissions.categories.apps' },
  { key: 'pages.home.view', labelKey: 'permissions.items.pagesHomeView', categoryKey: 'permissions.categories.pages' },
  { key: 'members.view', labelKey: 'permissions.items.membersView', categoryKey: 'permissions.categories.members' },
  { key: 'members.edit', labelKey: 'permissions.items.membersEdit', categoryKey: 'permissions.categories.members' },
  { key: 'members.editOwnData', labelKey: 'permissions.items.membersEditOwnData', categoryKey: 'permissions.categories.members' },
  { key: 'members.approveChanges', labelKey: 'permissions.items.membersApproveChanges', categoryKey: 'permissions.categories.members' },
  { key: 'members.configureSelfEditFields', labelKey: 'permissions.items.membersConfigureSelfEditFields', categoryKey: 'permissions.categories.members' },
  { key: 'subjects.view', labelKey: 'permissions.items.subjectsView', categoryKey: 'permissions.categories.members' },
  { key: 'subjects.edit', labelKey: 'permissions.items.subjectsEdit', categoryKey: 'permissions.categories.members' },
  { key: 'positions.view', labelKey: 'permissions.items.positionsView', categoryKey: 'permissions.categories.members' },
  { key: 'receipts.view', labelKey: 'permissions.items.receiptsView', categoryKey: 'permissions.categories.receipts' },
  { key: 'receipts.edit', labelKey: 'permissions.items.receiptsEdit', categoryKey: 'permissions.categories.receipts' },
  { key: 'invoices.view', labelKey: 'permissions.items.invoicesView', categoryKey: 'permissions.categories.invoices' },
  { key: 'invoices.edit', labelKey: 'permissions.items.invoicesEdit', categoryKey: 'permissions.categories.invoices' },
  { key: 'reimbursements.view', labelKey: 'permissions.items.reimbursementsView', categoryKey: 'permissions.categories.reimbursements' },
  { key: 'reimbursements.edit', labelKey: 'permissions.items.reimbursementsEdit', categoryKey: 'permissions.categories.reimbursements' },
  { key: 'cash_counts.view', labelKey: 'permissions.items.cashCountsView', categoryKey: 'permissions.categories.cashCounts' },
  { key: 'cash_counts.edit', labelKey: 'permissions.items.cashCountsEdit', categoryKey: 'permissions.categories.cashCounts' },
  { key: 'budgets.view', labelKey: 'permissions.items.budgetsView', categoryKey: 'permissions.categories.budgets' },
  { key: 'budgets.edit', labelKey: 'permissions.items.budgetsEdit', categoryKey: 'permissions.categories.budgets' },
  { key: 'events.access', labelKey: 'permissions.items.eventsAccess', categoryKey: 'permissions.categories.events' },
  { key: 'events.view', labelKey: 'permissions.items.eventsView', categoryKey: 'permissions.categories.events' },
  { key: 'events.shifts.signup', labelKey: 'permissions.items.eventsShiftsSignup', categoryKey: 'permissions.categories.events' },
  { key: 'events.edit', labelKey: 'permissions.items.eventsEdit', categoryKey: 'permissions.categories.events' },
  { key: 'companies.view', labelKey: 'permissions.items.companiesView', categoryKey: 'permissions.categories.companies' },
  { key: 'companies.edit', labelKey: 'permissions.items.companiesEdit', categoryKey: 'permissions.categories.companies' },
  { key: 'spheres.view', labelKey: 'permissions.items.spheresView', categoryKey: 'permissions.categories.settings' },
  { key: 'cost_centres.view', labelKey: 'permissions.items.costCentresView', categoryKey: 'permissions.categories.settings' },
  { key: 'subdivisions.view', labelKey: 'permissions.items.subdivisionsView', categoryKey: 'permissions.categories.settings' },
  { key: 'settings.access', labelKey: 'permissions.items.settingsAccess', categoryKey: 'permissions.categories.settings' },
  { key: 'settings.association.manage', labelKey: 'permissions.items.settingsAssociationManage', categoryKey: 'permissions.categories.settings' },
  { key: 'settings.spheres.manage', labelKey: 'permissions.items.settingsSpheresManage', categoryKey: 'permissions.categories.settings' },
  { key: 'settings.cost_centres.manage', labelKey: 'permissions.items.settingsCostCentresManage', categoryKey: 'permissions.categories.settings' },
  { key: 'settings.subdivisions.manage', labelKey: 'permissions.items.settingsSubdivisionsManage', categoryKey: 'permissions.categories.settings' },
  { key: 'settings.positions.manage', labelKey: 'permissions.items.settingsPositionsManage', categoryKey: 'permissions.categories.settings' },
  { key: 'settings.viewAs', labelKey: 'permissions.items.settingsViewAs', categoryKey: 'permissions.categories.settings' },
  { key: 'settings.app.access', labelKey: 'permissions.items.settingsAppAccess', categoryKey: 'permissions.categories.settings' },
  { key: 'settings.app.snapshots.manage', labelKey: 'permissions.items.settingsAppSnapshotsManage', categoryKey: 'permissions.categories.settings' },
  { key: 'permissions.manage', labelKey: 'permissions.items.permissionsManage', categoryKey: 'permissions.categories.settings' },
  { key: 'files.view', labelKey: 'permissions.items.filesView', categoryKey: 'permissions.categories.files' },
  { key: 'users.view', labelKey: 'permissions.items.usersView', categoryKey: 'permissions.categories.users' },
  { key: 'users.manage', labelKey: 'permissions.items.usersManage', categoryKey: 'permissions.categories.users' },
  { key: 'bank_statements.view', labelKey: 'permissions.items.bankStatementsView', categoryKey: 'permissions.categories.bankStatements' },
  { key: 'bank_statements.edit', labelKey: 'permissions.items.bankStatementsEdit', categoryKey: 'permissions.categories.bankStatements' },
  { key: 'notifications.view', labelKey: 'permissions.items.notificationsView', categoryKey: 'permissions.categories.notifications' },
  { key: 'notifications.send', labelKey: 'permissions.items.notificationsSend', categoryKey: 'permissions.categories.notifications' },
  { key: 'settings.notifications.manage', labelKey: 'permissions.items.settingsNotificationsManage', categoryKey: 'permissions.categories.notifications' },
  { key: 'documents.view', labelKey: 'permissions.items.documentsView', categoryKey: 'permissions.categories.documents' },
  { key: 'settings.documents.manage', labelKey: 'permissions.items.settingsDocumentsManage', categoryKey: 'permissions.categories.documents' },
  { key: 'wiki.view', labelKey: 'permissions.items.wikiView', categoryKey: 'permissions.categories.wiki' },
  { key: 'wiki.edit', labelKey: 'permissions.items.wikiEdit', categoryKey: 'permissions.categories.wiki' },
  { key: 'wiki.review', labelKey: 'permissions.items.wikiReview', categoryKey: 'permissions.categories.wiki' },
  { key: 'wiki.manage', labelKey: 'permissions.items.wikiManage', categoryKey: 'permissions.categories.wiki' },
  { key: 'audit.view', labelKey: 'permissions.items.auditView', categoryKey: 'permissions.categories.audit' },
  { key: 'audit.viewAll', labelKey: 'permissions.items.auditViewAll', categoryKey: 'permissions.categories.audit' },
  { key: 'calendar.view', labelKey: 'permissions.items.calendarView', categoryKey: 'permissions.categories.calendar' },
  { key: 'calendar.create', labelKey: 'permissions.items.calendarCreate', categoryKey: 'permissions.categories.calendar' },
  { key: 'calendar.manage', labelKey: 'permissions.items.calendarManage', categoryKey: 'permissions.categories.calendar' },
]

export const implied: Partial<Record<PermissionKey, PermissionKey[]>> = {
  'cash_register.manage': ['cash_register.use'],
  'members.edit': ['members.view', 'members.approveChanges'],
  'receipts.edit': ['receipts.view'],
  'invoices.edit': ['invoices.view'],
  'reimbursements.edit': ['reimbursements.view'],
  'cash_counts.edit': ['cash_counts.view'],
  'budgets.view': ['cost_centres.view'],
  'budgets.edit': ['budgets.view'],
  'events.view': ['events.access'],
  'events.shifts.signup': ['events.access'],
  'events.edit': ['events.view', 'events.access'],
  'companies.edit': ['companies.view'],
  'settings.association.manage': ['settings.access'],
  'subjects.edit': ['subjects.view'],
  'settings.spheres.manage': ['spheres.view', 'settings.access'],
  'settings.cost_centres.manage': ['cost_centres.view', 'settings.access'],
  'settings.subdivisions.manage': ['subdivisions.view', 'settings.access'],
  'settings.positions.manage': ['positions.view', 'settings.access'],
  'settings.viewAs': ['settings.access'],
  'settings.app.access': ['settings.access'],
  'settings.app.snapshots.manage': ['settings.app.access'],
  'permissions.manage': ['settings.access', 'users.view'],
  'users.manage': ['users.view'],
  'bank_statements.edit': ['bank_statements.view'],
  'notifications.send': ['notifications.view'],
  'settings.notifications.manage': ['settings.access'],
  'settings.documents.manage': ['documents.view', 'settings.access'],
  'wiki.edit': ['wiki.view'],
  'wiki.review': ['wiki.edit', 'wiki.view'],
  'wiki.manage': ['wiki.review', 'wiki.edit', 'wiki.view'],
  'audit.viewAll': ['audit.view'],
  'calendar.create': ['calendar.view'],
  'calendar.manage': ['calendar.create', 'calendar.view'],
}
