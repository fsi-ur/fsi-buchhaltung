import type * as mariadb from 'mariadb'
import { loadEventChecklists } from '~/server/utils/eventChecklists'
import { loadEventShiftSlots } from '~/server/utils/eventShifts'
import { loadEventTasks } from '~/server/utils/eventTasks'
import type { EventCostCentreSplit, EventPlanningSummary, EventRow } from '~/types/event'

interface PlanningSummaryInput {
  event: Pick<EventRow, 'location' | 'expected_guests'>
  organizerCount: number
  costCentreSplits: EventCostCentreSplit[]
}

function costCentresValid(splits: EventCostCentreSplit[]) {
  if (!splits.length) return false
  const total = splits.reduce((sum, split) => sum + Number(split.allocation_percentage || 0), 0)
  return Math.abs(total - 100) <= 0.01
}

/**
 * Aggregates tasks, shifts, checklists and master data of a single event into a
 * compact summary that mirrors the readiness logic of the planning workspace.
 */
export async function buildEventPlanningSummary(
  eventId: number,
  input: PlanningSummaryInput,
  conn?: mariadb.PoolConnection,
): Promise<EventPlanningSummary> {
  const [tasks, shifts, checklists] = await Promise.all([
    loadEventTasks(eventId, conn),
    loadEventShiftSlots(eventId, conn),
    loadEventChecklists(eventId, conn),
  ])

  const doneTasks = tasks.filter(task => task.status === 'done').length
  const totalTasks = tasks.length

  const totalShifts = shifts.length
  const fullyStaffed = shifts.filter(shift => shift.members.length >= shift.required_people).length
  const partiallyStaffed = shifts.filter(shift => shift.members.length > 0 && shift.members.length < shift.required_people).length

  const totalChecklistItems = checklists.reduce((sum, checklist) => sum + checklist.items.length, 0)
  const doneChecklistItems = checklists.reduce((sum, checklist) => sum + checklist.items.filter(item => item.done).length, 0)

  const locationSet = Boolean(input.event.location?.trim())
  const guestsSet = input.event.expected_guests != null
  const splitsValid = costCentresValid(input.costCentreSplits)

  let numerator = 0
  let denominator = 3
  if (locationSet) numerator += 0.5
  if (guestsSet) numerator += 0.5
  if (input.organizerCount > 0) numerator += 1
  if (splitsValid) numerator += 1

  if (totalTasks > 0) {
    denominator += 1
    numerator += doneTasks / totalTasks
  }
  if (totalShifts > 0) {
    denominator += 1
    numerator += fullyStaffed / totalShifts
  }
  if (checklists.length > 0) {
    denominator += 1
    if (totalChecklistItems > 0) numerator += doneChecklistItems / totalChecklistItems
  }

  return {
    readiness: Math.round((numerator / denominator) * 100),
    tasks: { total: totalTasks, done: doneTasks, open: totalTasks - doneTasks },
    shifts: { total: totalShifts, fullyStaffed, partiallyStaffed, unstaffed: totalShifts - fullyStaffed },
    checklists: { count: checklists.length, totalItems: totalChecklistItems, doneItems: doneChecklistItems },
    details: {
      locationSet,
      guestsSet,
      organizerCount: input.organizerCount,
      costCentresValid: splitsValid,
    },
  }
}
