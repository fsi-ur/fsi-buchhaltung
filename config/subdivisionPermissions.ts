import type { PermissionKey } from '~/config/permissions'

/**
 * Permissions that hold only inside one subdivision. They are granted by a subdivision-bound
 * position (e.g. "Leitung"), whose assignment names the subdivision (`member_positions.subdivision_id`),
 * and are stored next to the global keys in `position_permissions` — the `subdivision.` prefix keeps
 * the two namespaces apart (`isValidPermissionKey` rejects these, so no global check ever sees them).
 *
 * Global permissions never turn into scoped ones: `settings.subdivisions.manage` keeps working through
 * Settings → Subdivisions, `events.edit` keeps seeing every event. The two exceptions are explicit:
 * `subdivisions.leadership.view` (read access to every subdivision on the leadership page) and
 * `subdivisions.leadership.edit` (every scoped permission in every subdivision).
 */
export type SubdivisionPermissionKey =
  | 'subdivision.members.view'
  | 'subdivision.members.manage'
  | 'subdivision.positions.assign'
  | 'subdivision.history.view'
  // Prepared for upcoming features — the keys exist so data and checks can be built on them, but
  // they are hidden from the permission editor until a feature actually honours them.
  | 'subdivision.events.edit'
  | 'subdivision.appointments.edit'
  | 'subdivision.notifications.send'
  | 'subdivision.wiki.manage'
  | 'subdivision.tasks.manage'

export interface SubdivisionPermissionDefinition {
  key: SubdivisionPermissionKey
  labelKey: string
  /**
   * Global permissions that already allow the same thing in *every* subdivision (all of them
   * needed). Holding them means handing this key out is no escalation, so it decides who may assign
   * a position carrying it (authorizePositionAssignmentChanges) or link a member holding one to an
   * account. It never grants the scoped key itself: global permissions keep working through their
   * own pages only.
   */
  coveredBy: PermissionKey[]
  /** Scoped keys this one includes (applied when a user's scoped permissions are resolved). */
  implies?: SubdivisionPermissionKey[]
  /** Not honoured by any feature yet: kept out of the permission editor. */
  planned?: boolean
}

export const SUBDIVISION_PERMISSIONS: SubdivisionPermissionDefinition[] = [
  // The member list of the subdivision, with study subject, e-mail and phone.
  { key: 'subdivision.members.view', labelKey: 'permissions.subdivisionItems.membersView', coveredBy: ['members.view', 'subdivisions.view'] },
  { key: 'subdivision.members.manage', labelKey: 'permissions.subdivisionItems.membersManage', coveredBy: ['settings.subdivisions.manage'], implies: ['subdivision.members.view'] },
  // Handing out a position means picking one of the subdivision's members.
  { key: 'subdivision.positions.assign', labelKey: 'permissions.subdivisionItems.positionsAssign', coveredBy: ['positions.assign'], implies: ['subdivision.members.view'] },
  { key: 'subdivision.history.view', labelKey: 'permissions.subdivisionItems.historyView', coveredBy: ['audit.view', 'subdivisions.view'] },
  { key: 'subdivision.events.edit', labelKey: 'permissions.subdivisionItems.eventsEdit', coveredBy: ['events.edit'], planned: true },
  { key: 'subdivision.appointments.edit', labelKey: 'permissions.subdivisionItems.appointmentsEdit', coveredBy: ['calendar.manage'], planned: true },
  { key: 'subdivision.notifications.send', labelKey: 'permissions.subdivisionItems.notificationsSend', coveredBy: ['notifications.send'], planned: true },
  { key: 'subdivision.wiki.manage', labelKey: 'permissions.subdivisionItems.wikiManage', coveredBy: ['wiki.manage'], planned: true },
  { key: 'subdivision.tasks.manage', labelKey: 'permissions.subdivisionItems.tasksManage', coveredBy: ['events.edit'], planned: true },
]

/** The keys the permission editor offers — everything not marked as planned. */
export const ASSIGNABLE_SUBDIVISION_PERMISSIONS = SUBDIVISION_PERMISSIONS.filter(definition => !definition.planned)

export const ALL_SUBDIVISION_PERMISSION_KEYS: SubdivisionPermissionKey[] = SUBDIVISION_PERMISSIONS.map(definition => definition.key)

export function isSubdivisionPermissionKey(key: unknown): key is SubdivisionPermissionKey {
  return typeof key === 'string' && SUBDIVISION_PERMISSIONS.some(definition => definition.key === key)
}

/** Scoped keys a position may currently carry (planned ones are refused when saving). */
export function isAssignableSubdivisionPermissionKey(key: unknown): key is SubdivisionPermissionKey {
  return typeof key === 'string' && ASSIGNABLE_SUBDIVISION_PERMISSIONS.some(definition => definition.key === key)
}

/** Adds every scoped key implied (transitively) by the given ones. */
export function expandSubdivisionPermissions(keys: Iterable<SubdivisionPermissionKey>): SubdivisionPermissionKey[] {
  const result = new Set<SubdivisionPermissionKey>(keys)
  let grew = true
  while (grew) {
    grew = false
    for (const key of Array.from(result)) {
      for (const implied of SUBDIVISION_PERMISSIONS.find(definition => definition.key === key)?.implies ?? []) {
        if (result.has(implied)) continue
        result.add(implied)
        grew = true
      }
    }
  }
  return Array.from(result)
}

/** Subdivision ids mapped to the scoped keys a user holds there. */
export type SubdivisionPermissionMap = Record<number, SubdivisionPermissionKey[]>
