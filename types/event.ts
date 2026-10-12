export interface SaveEventCostCentreSplit {
  sphere_id: number
  cost_centre_id: number
  allocation_percentage: number
}

export interface SaveEventBody {
  name: string
  starts_at: string
  ends_at: string
  location: string | null
  expected_guests: number | null
  member_organizer_ids: number[]
  subdivision_organizer_ids: number[]
  cost_centre_splits: SaveEventCostCentreSplit[]
}

export interface EventRow {
  id: number
  name: string
  starts_at: string
  ends_at: string
  location: string | null
  expected_guests: number | null
}

export interface EventMemberOrganizer {
  id: number
  full_name: string
}

export interface EventSubdivisionOrganizer {
  id: number
  code: string
  name: string
}

export interface EventCostCentreSplit extends SaveEventCostCentreSplit {
  sphere_code: string
  sphere_name: string
  code: string
  name: string
}

export interface Event extends EventRow {
  member_organizers: EventMemberOrganizer[]
  subdivision_organizers: EventSubdivisionOrganizer[]
  cost_centre_splits: EventCostCentreSplit[]
}

export interface EventPlanningSummary {
  readiness: number
  tasks: { total: number; done: number; open: number }
  shifts: { total: number; fullyStaffed: number; partiallyStaffed: number; unstaffed: number }
  checklists: { count: number; totalItems: number; doneItems: number }
  details: { locationSet: boolean; guestsSet: boolean; organizerCount: number; costCentresValid: boolean }
}

export type EventSpotlightStatus = 'upcoming' | 'ongoing' | 'past'

export interface EventSpotlightShift {
  id: number
  name: string
  starts_at: string
  ends_at: string
  required_people: number
  member_count: number
  is_signed_up: boolean
}

export interface EventSpotlight extends Event {
  status: EventSpotlightStatus
  daysToStart: number | null
  canOpen: boolean
  planning: EventPlanningSummary | null
  shiftOverview: EventSpotlightShift[] | null
}

export interface EventMemberOption {
  id: number
  full_name: string
}

export interface EventSubdivisionOption {
  id: number
  code: string
  name: string
  is_active: boolean
}

export interface EventCostCentreOption {
  id: number
  code: string
  name: string
  is_active: boolean
}

export interface EventSphereOption {
  id: number
  code: string
  name: string
  is_active: boolean
}

export interface EventTaskMember {
  id: number
  full_name: string
}

export interface EventTaskSubdivision {
  id: number
  code: string
  name: string
}

export interface EventTask {
  id: number
  title: string
  status: 'open' | 'in_progress' | 'done'
  deadline: string | null
  position: number
  members: EventTaskMember[]
  subdivisions: EventTaskSubdivision[]
  linkedChecklistId: number | null
  linkedChecklistProgress: { done: number; total: number } | null
}

export type EventTaskStatus = EventTask['status']

export interface MyEventTask {
  id: number
  eventId: number
  eventName: string
  title: string
  status: Exclude<EventTaskStatus, 'done'>
  deadline: string | null
  /** Personally assigned (as opposed to only through a subdivision). */
  assignedDirectly: boolean
  /** The member's own subdivisions the task is assigned to. */
  viaSubdivisions: EventTaskSubdivision[]
  checklistProgress: { done: number; total: number } | null
  /** May open the event's task tab (events.view or organizer of that event). */
  canOpenEvent: boolean
}

export interface SaveEventTask {
  id?: number
  title: string
  status: 'open' | 'in_progress' | 'done'
  deadline: string | null
  position: number
  member_ids: number[]
  subdivision_ids: number[]
}

export interface EventShiftMember {
  id: number
  full_name: string
}

export interface EventShiftSlot {
  id: number
  name: string
  description: string
  starts_at: string
  ends_at: string
  required_people: number
  members: EventShiftMember[]
}

export interface SaveEventShiftSlot {
  id?: number
  name: string
  description: string
  starts_at: string
  ends_at: string
  required_people: number
  member_ids: number[]
}

export interface EventShiftTemplate {
  id: number
  name: string
  description: string
  required_people: number
}

/** Shared description for a shift "type" (shifts grouped by normalized name) within one event, keyed by that normalized name. */
export type EventShiftTypeDescriptions = Record<string, string>

export interface SaveEventShiftTemplate {
  id?: number
  name: string
  description: string
  required_people: number
}

export interface EventChecklistItem {
  id: number
  label: string
  done: boolean
}

export interface EventChecklist {
  id: number
  title: string
  description: string
  items: EventChecklistItem[]
  taskId: number | null
}

export interface SaveEventChecklistItem {
  id?: number
  label: string
  done: boolean
}

export interface SaveEventChecklist {
  id?: number
  title: string
  description: string
  items: SaveEventChecklistItem[]
  taskId?: number | null
}

export interface EventChecklistTemplate {
  id: number
  title: string
  description: string
  items: EventChecklistItem[]
}

export interface SaveEventChecklistTemplate {
  id?: number
  title: string
  description: string
  items: SaveEventChecklistItem[]
}
