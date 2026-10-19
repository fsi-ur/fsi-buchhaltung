import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type {
  EventChecklist as PersistedEventChecklist,
  EventChecklistTemplate as PersistedEventChecklistTemplate,
  SaveEventChecklist,
  SaveEventChecklistTemplate,
} from '~/types/event'
import type { GetEventChecklistsResponse } from '~/server/api/events/[id]/checklists/index.get'
import type { UpdateEventChecklistsResponse } from '~/server/api/events/[id]/checklists/index.put'
import type { UpdateEventChecklistTemplatesResponse } from '~/server/api/events/checklist-templates/index.put'
import type { UpdateChecklistItemDoneResponse } from '~/server/api/checklist-items/[id]/done.put'
import type { PlanningChecklist } from '~/components/Page/Events/planning/types'

export function useEventChecklists(eventId: Ref<number | null>) {
  const { t } = useI18n()
  const toast = useToast()
  const { resolveFlag } = useAuth()

  const reusableChecklists = ref<PlanningChecklist[]>([])
  const checklistTemplates = ref<PlanningChecklist[]>([])
  const checklistLoading = ref(false)
  const checklistSaving = ref(false)
  const canManageChecklists = ref(false)

  function mapPersistedChecklistToPanel(checklist: PersistedEventChecklist): PlanningChecklist {
    return {
      id: checklist.id,
      title: checklist.title,
      description: checklist.description,
      items: checklist.items.map(item => ({
        id: item.id,
        label: item.label,
        done: item.done,
      })),
      taskId: checklist.taskId,
    }
  }

  function mapPersistedChecklistTemplateToPanel(template: PersistedEventChecklistTemplate): PlanningChecklist {
    return {
      id: template.id,
      title: template.title,
      description: template.description,
      items: template.items.map(item => ({
        id: item.id,
        label: item.label,
        done: false,
      })),
      taskId: null,
    }
  }

  function mapPanelChecklistToPayload(checklist: PlanningChecklist): SaveEventChecklist {
    return {
      ...(checklist.id > 0 ? { id: checklist.id } : {}),
      title: checklist.title,
      description: checklist.description,
      items: checklist.items.map(item => ({
        ...(item.id > 0 ? { id: item.id } : {}),
        label: item.label,
        done: item.done,
      })),
      taskId: checklist.taskId ?? null,
    }
  }

  function mapPanelChecklistTemplateToPayload(template: PlanningChecklist): SaveEventChecklistTemplate {
    return {
      ...(template.id > 0 ? { id: template.id } : {}),
      title: template.title,
      description: template.description,
      items: template.items.map(item => ({
        ...(item.id > 0 ? { id: item.id } : {}),
        label: item.label,
        done: false,
      })),
    }
  }

  async function loadEventChecklists(id: number) {
    if (checklistLoading.value) return

    try {
      checklistLoading.value = true
      const res = await apiFetch<GetEventChecklistsResponse>(`/api/events/${id}/checklists`)
      if (!res.ok) throw new Error(res.error)

      reusableChecklists.value = res.checklists.map(mapPersistedChecklistToPanel)
      checklistTemplates.value = res.templates.map(mapPersistedChecklistTemplateToPanel)
      canManageChecklists.value = resolveFlag(res.canManageChecklists, 'events.edit')
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedLoadChecklists'))
    }
    finally {
      checklistLoading.value = false
    }
  }

  async function saveEventChecklists(nextChecklists: PlanningChecklist[]): Promise<Array<{ id: number; status: string }> | null> {
    if (!eventId.value || checklistSaving.value) return null

    try {
      checklistSaving.value = true
      const res = await apiFetch<UpdateEventChecklistsResponse>(`/api/events/${eventId.value}/checklists`, {
        method: 'PUT',
        body: { checklists: nextChecklists.map(mapPanelChecklistToPayload) },
      })
      if (!res.ok) throw new Error(res.error)

      reusableChecklists.value = res.checklists.map(mapPersistedChecklistToPanel)
      return res.affectedTaskStatuses
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedSaveChecklists'))
      if (eventId.value) await loadEventChecklists(eventId.value)
      return null
    }
    finally {
      checklistSaving.value = false
    }
  }

  /**
   * Ticks a single item without replacing the event's checklists — for assignees of the linked
   * task, who may not edit the checklists themselves. Resolves to the linked task's new status.
   */
  async function setChecklistItemDone(checklistId: number, itemId: number, done: boolean) {
    if (checklistSaving.value) return null

    try {
      checklistSaving.value = true
      const res = await apiFetch<UpdateChecklistItemDoneResponse>(`/api/checklist-items/${itemId}/done`, {
        method: 'PUT',
        body: { done },
      })
      if (!res.ok) throw new Error(res.error)

      reusableChecklists.value = reusableChecklists.value.map(checklist => checklist.id === checklistId
        ? { ...checklist, items: checklist.items.map(item => item.id === itemId ? { ...item, done: res.done } : item) }
        : checklist)
      return res.task
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedSaveChecklists'))
      if (eventId.value) await loadEventChecklists(eventId.value)
      return null
    }
    finally {
      checklistSaving.value = false
    }
  }

  async function saveEventChecklistTemplates(nextTemplates: PlanningChecklist[]) {
    if (!eventId.value || checklistSaving.value) return

    try {
      checklistSaving.value = true
      const res = await apiFetch<UpdateEventChecklistTemplatesResponse>('/api/events/checklist-templates', {
        method: 'PUT',
        body: { templates: nextTemplates.map(mapPanelChecklistTemplateToPayload) },
      })
      if (!res.ok) throw new Error(res.error)

      checklistTemplates.value = res.templates.map(mapPersistedChecklistTemplateToPanel)
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedSaveChecklists'))
      if (eventId.value) await loadEventChecklists(eventId.value)
    }
    finally {
      checklistSaving.value = false
    }
  }

  function reset() {
    reusableChecklists.value = []
    checklistTemplates.value = []
    canManageChecklists.value = false
  }

  return {
    reusableChecklists,
    checklistTemplates,
    checklistLoading,
    checklistSaving,
    canManageChecklists,
    loadEventChecklists,
    saveEventChecklists,
    setChecklistItemDone,
    saveEventChecklistTemplates,
    reset,
  }
}
