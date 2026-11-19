import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { EventTask as PersistedEventTask, SaveEventTask } from '~/types/event'
import type { GetEventTasksResponse } from '~/server/api/events/[id]/tasks/index.get'
import type { UpdateEventTasksResponse } from '~/server/api/events/[id]/tasks/index.put'
import type { UpdateTaskStatusResponse } from '~/server/api/tasks/[id]/status.put'
import type { EventPlanningTask, EventPlanningTaskStatus } from '~/components/Page/Events/planning/types'

export function useEventTasks(eventId: Ref<number | null>) {
  const { t } = useI18n()
  const toast = useToast()
  const { resolveFlag } = useAuth()

  const planningTasks = ref<EventPlanningTask[]>([])
  const savedTasks = ref<EventPlanningTask[]>([])
  const taskLoading = ref(false)
  const taskSaving = ref(false)
  const canManageTasks = ref(false)
  const assignedTaskIds = ref<number[]>([])

  function mapPersistedTaskToPanel(task: PersistedEventTask): EventPlanningTask {
    return {
      id: task.id,
      title: task.title,
      description: task.description,
      deadline: task.deadline,
      status: task.status,
      memberIds: task.members.map(m => m.id),
      subdivisionIds: task.subdivisions.map(s => s.id),
      linkedChecklistId: task.linkedChecklistId,
      linkedChecklistProgress: task.linkedChecklistProgress,
    }
  }

  function mapPanelTaskToPayload(task: EventPlanningTask, position: number): SaveEventTask {
    return {
      ...(task.id > 0 ? { id: task.id } : {}),
      title: task.title,
      description: task.description?.trim() || null,
      status: task.status,
      deadline: task.deadline,
      position,
      member_ids: task.memberIds,
      subdivision_ids: task.subdivisionIds,
    }
  }

  async function loadEventTasks(id: number) {
    if (taskLoading.value) return

    try {
      taskLoading.value = true
      const res = await apiFetch<GetEventTasksResponse>(`/api/events/${id}/tasks`)
      if (!res.ok) throw new Error(res.error)

      applyServerTasks(res.tasks)
      canManageTasks.value = resolveFlag(res.canManageTasks, 'events.edit')
      assignedTaskIds.value = res.assignedTaskIds ?? []
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedLoadTasks'))
    }
    finally {
      taskLoading.value = false
    }
  }

  async function saveEventTasks(nextTasks: EventPlanningTask[]) {
    if (!eventId.value || taskSaving.value) return

    try {
      taskSaving.value = true
      const res = await apiFetch<UpdateEventTasksResponse>(`/api/events/${eventId.value}/tasks`, {
        method: 'PUT',
        body: { tasks: nextTasks.map((task, i) => mapPanelTaskToPayload(task, i)) },
      })
      if (!res.ok) throw new Error(res.error)

      applyServerTasks(res.tasks)
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedSaveTasks'))
      if (eventId.value) await loadEventTasks(eventId.value)
    }
    finally {
      taskSaving.value = false
    }
  }

  function applyServerTasks(tasks: PersistedEventTask[]) {
    planningTasks.value = tasks.map(mapPersistedTaskToPanel)
    savedTasks.value = tasks.map(mapPersistedTaskToPanel)
  }

  /**
   * Saves one edited task and nothing else: the request is the last saved list with just this task
   * swapped in, and afterwards only this task is taken over locally — other cards keep their
   * unsaved edits.
   */
  async function saveEventTask(task: EventPlanningTask) {
    if (!eventId.value || taskSaving.value) return

    // A task that was never saved can only be created as part of the whole list.
    if (task.id <= 0 || !savedTasks.value.some(entry => entry.id === task.id)) {
      await saveEventTasks(planningTasks.value)
      return
    }

    try {
      taskSaving.value = true
      const payload = savedTasks.value.map(entry => entry.id === task.id ? task : entry)
      const res = await apiFetch<UpdateEventTasksResponse>(`/api/events/${eventId.value}/tasks`, {
        method: 'PUT',
        body: { tasks: payload.map((entry, i) => mapPanelTaskToPayload(entry, i)) },
      })
      if (!res.ok) throw new Error(res.error)

      savedTasks.value = res.tasks.map(mapPersistedTaskToPanel)
      const savedTask = res.tasks.find(entry => entry.id === task.id)
      planningTasks.value = savedTask
        ? planningTasks.value.map(entry => entry.id === task.id ? mapPersistedTaskToPanel(savedTask) : entry)
        : planningTasks.value.filter(entry => entry.id !== task.id)
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedSaveTasks'))
    }
    finally {
      taskSaving.value = false
    }
  }

  /** Takes over a change the server already made (status, checklist progress) into both copies. */
  function patchTask(taskId: number, patch: Partial<EventPlanningTask>) {
    planningTasks.value = planningTasks.value.map(task => task.id === taskId ? { ...task, ...patch } : task)
    savedTasks.value = savedTasks.value.map(task => task.id === taskId ? { ...task, ...patch } : task)
  }

  /**
   * Status-only update for assignees who may not edit the task list itself. Touches nothing but
   * the one task, so it never overwrites anyone else's concurrent edits to the list.
   */
  async function changeTaskStatus(taskId: number, status: EventPlanningTaskStatus) {
    if (taskSaving.value) return

    try {
      taskSaving.value = true
      const res = await apiFetch<UpdateTaskStatusResponse>(`/api/tasks/${taskId}/status`, {
        method: 'PUT',
        body: { status },
      })
      if (!res.ok) throw new Error(res.error)

      patchTask(taskId, { status: res.status })
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedSaveTasks'))
      if (eventId.value) await loadEventTasks(eventId.value)
    }
    finally {
      taskSaving.value = false
    }
  }

  function reset() {
    planningTasks.value = []
    savedTasks.value = []
    canManageTasks.value = false
    assignedTaskIds.value = []
  }

  return {
    planningTasks,
    savedTasks,
    taskLoading,
    taskSaving,
    canManageTasks,
    assignedTaskIds,
    loadEventTasks,
    saveEventTasks,
    saveEventTask,
    changeTaskStatus,
    patchTask,
    reset,
  }
}
