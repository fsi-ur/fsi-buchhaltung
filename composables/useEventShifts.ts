import { useAuth } from '~/composables/useAuth'
import { useI18n } from '~/composables/useI18n'
import { useToast } from '~/composables/useToast'
import type { EventShiftSlot as PersistedEventShiftSlot, EventShiftTemplate as PersistedEventShiftTemplate, EventShiftTypeDescriptions, SaveEventShiftSlot, SaveEventShiftTemplate } from '~/types/event'
import type { GetEventShiftsResponse } from '~/server/api/events/[id]/shifts/index.get'
import type { UpdateEventShiftsResponse } from '~/server/api/events/[id]/shifts/index.put'
import type { UpdateEventShiftTemplatesResponse } from '~/server/api/events/shift-templates/index.put'
import type { UpdateEventShiftTypeDescriptionsResponse } from '~/server/api/events/[id]/shifts/type-descriptions.put'
import type { AddSelfToShiftResponse } from '~/server/api/events/[id]/shifts/[shiftId]/self.post'
import type { RemoveSelfFromShiftResponse } from '~/server/api/events/[id]/shifts/[shiftId]/self.delete'
import type { EventShiftPermissionMode, PlanningShiftSlot, PlanningShiftTemplate } from '~/components/Page/Events/planning/types'

export function useEventShifts(eventId: Ref<number | null>) {
  const { t } = useI18n()
  const toast = useToast()
  const { resolveFlag } = useAuth()

  const shiftSlots = ref<PlanningShiftSlot[]>([])
  const shiftTemplates = ref<PlanningShiftTemplate[]>([])
  const shiftTypeDescriptions = ref<EventShiftTypeDescriptions>({})
  const shiftPermissionMode = ref<EventShiftPermissionMode>('manage')
  const currentMemberId = ref<number | null>(null)
  const shiftLoading = ref(false)
  const shiftSaving = ref(false)
  const canManageShifts = ref(false)
  const canSelfSignup = ref(false)

  function mapPersistedShiftToPanel(shift: PersistedEventShiftSlot): PlanningShiftSlot {
    return {
      id: shift.id,
      name: shift.name,
      description: shift.description,
      startsAt: shift.starts_at,
      endsAt: shift.ends_at,
      requiredPeople: shift.required_people,
      memberIds: shift.members.map(member => member.id),
      memberQuery: '',
    }
  }

  function mapPanelShiftToPayload(shift: PlanningShiftSlot): SaveEventShiftSlot {
    return {
      ...(shift.id > 0 ? { id: shift.id } : {}),
      name: shift.name,
      description: shift.description,
      starts_at: shift.startsAt,
      ends_at: shift.endsAt,
      required_people: shift.requiredPeople,
      member_ids: shift.memberIds,
    }
  }

  function mapPersistedShiftTemplateToPanel(template: PersistedEventShiftTemplate): PlanningShiftTemplate {
    return {
      id: template.id,
      name: template.name,
      description: template.description,
      requiredPeople: template.required_people,
    }
  }

  function mapPanelShiftTemplateToPayload(template: PlanningShiftTemplate): SaveEventShiftTemplate {
    return {
      ...(template.id > 0 ? { id: template.id } : {}),
      name: template.name,
      description: template.description,
      required_people: template.requiredPeople,
    }
  }

  async function loadShiftSlots(id: number) {
    if (shiftLoading.value) return

    try {
      shiftLoading.value = true
      const res = await apiFetch<GetEventShiftsResponse>(`/api/events/${id}/shifts`)
      if (!res.ok) throw new Error(res.error)

      shiftSlots.value = res.shifts.map(mapPersistedShiftToPanel)
      shiftTemplates.value = res.templates.map(mapPersistedShiftTemplateToPanel)
      shiftTypeDescriptions.value = res.typeDescriptions
      currentMemberId.value = res.currentMemberId
      canManageShifts.value = resolveFlag(res.canManageShifts, 'events.edit')
      canSelfSignup.value = resolveFlag(res.canSelfSignup, ['events.edit', 'events.shifts.signup'])
      shiftPermissionMode.value = canManageShifts.value ? 'manage' : 'own'
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedLoadShifts'))
    }
    finally {
      shiftLoading.value = false
    }
  }

  async function saveShiftSlots(nextSlots: PlanningShiftSlot[]) {
    if (!eventId.value || shiftSaving.value) return

    try {
      shiftSaving.value = true
      const res = await apiFetch<UpdateEventShiftsResponse>(`/api/events/${eventId.value}/shifts`, {
        method: 'PUT',
        body: { shifts: nextSlots.map(mapPanelShiftToPayload) },
      })
      if (!res.ok) throw new Error(res.error)

      shiftSlots.value = res.shifts.map(mapPersistedShiftToPanel)
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedSaveShifts'))
      if (eventId.value) await loadShiftSlots(eventId.value)
    }
    finally {
      shiftSaving.value = false
    }
  }

  async function saveShiftTemplates(nextTemplates: PlanningShiftTemplate[]) {
    if (shiftSaving.value) return

    try {
      shiftSaving.value = true
      const res = await apiFetch<UpdateEventShiftTemplatesResponse>('/api/events/shift-templates', {
        method: 'PUT',
        body: { templates: nextTemplates.map(mapPanelShiftTemplateToPayload) },
      })
      if (!res.ok) throw new Error(res.error)

      shiftTemplates.value = res.templates.map(mapPersistedShiftTemplateToPanel)
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedSaveShiftTemplates'))
      if (eventId.value) await loadShiftSlots(eventId.value)
    }
    finally {
      shiftSaving.value = false
    }
  }

  async function saveShiftTypeDescriptions(nextEntries: EventShiftTypeDescriptions) {
    if (!eventId.value || shiftSaving.value) return

    try {
      shiftSaving.value = true
      const res = await apiFetch<UpdateEventShiftTypeDescriptionsResponse>(`/api/events/${eventId.value}/shifts/type-descriptions`, {
        method: 'PUT',
        body: { entries: nextEntries },
      })
      if (!res.ok) throw new Error(res.error)

      shiftTypeDescriptions.value = res.typeDescriptions
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedSaveShiftTypeDescriptions'))
      if (eventId.value) await loadShiftSlots(eventId.value)
    }
    finally {
      shiftSaving.value = false
    }
  }

  async function assignCurrentMemberToShift(shiftId: number) {
    if (!eventId.value || shiftSaving.value) return

    try {
      shiftSaving.value = true
      const res = await apiFetch<AddSelfToShiftResponse>(`/api/events/${eventId.value}/shifts/${shiftId}/self`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error(res.error)

      shiftSlots.value = res.shifts.map(mapPersistedShiftToPanel)
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedSaveShifts'))
    }
    finally {
      shiftSaving.value = false
    }
  }

  async function removeCurrentMemberFromShift(shiftId: number) {
    if (!eventId.value || shiftSaving.value) return

    try {
      shiftSaving.value = true
      const res = await apiFetch<RemoveSelfFromShiftResponse>(`/api/events/${eventId.value}/shifts/${shiftId}/self`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(res.error)

      shiftSlots.value = res.shifts.map(mapPersistedShiftToPanel)
    }
    catch (err: any) {
      toast.error(err?.message || t('event.planning.failedSaveShifts'))
    }
    finally {
      shiftSaving.value = false
    }
  }

  function reset() {
    shiftSlots.value = []
    shiftTemplates.value = []
    shiftTypeDescriptions.value = {}
    currentMemberId.value = null
    canManageShifts.value = false
    canSelfSignup.value = false
  }

  return {
    shiftSlots,
    shiftTemplates,
    shiftTypeDescriptions,
    shiftPermissionMode,
    currentMemberId,
    shiftLoading,
    shiftSaving,
    canManageShifts,
    canSelfSignup,
    loadShiftSlots,
    saveShiftSlots,
    saveShiftTemplates,
    saveShiftTypeDescriptions,
    assignCurrentMemberToShift,
    removeCurrentMemberFromShift,
    reset,
  }
}
