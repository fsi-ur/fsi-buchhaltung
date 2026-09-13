import type { AttachmentItem, AttachmentSelection } from '~/types/attachment'
import type { PermissionKey } from '~/config/permissions'

export type WikiAccessLevel = 'read' | 'write' | 'admin'
/** `none` never exists in the database — it is what the resolver returns for "no access at all". */
export type WikiEffectiveLevel = 'none' | WikiAccessLevel

export type WikiScopeType = 'space' | 'article'
export type WikiGrantSubjectType = 'user' | 'role' | 'position' | 'subdivision' | 'permission'
export type WikiArticleStatus = 'draft' | 'in_review' | 'published' | 'archived'

export interface WikiSpace {
  id: number
  slug: string
  title: string
  description: string
  icon: string
  position: number
  requires_review: number
  is_archived: number
  owner_position_id: number | null
  owner_subdivision_id: number | null
  created_at?: string
  updated_at?: string
}

export interface WikiArticle {
  id: number
  space_id: number
  parent_id: number | null
  slug: string
  title: string
  summary: string
  icon: string | null
  position: number
  status: WikiArticleStatus
  content_md: string | null
  content_html: string | null
  content_text: string | null
  draft_md: string | null
  draft_updated_at: string | null
  draft_updated_by: number | null
  review_interval_days: number | null
  reviewed_at: string | null
  reviewed_by: number | null
  published_at: string | null
  owner_position_id: number | null
  owner_subdivision_id: number | null
  created_by: number
  created_at?: string
  updated_at?: string
}

/** The subject side of a grant: exactly one of `id` (user/role/position/subdivision) or `key`. */
export interface WikiGrantSubject {
  type: WikiGrantSubjectType
  id?: number | null
  key?: PermissionKey | string | null
}

export interface WikiAccessGrant {
  id: number
  scope_type: WikiScopeType
  scope_id: number
  include_descendants: number
  subject_type: WikiGrantSubjectType
  subject_id: number
  subject_key: string
  access_level: WikiAccessLevel
  created_by: number
  created_at?: string
}

/** A grant as the Zugriff tab shows it: with a readable subject label and its inheritance origin. */
export interface WikiAccessGrantView extends WikiAccessGrant {
  subject_label: string
  inherited: boolean
  origin_label: string
  owner_derived: boolean
}

export interface WikiTag {
  id: number
  slug: string
  label: string
}

export interface WikiArticleRevision {
  id: number
  article_id: number
  revision_number: number
  title: string
  summary: string
  content_md: string
  change_note: string
  created_by: number
  created_at: string
}

export interface WikiPath {
  id: number
  slug: string
  title: string
  description: string
  icon: string
  position: number
  is_published: number
}

export interface WikiPathItem {
  id: number
  path_id: number
  article_id: number
  position: number
  note: string
}

export interface WikiPathAudience {
  id: number
  path_id: number
  position_id: number | null
  subdivision_id: number | null
}

export interface WikiPathItemView {
  id: number
  articleId: number
  title: string
  summary: string
  note: string
  spaceTitle: string
  position: number
  done: boolean
  completedAt: string | null
}

export interface WikiPathAudienceView {
  positionId: number | null
  positionName: string | null
  subdivisionId: number | null
  subdivisionName: string | null
}

export interface WikiPathView {
  id: number
  slug: string
  title: string
  description: string
  icon: string
  position: number
  isPublished: boolean
  /** The path's audience matches the reader (or it has no audience at all). */
  recommended: boolean
  items: WikiPathItemView[]
  audiences: WikiPathAudienceView[]
  doneCount: number
  totalCount: number
  /** First not-yet-completed step — what the "weiter" button opens. */
  nextItem: WikiPathItemView | null
}

export interface WikiPathItemInput {
  /** Existing item id — kept so progress survives an edit. */
  id?: number | null
  articleId: number
  note: string
}

export interface WikiPathAudienceInput {
  positionId: number | null
  subdivisionId: number | null
}

export interface WikiPathInput {
  slug: string
  title: string
  description: string
  icon: string
  isPublished: boolean
  items: WikiPathItemInput[]
  audiences: WikiPathAudienceInput[]
}

export interface WikiPathAdminView extends WikiPathInput {
  id: number
  position: number
  items: Array<WikiPathItemInput & { id: number, title: string, spaceTitle: string, missing: boolean }>
}

export interface WikiSpaceAdminView {
  id: number
  slug: string
  title: string
  description: string
  icon: string
  position: number
  requiresReview: boolean
  isArchived: boolean
  ownerPositionId: number | null
  ownerPositionName: string | null
  ownerSubdivisionId: number | null
  ownerSubdivisionName: string | null
  articleCount: number
}

export interface WikiChecklist {
  id: number
  article_id: number
  key_slug: string
  title: string
  mode: 'personal' | 'shared'
}

export interface WikiChecklistItem {
  id: number
  checklist_id: number
  label: string
  hint: string
  target_page: string | null
  target_meta: string | null
  position: number
}

export interface WikiChecklistRun {
  id: number
  checklist_id: number
  title: string
  due_date: string | null
  closed_at: string | null
  created_by: number
  created_at: string
}

export interface WikiChecklistItemView {
  id: number
  label: string
  hint: string
  targetPage: string | null
  targetMeta: Record<string, any> | null
  position: number
  /** Personal mode only: whether the current reader has ticked it. */
  done: boolean
  doneAt: string | null
}

export interface WikiChecklistRunEntry {
  itemId: number
  completedAt: string
  completedBy: number
  completedByName: string
}

export interface WikiChecklistRunView {
  id: number
  title: string
  dueDate: string | null
  closedAt: string | null
  createdBy: number
  createdByName: string
  createdAt: string
  entries: WikiChecklistRunEntry[]
  /** The reader may close/reopen this run (its creator, or someone with `write` on the article). */
  canClose: boolean
}

/** A checklist plus everything needed to render it — items, personal state and the shared runs. */
export interface WikiChecklistView {
  id: number
  keySlug: string
  title: string
  mode: 'personal' | 'shared'
  items: WikiChecklistItemView[]
  runs: WikiChecklistRunView[]
}

/** The editor side of a checklist: definitions only, no tick state. */
export interface WikiChecklistItemInput {
  /** Existing item id — kept so personal/shared tick state survives an edit. */
  id?: number | null
  label: string
  hint: string
  targetPage: string | null
  targetMeta: Record<string, any> | null
}

export interface WikiChecklistInput {
  id?: number | null
  keySlug: string
  title: string
  mode: 'personal' | 'shared'
  items: WikiChecklistItemInput[]
}

export interface WikiGlossaryTerm {
  id: number
  term: string
  short_definition: string
  article_id: number | null
}

export interface WikiPageHelpEntry {
  id: number
  page_name: string
  section_key: string
  article_id: number
  position: number
}

/** Owner of a space or article, resolved to display labels for the article header. */
export interface WikiOwner {
  position_id: number | null
  position_name: string | null
  subdivision_id: number | null
  subdivision_name: string | null
}

/** One node of the space/article tree the reader navigates. */
export interface WikiTreeArticle {
  id: number
  space_id: number
  parent_id: number | null
  slug: string
  title: string
  summary: string
  icon: string | null
  position: number
  status: WikiArticleStatus
  accessLevel: WikiAccessLevel
  children: WikiTreeArticle[]
}

export interface WikiTreeSpace {
  id: number
  slug: string
  title: string
  description: string
  icon: string
  position: number
  requires_review: number
  accessLevel: WikiAccessLevel
  articles: WikiTreeArticle[]
}

export interface WikiBreadcrumb {
  id: number | null
  slug: string
  title: string
  type: WikiScopeType
}

export interface WikiArticleLink {
  id: number
  slug: string
  spaceSlug: string
  title: string
}

export type WikiAttachment = AttachmentItem

/** Everything the reader view of one article needs. */
export interface WikiArticleDetail {
  id: number
  spaceId: number
  spaceSlug: string
  spaceTitle: string
  parentId: number | null
  slug: string
  title: string
  summary: string
  icon: string | null
  status: WikiArticleStatus
  contentHtml: string
  publishedAt: string | null
  updatedAt: string | null
  reviewedAt: string | null
  breadcrumbs: WikiBreadcrumb[]
  children: WikiArticleLink[]
  prev: WikiArticleLink | null
  next: WikiArticleLink | null
  tags: WikiTag[]
  attachments: WikiAttachment[]
  attachmentSelection: AttachmentSelection
  owner: WikiOwner
  accessLevel: WikiAccessLevel
  hasDraft: boolean
  isStale: boolean
  requiresReview: boolean
}

export interface WikiSearchHit {
  id: number
  slug: string
  spaceId: number
  spaceSlug: string
  spaceTitle: string
  title: string
  summary: string
  snippet: string
}

export interface WikiEmbedOpenReimbursementsData {
  count: number
  uncheckedCount: number
  total: number
  oldestSubmittedAt: string | null
}

export interface WikiEmbedBudgetStatusData {
  year: number
  budgetCount: number
  periodStart: string | null
  periodEnd: string | null
  costCentre: { id: number, code: string, name: string } | null
  plannedExpense: number
  plannedIncome: number
  actualExpense: number
  actualIncome: number
}

export interface WikiEmbedCashPositionData {
  date: string
  bankBalance: number
  cashTotal: number
  totalMoney: number
}

export interface WikiEmbedEventItem {
  id: number
  name: string
  startsAt: string
  endsAt: string
  location: string | null
}

export interface WikiEmbedNextEventsData {
  events: WikiEmbedEventItem[]
}

export interface WikiEmbedShiftItem {
  id: number
  name: string
  startsAt: string
  endsAt: string
  eventId: number
  eventName: string
}

export interface WikiEmbedMyShiftsData {
  memberLinked: boolean
  shifts: WikiEmbedShiftItem[]
}

export interface WikiEmbedTaskItem {
  id: number
  title: string
  status: 'open' | 'in_progress'
  deadline: string | null
  eventId: number
  eventName: string
  viaSubdivision: string | null
}

export interface WikiEmbedMyOpenTasksData {
  memberLinked: boolean
  tasks: WikiEmbedTaskItem[]
}

export interface WikiEmbedContactPosition {
  id: number
  code: string
  name: string
  holders: string[]
}

export interface WikiEmbedAssociationContactData {
  associationName: string | null
  email: string | null
  positions: WikiEmbedContactPosition[]
  members: string[]
}

export interface WikiEmbedPendingChange {
  memberName: string
  fieldName: string
  requestedAt: string
}

export interface WikiEmbedPendingMemberChangesData {
  count: number
  memberCount: number
  latest: WikiEmbedPendingChange[]
}

export type WikiEmbedData =
  | WikiEmbedOpenReimbursementsData
  | WikiEmbedBudgetStatusData
  | WikiEmbedCashPositionData
  | WikiEmbedNextEventsData
  | WikiEmbedMyShiftsData
  | WikiEmbedMyOpenTasksData
  | WikiEmbedAssociationContactData
  | WikiEmbedPendingMemberChangesData

export interface WikiEmbedRequestItem {
  key: string
  args?: Record<string, string | number | boolean>
}

export interface WikiEmbedResult {
  key: string
  args: Record<string, string | number | boolean>
  /** false = the reader lacks the widget's permission; the client shows a neutral placeholder. */
  visible: boolean
  data: WikiEmbedData | null
  error: string | null
}
