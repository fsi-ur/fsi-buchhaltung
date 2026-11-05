import type { PermissionKey } from '~/config/permissions'

export interface CalendarSourceAccess {
  appointments: boolean
  events: boolean
  shifts: boolean
  tasks: boolean
}

/**
 * Which calendar sources a user may see — shared by the in-app calendar (`/api/calendar/entries`)
 * and the ICS feed (`/api/calendar/[token]`), so the two can never drift apart (SEC-17).
 * Without `calendar.view` the calendar is empty; events, shifts and task deadlines additionally
 * need event access.
 */
export function calendarSourceAccess(permissions: readonly PermissionKey[]): CalendarSourceAccess {
  const calendar = permissions.includes('calendar.view')
  const events = calendar && (['events.access', 'events.view', 'events.shifts.signup'] as const)
    .some(permission => permissions.includes(permission))
  return { appointments: calendar, events, shifts: events, tasks: events }
}
