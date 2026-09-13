import type { PermissionKey } from '~/config/permissions'
import type { User } from '~/types/user'
import { hasPermission } from '~/server/utils/api/guards'

export type AuditDomain = 'finances' | 'members' | 'events' | 'settings' | 'wiki' | 'notifications' | 'security' | 'calendar'

export interface AuditReferenceDefinition {
  table: string
  labelColumns: string[]
}

export interface AuditTableDefinition {
  table: string
  /** i18n key for the entity name, singular, e.g. 'audit.entities.member' */
  labelKey: string
  domain: AuditDomain
  /** Without at least one of these permissions the entry is invisible (in addition to audit.view) */
  viewPermissions: PermissionKey[]
  /** true → additionally requires audit.viewAll */
  restricted?: boolean
  /** Subordinate to a parent table: entries show up in the parent's history too */
  parent?: { table: string, foreignKey: string }
  /** Columns that never go to the client */
  redactedColumns?: string[]
  /** Columns ignored in the diff (noise) */
  ignoredColumns?: string[]
  /** Resolution of FK columns to readable labels */
  references?: Record<string, AuditReferenceDefinition>
  /** Short description of the record for the list view, derived from the state JSON */
  describe?: (state: Record<string, any>) => string | null
  /** Navigation target in the SPA, if any */
  openPage?: { page: string, metaKey: string }
}

const MEMBER_REF: AuditReferenceDefinition = { table: 'members', labelColumns: ['first_name', 'last_name'] }
const USER_REF: AuditReferenceDefinition = { table: 'users', labelColumns: ['username'] }
const COMPANY_REF: AuditReferenceDefinition = { table: 'companies', labelColumns: ['name'] }
const COST_CENTRE_REF: AuditReferenceDefinition = { table: 'cost_centres', labelColumns: ['name'] }
const SPHERE_REF: AuditReferenceDefinition = { table: 'spheres', labelColumns: ['name'] }
const SUBDIVISION_REF: AuditReferenceDefinition = { table: 'subdivisions', labelColumns: ['name'] }
const POSITION_REF: AuditReferenceDefinition = { table: 'positions', labelColumns: ['name'] }
const EVENT_REF: AuditReferenceDefinition = { table: 'events', labelColumns: ['name'] }
const RECEIPT_REF: AuditReferenceDefinition = { table: 'receipts', labelColumns: ['receipt_number'] }
const INVOICE_REF: AuditReferenceDefinition = { table: 'invoices', labelColumns: ['invoice_number'] }
const SUBJECT_REF: AuditReferenceDefinition = { table: 'subjects', labelColumns: ['name'] }
const ASSOCIATION_DOCUMENT_REF: AuditReferenceDefinition = { table: 'association_documents', labelColumns: ['title'] }
const WIKI_ARTICLE_REF: AuditReferenceDefinition = { table: 'wiki_articles', labelColumns: ['title'] }
const WIKI_SPACE_REF: AuditReferenceDefinition = { table: 'wiki_spaces', labelColumns: ['title'] }
const ASSOCIATION_PROFILE_REF: AuditReferenceDefinition = { table: 'association_profiles', labelColumns: ['name'] }

export const AUDIT_TABLES: Record<string, AuditTableDefinition> = {
  // --- finances ---------------------------------------------------------
  receipts: {
    table: 'receipts',
    labelKey: 'audit.entities.receipt',
    domain: 'finances',
    viewPermissions: ['receipts.view'],
    references: { company_id: COMPANY_REF },
    describe: state => state.receipt_number ? `#${state.receipt_number}` : null,
    openPage: { page: 'ReceiptCreate', metaKey: 'receiptId' },
  },
  receipt_positions: {
    table: 'receipt_positions',
    labelKey: 'audit.entities.receiptPosition',
    domain: 'finances',
    viewPermissions: ['receipts.view'],
    parent: { table: 'receipts', foreignKey: 'receipt_id' },
    references: { cost_centre: COST_CENTRE_REF, sphere: SPHERE_REF },
  },
  invoices: {
    table: 'invoices',
    labelKey: 'audit.entities.invoice',
    domain: 'finances',
    viewPermissions: ['invoices.view'],
    references: { company_id: COMPANY_REF },
    describe: state => state.invoice_number ? `#${state.invoice_number}` : null,
    openPage: { page: 'InvoiceCreate', metaKey: 'invoiceId' },
  },
  invoice_positions: {
    table: 'invoice_positions',
    labelKey: 'audit.entities.invoicePosition',
    domain: 'finances',
    viewPermissions: ['invoices.view'],
    parent: { table: 'invoices', foreignKey: 'invoice_id' },
    references: { cost_centre: COST_CENTRE_REF, sphere: SPHERE_REF },
  },
  reimbursements: {
    table: 'reimbursements',
    labelKey: 'audit.entities.reimbursement',
    domain: 'finances',
    viewPermissions: ['reimbursements.view'],
    references: { paid_by: MEMBER_REF, checked_by: MEMBER_REF, disbursed_by: MEMBER_REF },
    describe: state => state.account_holder || null,
    openPage: { page: 'ReimbursementCreate', metaKey: 'reimbursementId' },
  },
  reimbursement_positions: {
    table: 'reimbursement_positions',
    labelKey: 'audit.entities.reimbursementPosition',
    domain: 'finances',
    viewPermissions: ['reimbursements.view'],
    parent: { table: 'reimbursements', foreignKey: 'reimbursement_id' },
    references: { receipt_id: RECEIPT_REF },
  },
  cash_counts: {
    table: 'cash_counts',
    labelKey: 'audit.entities.cashCount',
    domain: 'finances',
    viewPermissions: ['cash_counts.view'],
    references: { event_id: EVENT_REF, counted_by_first: MEMBER_REF, counted_by_second: MEMBER_REF, checked_by: MEMBER_REF },
    openPage: { page: 'CashCountCreate', metaKey: 'cashCountId' },
  },
  cash_count_positions: {
    table: 'cash_count_positions',
    labelKey: 'audit.entities.cashCountPosition',
    domain: 'finances',
    viewPermissions: ['cash_counts.view'],
    parent: { table: 'cash_counts', foreignKey: 'cash_count_id' },
  },
  budgets: {
    table: 'budgets',
    labelKey: 'audit.entities.budget',
    domain: 'finances',
    viewPermissions: ['budgets.view'],
    describe: state => state.start_date && state.end_date ? `${state.start_date} – ${state.end_date}` : null,
    openPage: { page: 'BudgetCreate', metaKey: 'budgetId' },
  },
  budget_cost_centre_lines: {
    table: 'budget_cost_centre_lines',
    labelKey: 'audit.entities.budgetCostCentreLine',
    domain: 'finances',
    viewPermissions: ['budgets.view'],
    parent: { table: 'budgets', foreignKey: 'budget_id' },
    references: { cost_centre_id: COST_CENTRE_REF },
  },
  bank_statements: {
    table: 'bank_statements',
    labelKey: 'audit.entities.bankStatement',
    domain: 'finances',
    viewPermissions: ['bank_statements.view'],
    references: { checked_by: MEMBER_REF },
    describe: state => state.statement_number ? `#${state.statement_number}` : null,
    openPage: { page: 'BankStatementCreate', metaKey: 'bankStatementId' },
  },
  bank_statement_positions: {
    table: 'bank_statement_positions',
    labelKey: 'audit.entities.bankStatementPosition',
    domain: 'finances',
    viewPermissions: ['bank_statements.view'],
    parent: { table: 'bank_statements', foreignKey: 'bank_statement_id' },
    references: { receipt_id: RECEIPT_REF, invoice_id: INVOICE_REF, event_id: EVENT_REF },
  },
  companies: {
    table: 'companies',
    labelKey: 'audit.entities.company',
    domain: 'finances',
    viewPermissions: ['companies.view'],
    describe: state => state.name ?? null,
  },

  // --- members ------------------------------------------------------------
  members: {
    table: 'members',
    labelKey: 'audit.entities.member',
    domain: 'members',
    viewPermissions: ['members.view'],
    references: { account: USER_REF, subject: SUBJECT_REF },
    describe: state => (state.first_name || state.last_name) ? `${state.first_name ?? ''} ${state.last_name ?? ''}`.trim() : null,
    openPage: { page: 'MemberCreate', metaKey: 'memberId' },
  },
  member_positions: {
    table: 'member_positions',
    labelKey: 'audit.entities.memberPosition',
    domain: 'members',
    viewPermissions: ['members.view'],
    parent: { table: 'members', foreignKey: 'member_id' },
    references: { member_id: MEMBER_REF, position_id: POSITION_REF },
  },
  member_pending_field_changes: {
    table: 'member_pending_field_changes',
    labelKey: 'audit.entities.memberPendingFieldChange',
    domain: 'members',
    viewPermissions: ['members.approveChanges'],
    parent: { table: 'members', foreignKey: 'member_id' },
    references: { requested_by: USER_REF },
  },
  member_self_edit_field_config: {
    table: 'member_self_edit_field_config',
    labelKey: 'audit.entities.memberSelfEditFieldConfig',
    domain: 'members',
    viewPermissions: ['members.configureSelfEditFields'],
  },
  subjects: {
    table: 'subjects',
    labelKey: 'audit.entities.subject',
    domain: 'members',
    viewPermissions: ['subjects.view'],
    describe: state => state.name ?? null,
  },
  positions: {
    table: 'positions',
    labelKey: 'audit.entities.position',
    domain: 'members',
    viewPermissions: ['positions.view'],
    describe: state => state.name ?? null,
  },
  position_permissions: {
    table: 'position_permissions',
    labelKey: 'audit.entities.positionPermission',
    domain: 'members',
    viewPermissions: ['positions.view'],
    parent: { table: 'positions', foreignKey: 'position_id' },
    references: { position_id: POSITION_REF },
  },

  // --- events ---------------------------------------------------------------
  events: {
    table: 'events',
    labelKey: 'audit.entities.event',
    domain: 'events',
    viewPermissions: ['events.view'],
    describe: state => state.name ?? null,
    openPage: { page: 'EventCreate', metaKey: 'eventId' },
  },
  event_member_organizers: {
    table: 'event_member_organizers',
    labelKey: 'audit.entities.eventMemberOrganizer',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'events', foreignKey: 'event_id' },
    references: { event_id: EVENT_REF, member_id: MEMBER_REF },
  },
  event_subdivision_organizers: {
    table: 'event_subdivision_organizers',
    labelKey: 'audit.entities.eventSubdivisionOrganizer',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'events', foreignKey: 'event_id' },
    references: { event_id: EVENT_REF, subdivision_id: SUBDIVISION_REF },
  },
  event_shift_slots: {
    table: 'event_shift_slots',
    labelKey: 'audit.entities.eventShiftSlot',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'events', foreignKey: 'event_id' },
    references: { event_id: EVENT_REF },
    describe: state => state.name ?? null,
  },
  event_shift_templates: {
    table: 'event_shift_templates',
    labelKey: 'audit.entities.eventShiftTemplate',
    domain: 'events',
    viewPermissions: ['events.view'],
    describe: state => state.name ?? null,
  },
  event_shift_type_descriptions: {
    table: 'event_shift_type_descriptions',
    labelKey: 'audit.entities.eventShiftTypeDescription',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'events', foreignKey: 'event_id' },
    references: { event_id: EVENT_REF },
  },
  event_shift_members: {
    table: 'event_shift_members',
    labelKey: 'audit.entities.eventShiftMember',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'event_shift_slots', foreignKey: 'shift_id' },
    references: { shift_id: { table: 'event_shift_slots', labelColumns: ['name'] }, member_id: MEMBER_REF },
  },
  event_checklist_templates: {
    table: 'event_checklist_templates',
    labelKey: 'audit.entities.eventChecklistTemplate',
    domain: 'events',
    viewPermissions: ['events.view'],
    describe: state => state.title ?? null,
  },
  event_checklist_template_items: {
    table: 'event_checklist_template_items',
    labelKey: 'audit.entities.eventChecklistTemplateItem',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'event_checklist_templates', foreignKey: 'template_id' },
  },
  event_tasks: {
    table: 'event_tasks',
    labelKey: 'audit.entities.eventTask',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'events', foreignKey: 'event_id' },
    references: { event_id: EVENT_REF },
    describe: state => state.title ?? null,
  },
  event_task_members: {
    table: 'event_task_members',
    labelKey: 'audit.entities.eventTaskMember',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'event_tasks', foreignKey: 'task_id' },
    references: { task_id: { table: 'event_tasks', labelColumns: ['title'] }, member_id: MEMBER_REF },
  },
  event_task_subdivisions: {
    table: 'event_task_subdivisions',
    labelKey: 'audit.entities.eventTaskSubdivision',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'event_tasks', foreignKey: 'task_id' },
    references: { task_id: { table: 'event_tasks', labelColumns: ['title'] }, subdivision_id: SUBDIVISION_REF },
  },
  event_checklists: {
    table: 'event_checklists',
    labelKey: 'audit.entities.eventChecklist',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'events', foreignKey: 'event_id' },
    references: { event_id: EVENT_REF },
    describe: state => state.title ?? null,
  },
  event_checklist_items: {
    table: 'event_checklist_items',
    labelKey: 'audit.entities.eventChecklistItem',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'event_checklists', foreignKey: 'checklist_id' },
    describe: state => state.label ?? null,
  },
  event_cost_centre_splits: {
    table: 'event_cost_centre_splits',
    labelKey: 'audit.entities.eventCostCentreSplit',
    domain: 'events',
    viewPermissions: ['events.view'],
    parent: { table: 'events', foreignKey: 'event_id' },
    references: { event_id: EVENT_REF, sphere_id: SPHERE_REF, cost_centre_id: COST_CENTRE_REF },
  },

  // --- settings -------------------------------------------------------------
  spheres: {
    table: 'spheres',
    labelKey: 'audit.entities.sphere',
    domain: 'settings',
    viewPermissions: ['spheres.view'],
    describe: state => state.name ?? null,
  },
  cost_centres: {
    table: 'cost_centres',
    labelKey: 'audit.entities.costCentre',
    domain: 'settings',
    viewPermissions: ['cost_centres.view'],
    references: { parent_id: COST_CENTRE_REF },
    describe: state => state.name ?? null,
  },
  subdivisions: {
    table: 'subdivisions',
    labelKey: 'audit.entities.subdivision',
    domain: 'settings',
    viewPermissions: ['subdivisions.view'],
    describe: state => state.name ?? null,
  },
  subdivision_members: {
    table: 'subdivision_members',
    labelKey: 'audit.entities.subdivisionMember',
    domain: 'settings',
    viewPermissions: ['subdivisions.view'],
    parent: { table: 'members', foreignKey: 'member_id' },
    references: { subdivision_id: SUBDIVISION_REF, member_id: MEMBER_REF },
  },

  // --- wiki -------------------------------------------------------------------
  wiki_articles: {
    table: 'wiki_articles',
    labelKey: 'audit.entities.wikiArticle',
    domain: 'wiki',
    viewPermissions: ['wiki.edit'],
    // The editor autosaves the draft every few seconds; the triggers already skip writes that only
    // touch draft_* (TABLE_COMPARISON_IGNORED_COLUMNS in scripts/ensure-audit-infrastructure.mjs).
    // These stay ignored for display too, so a mixed write shows only the fields that matter.
    ignoredColumns: ['content_md', 'content_html', 'content_text', 'draft_md', 'draft_updated_at', 'draft_updated_by'],
    references: { space_id: WIKI_SPACE_REF, parent_id: WIKI_ARTICLE_REF, created_by: USER_REF, reviewed_by: USER_REF },
    describe: state => state.title ?? null,
    openPage: { page: 'WikiArticleEdit', metaKey: 'articleId' },
  },
  wiki_spaces: {
    table: 'wiki_spaces',
    labelKey: 'audit.entities.wikiSpace',
    domain: 'wiki',
    viewPermissions: ['wiki.manage'],
    describe: state => state.title ?? null,
  },
  wiki_article_revisions: {
    table: 'wiki_article_revisions',
    labelKey: 'audit.entities.wikiArticleRevision',
    domain: 'wiki',
    viewPermissions: ['wiki.edit'],
    parent: { table: 'wiki_articles', foreignKey: 'article_id' },
    ignoredColumns: ['content_md'],
    references: { article_id: WIKI_ARTICLE_REF, created_by: USER_REF },
    describe: state => state.title ?? null,
  },
  wiki_paths: {
    table: 'wiki_paths',
    labelKey: 'audit.entities.wikiPath',
    domain: 'wiki',
    viewPermissions: ['wiki.manage'],
    describe: state => state.title ?? null,
  },
  wiki_path_items: {
    table: 'wiki_path_items',
    labelKey: 'audit.entities.wikiPathItem',
    domain: 'wiki',
    viewPermissions: ['wiki.manage'],
    parent: { table: 'wiki_paths', foreignKey: 'path_id' },
    references: { article_id: WIKI_ARTICLE_REF },
  },
  wiki_checklists: {
    table: 'wiki_checklists',
    labelKey: 'audit.entities.wikiChecklist',
    domain: 'wiki',
    viewPermissions: ['wiki.edit'],
    parent: { table: 'wiki_articles', foreignKey: 'article_id' },
    describe: state => state.title ?? null,
  },
  wiki_checklist_items: {
    table: 'wiki_checklist_items',
    labelKey: 'audit.entities.wikiChecklistItem',
    domain: 'wiki',
    viewPermissions: ['wiki.edit'],
    parent: { table: 'wiki_checklists', foreignKey: 'checklist_id' },
    describe: state => state.label ?? null,
  },
  wiki_glossary_terms: {
    table: 'wiki_glossary_terms',
    labelKey: 'audit.entities.wikiGlossaryTerm',
    domain: 'wiki',
    viewPermissions: ['wiki.edit'],
    references: { article_id: WIKI_ARTICLE_REF },
    describe: state => state.term ?? null,
  },
  wiki_access_grants: {
    table: 'wiki_access_grants',
    labelKey: 'audit.entities.wikiAccessGrant',
    domain: 'wiki',
    viewPermissions: ['wiki.manage'],
    references: { created_by: USER_REF },
  },
  wiki_tags: {
    table: 'wiki_tags',
    labelKey: 'audit.entities.wikiTag',
    domain: 'wiki',
    viewPermissions: ['wiki.edit'],
    describe: state => state.label ?? null,
  },
  wiki_article_tags: {
    table: 'wiki_article_tags',
    labelKey: 'audit.entities.wikiArticleTag',
    domain: 'wiki',
    viewPermissions: ['wiki.edit'],
    parent: { table: 'wiki_articles', foreignKey: 'article_id' },
    references: { article_id: WIKI_ARTICLE_REF, tag_id: { table: 'wiki_tags', labelColumns: ['label'] } },
  },
  wiki_path_audiences: {
    table: 'wiki_path_audiences',
    labelKey: 'audit.entities.wikiPathAudience',
    domain: 'wiki',
    viewPermissions: ['wiki.manage'],
    parent: { table: 'wiki_paths', foreignKey: 'path_id' },
    references: { position_id: POSITION_REF, subdivision_id: SUBDIVISION_REF },
  },
  wiki_checklist_runs: {
    table: 'wiki_checklist_runs',
    labelKey: 'audit.entities.wikiChecklistRun',
    domain: 'wiki',
    viewPermissions: ['wiki.edit'],
    parent: { table: 'wiki_checklists', foreignKey: 'checklist_id' },
    references: { created_by: USER_REF },
    describe: state => state.title ?? null,
  },
  wiki_glossary_aliases: {
    table: 'wiki_glossary_aliases',
    labelKey: 'audit.entities.wikiGlossaryAlias',
    domain: 'wiki',
    viewPermissions: ['wiki.edit'],
    parent: { table: 'wiki_glossary_terms', foreignKey: 'term_id' },
    describe: state => state.alias ?? null,
  },
  wiki_page_help: {
    table: 'wiki_page_help',
    labelKey: 'audit.entities.wikiPageHelp',
    domain: 'wiki',
    viewPermissions: ['wiki.manage'],
    references: { article_id: WIKI_ARTICLE_REF },
  },

  // --- notifications ----------------------------------------------------------
  notifications: {
    table: 'notifications',
    labelKey: 'audit.entities.notification',
    domain: 'notifications',
    viewPermissions: ['notifications.view'],
    references: { created_by: USER_REF },
    describe: state => state.subject_override ?? null,
    openPage: { page: 'NotificationList', metaKey: 'notificationId' },
  },
  notification_deliveries: {
    table: 'notification_deliveries',
    labelKey: 'audit.entities.notificationDelivery',
    domain: 'notifications',
    viewPermissions: ['notifications.view'],
    parent: { table: 'notifications', foreignKey: 'notification_id' },
    redactedColumns: ['unsubscribe_token'],
    references: { member_id: MEMBER_REF, user_id: USER_REF },
  },
  entity_documents: {
    table: 'entity_documents',
    labelKey: 'audit.entities.entityDocument',
    domain: 'settings',
    viewPermissions: ['documents.view', 'settings.documents.manage'],
    references: { document_id: ASSOCIATION_DOCUMENT_REF, created_by: USER_REF },
  },
  association_documents: {
    table: 'association_documents',
    labelKey: 'audit.entities.associationDocument',
    domain: 'settings',
    viewPermissions: ['documents.view', 'settings.documents.manage'],
    references: { created_by: USER_REF },
    describe: state => state.title ?? null,
  },
  notification_preferences: {
    table: 'notification_preferences',
    labelKey: 'audit.entities.notificationPreference',
    domain: 'notifications',
    viewPermissions: ['notifications.view'],
    restricted: true,
  },

  // --- security (restricted) -----------------------------------------------
  users: {
    table: 'users',
    labelKey: 'audit.entities.user',
    domain: 'security',
    viewPermissions: ['users.view'],
    restricted: true,
    redactedColumns: ['password_hash', 'calendar_token_hash'],
    describe: state => state.username ?? null,
  },
  roles: {
    table: 'roles',
    labelKey: 'audit.entities.role',
    domain: 'security',
    viewPermissions: ['permissions.manage'],
    restricted: true,
    describe: state => state.name ?? null,
  },
  user_roles: {
    table: 'user_roles',
    labelKey: 'audit.entities.userRole',
    domain: 'security',
    viewPermissions: ['permissions.manage'],
    restricted: true,
    references: { user_id: USER_REF, role_id: { table: 'roles', labelColumns: ['name'] } },
  },
  role_permissions: {
    table: 'role_permissions',
    labelKey: 'audit.entities.rolePermission',
    domain: 'security',
    viewPermissions: ['permissions.manage'],
    restricted: true,
    references: { role_id: { table: 'roles', labelColumns: ['name'] } },
  },
  user_permissions: {
    table: 'user_permissions',
    labelKey: 'audit.entities.userPermission',
    domain: 'security',
    viewPermissions: ['permissions.manage'],
    restricted: true,
    references: { user_id: USER_REF },
  },
  app_settings: {
    table: 'app_settings',
    labelKey: 'audit.entities.appSetting',
    domain: 'security',
    viewPermissions: ['settings.app.access'],
    restricted: true,
    describe: state => state.setting_key ?? null,
  },
  association_profiles: {
    table: 'association_profiles',
    labelKey: 'audit.entities.associationProfile',
    domain: 'security',
    viewPermissions: ['settings.association.manage'],
    restricted: true,
    describe: state => state.name ?? null,
  },
  association_responsible_members: {
    table: 'association_responsible_members',
    labelKey: 'audit.entities.associationResponsibleMember',
    domain: 'security',
    viewPermissions: ['settings.association.manage'],
    restricted: true,
    references: { member_id: MEMBER_REF, association_profile_id: ASSOCIATION_PROFILE_REF },
  },
  association_responsible_positions: {
    table: 'association_responsible_positions',
    labelKey: 'audit.entities.associationResponsiblePosition',
    domain: 'security',
    viewPermissions: ['settings.association.manage'],
    restricted: true,
    references: { position_id: POSITION_REF, association_profile_id: ASSOCIATION_PROFILE_REF },
  },
  files: {
    table: 'files',
    labelKey: 'audit.entities.file',
    domain: 'security',
    viewPermissions: ['files.view'],
    restricted: true,
    redactedColumns: ['file_path'],
    references: { uploaded_by: USER_REF },
    describe: state => state.original_name ?? null,
  },
  file_attachments: {
    table: 'file_attachments',
    labelKey: 'audit.entities.fileAttachment',
    domain: 'security',
    viewPermissions: ['files.view'],
    restricted: true,
    references: { file_id: { table: 'files', labelColumns: ['original_name'] }, attached_by: USER_REF, detached_by: USER_REF },
  },
  appointments: {
    table: 'appointments',
    labelKey: 'audit.entities.appointment',
    domain: 'calendar',
    viewPermissions: ['calendar.view'],
    // Pure noise in every diff — the row is touched on every save.
    ignoredColumns: ['updated_at'],
    references: {
      type_id: { table: 'appointment_types', labelColumns: ['name'] },
      created_by: USER_REF,
    },
    describe: state => state.title ?? null,
    openPage: { page: 'AppointmentCreate', metaKey: 'appointmentId' },
  },
  appointment_types: {
    table: 'appointment_types',
    labelKey: 'audit.entities.appointmentType',
    domain: 'calendar',
    viewPermissions: ['calendar.manage'],
    describe: state => state.name ?? null,
  },
  appointment_subdivisions: {
    table: 'appointment_subdivisions',
    labelKey: 'audit.entities.appointmentSubdivision',
    domain: 'calendar',
    viewPermissions: ['calendar.view'],
    parent: { table: 'appointments', foreignKey: 'appointment_id' },
    references: { subdivision_id: SUBDIVISION_REF },
  },
  appointment_members: {
    table: 'appointment_members',
    labelKey: 'audit.entities.appointmentMember',
    domain: 'calendar',
    viewPermissions: ['calendar.view'],
    parent: { table: 'appointments', foreignKey: 'appointment_id' },
    references: { member_id: MEMBER_REF },
  },
  appointment_occurrence_overrides: {
    table: 'appointment_occurrence_overrides',
    labelKey: 'audit.entities.appointmentOccurrenceOverride',
    domain: 'calendar',
    viewPermissions: ['calendar.view'],
    parent: { table: 'appointments', foreignKey: 'appointment_id' },
  },
  appointment_responses: {
    table: 'appointment_responses',
    labelKey: 'audit.entities.appointmentResponse',
    domain: 'calendar',
    viewPermissions: ['calendar.view'],
    parent: { table: 'appointments', foreignKey: 'appointment_id' },
    references: { member_id: MEMBER_REF },
  },
  notification_push_subscriptions: {
    table: 'notification_push_subscriptions',
    labelKey: 'audit.entities.notificationPushSubscription',
    domain: 'security',
    viewPermissions: ['users.view'],
    restricted: true,
    redactedColumns: ['endpoint', 'p256dh', 'auth', 'user_agent'],
    references: { user_id: USER_REF },
  },
}

export function getAuditTableDefinition(table: string): AuditTableDefinition | undefined {
  return AUDIT_TABLES[table]
}

function canViewTable(user: User, def: AuditTableDefinition): boolean {
  if (!hasPermission(user, 'audit.view')) return false
  if (def.restricted && !hasPermission(user, 'audit.viewAll')) return false
  return hasPermission(user, def.viewPermissions)
}

export function canViewAuditTable(user: User | null, table: string): boolean {
  if (!user) return false
  const def = getAuditTableDefinition(table)
  // Unregistered tables (including anything not yet added here) stay invisible even to an
  // audit.viewAll admin — never leak a table this registry doesn't explicitly know about.
  if (!def) return false
  return canViewTable(user, def)
}

export function visibleTablesForUser(user: User | null): string[] {
  if (!user) return []
  return Object.values(AUDIT_TABLES)
    .filter(def => canViewTable(user, def))
    .map(def => def.table)
}
