// Navigation / UI
export type EventPlanningTabKey = 'overview' | 'timeline' | 'tasks' | 'checklists' | 'shifts' | 'details' | 'cashRegister' | 'website'
export type EventShiftPermissionMode = 'own' | 'manage'

// Task types
export type EventPlanningTaskStatus = 'open' | 'in_progress' | 'done'

export interface EventPlanningTask {
  id: number
  title: string
  deadline: string | null
  status: EventPlanningTaskStatus
  memberIds: number[]
  subdivisionIds: number[]
  linkedChecklistId: number | null
  linkedChecklistProgress: { done: number; total: number } | null
}

// Timeline types
export type EventTimelineKind = 'event' | 'task' | 'shift'

export interface EventTimelineItem {
  id: string
  raw: string
  rawEnd?: string
  timeLabel: string
  title: string
  meta: string
  kind: EventTimelineKind
  typeLabel: string
  status?: EventPlanningTaskStatus
  requiredPeople?: number
  memberCount?: number
  checklistProgress?: { done: number; total: number }
}

// Checklist types
export interface PlanningChecklistItem {
  id: number
  label: string
  done: boolean
}

export interface PlanningChecklist {
  id: number
  title: string
  description: string
  items: PlanningChecklistItem[]
  taskId: number | null
}

// Shift types
export interface PlanningShiftSlot {
  id: number
  name: string
  description: string
  startsAt: string
  endsAt: string
  requiredPeople: number
  memberIds: number[]
  memberQuery: string
}

export interface PlanningShiftTemplate {
  id: number
  name: string
  description: string
  requiredPeople: number
}
