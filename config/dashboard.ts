import type { Component } from 'vue'
import type { PermissionKey } from '~/config/permissions'
import CalendarWidget from '~/components/Page/Home/Widget/Calendar.vue'
import EventsWidget from '~/components/Page/Home/Widget/Events.vue'
import MembersWidget from '~/components/Page/Home/Widget/Members.vue'
import MyTasksWidget from '~/components/Page/Home/Widget/MyTasks.vue'
import WikiWidget from '~/components/Page/Home/Widget/Wiki.vue'

/**
 * Available widget sizes. The dashboard is a 12-column grid (see Page.vue #cards):
 *  - small:  1/3 width on desktop, half width on tablets
 *  - medium: half width on desktop
 *  - large:  2/3 width on desktop
 *  - full:   always full width
 * Every size collapses to full width on small screens.
 */
export type DashboardWidgetSize = 'small' | 'medium' | 'large' | 'full'

export const DASHBOARD_WIDGET_SIZE_CLASSES: Record<DashboardWidgetSize, string> = {
  small: 'col-span-12 md:col-span-6 xl:col-span-4',
  medium: 'col-span-12 xl:col-span-6',
  large: 'col-span-12 xl:col-span-8',
  full: 'col-span-12',
}

export interface DashboardWidget {
  id: string
  component: Component
  size: DashboardWidgetSize
  /** The user must hold at least one of these (or all, with requireAllPermissions). Empty array = visible to everyone. */
  permissions: PermissionKey[]
  requireAllPermissions?: boolean
}

// Widgets render in this order; the grid packs them left to right.
// A widget may also hide itself by emitting `update:hidden`.
export const DASHBOARD_WIDGETS: DashboardWidget[] = [
  { id: 'myTasks', component: MyTasksWidget, size: 'medium', permissions: [] },
  { id: 'calendar', component: CalendarWidget, size: 'medium', permissions: ['calendar.view'] },
  { id: 'events', component: EventsWidget, size: 'medium', permissions: ['events.access'] },
  { id: 'members', component: MembersWidget, size: 'medium', permissions: ['members.view'] },
  { id: 'wiki', component: WikiWidget, size: 'small', permissions: ['wiki.view'] },
]
