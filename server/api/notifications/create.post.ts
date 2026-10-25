import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { withAuditTransaction } from '~/server/utils/db'
import { enqueueNotification } from '~/server/utils/notifications/enqueue'
import { getScheduleBounds, validateCustomNotification } from '~/server/utils/notifications/custom'
import type { CustomNotificationDraft } from '~/types/notification'
import { normalizeAttachmentSelection } from '~/server/utils/attachments'
import type { AttachmentSelection } from '~/types/attachment'
import type { RecipientRule } from '~/server/utils/notifications/types'
import { eventExists } from '~/server/utils/eventShifts'

function normalizeSelection(input: unknown): AttachmentSelection {
  const result = normalizeAttachmentSelection(input)
  return result.ok ? result.value : { documentIds: [], fileIds: [] }
}

interface CreateNotificationSuccess { ok: true, id: number }
interface CreateNotificationError { ok: false, error: string }
export type CreateNotificationResponse = CreateNotificationSuccess | CreateNotificationError

export default defineEventHandler(async (event): Promise<CreateNotificationResponse> => {
  const current = await requirePermission(event, 'notifications.send')
  if (!current.ok) return current

  const body = await readBody<Partial<CustomNotificationDraft>>(event)
  const bounds = await getScheduleBounds()
  const validationError = validateCustomNotification(body, bounds)
  if (validationError) return { ok: false, error: validationError }

  const rules: Exclude<RecipientRule, { kind: 'composite' }>[] = []
  if (body.allActiveMembers) rules.push({ kind: 'allActiveMembers' })
  if (body.memberIds?.length) rules.push({ kind: 'members', memberIds: body.memberIds })
  if (body.subdivisionIds?.length) rules.push({ kind: 'subdivisions', subdivisionIds: body.subdivisionIds })
  if (body.userIds?.length) rules.push({ kind: 'users', userIds: body.userIds })
  const recipients: RecipientRule = rules.length === 1 ? rules[0]! : { kind: 'composite', rules }

  // The event's shift plan, rendered per recipient with their own shifts highlighted (shiftPlan.ts).
  const payload: Record<string, unknown> = {}
  if (body.shiftPlan) {
    const eventId = Number(body.shiftPlan.eventId)
    if (!Number.isInteger(eventId) || eventId <= 0 || !await eventExists(eventId)) {
      return { ok: false, error: 'Die Veranstaltung für den Schichtplan wurde nicht gefunden.' }
    }
    payload.shift_plan_event_id = eventId
    payload.shift_plan_descriptions = Boolean(body.shiftPlan.includeDescriptions)
  }

  const result = await withAuditTransaction(current.user, async conn => enqueueNotification({
    type: 'custom.message',
    payload,
    recipients,
    scheduledFor: body.scheduledFor || null,
    createdByUserId: current.user.id,
    queueWhileDisabled: true,
    channels: body.channels,
    subjectOverride: body.subject,
    bodyOverride: body.body,
    attachments: normalizeSelection(body.attachments),
  }, conn))

  return result
})
