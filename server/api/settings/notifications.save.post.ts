import { defineEventHandler, readBody } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { withAuditTransaction } from '~/server/utils/db'
import { getNotificationSettings, normalizeTemplateAttachments, saveNotificationSettings, validateNotificationSettings } from '~/server/utils/notifications/settings'
import { checkAttachableFiles } from '~/server/utils/fileAccess'
import { requestImmediateDispatch } from '~/server/utils/notifications/dispatchTrigger'
import type { NotificationSettings } from '~/types/notification'

interface SaveNotificationSettingsSuccess { ok: true, settings: NotificationSettings }
interface SaveNotificationSettingsError { ok: false, error: string }
export type SaveNotificationSettingsResponse = SaveNotificationSettingsSuccess | SaveNotificationSettingsError

export default defineEventHandler(async (event): Promise<SaveNotificationSettingsResponse> => {
  const current = await requirePermission(event, 'settings.notifications.manage', { touch: false })
  if (!current.ok) return current

  const body = await readBody<Partial<NotificationSettings>>(event)
  const validationError = validateNotificationSettings(body)
  if (validationError) return { ok: false, error: validationError }

  // Template files become readable for every recipient of that notification type (SEC-02).
  if (body.template_attachments !== undefined) {
    const templates = normalizeTemplateAttachments(body.template_attachments)
    if (!templates.ok) return templates
    const previous = await getNotificationSettings()
    const previousFileIds = Object.values(previous.template_attachments).flatMap(selection => selection?.fileIds ?? [])
    const requestedFileIds = Object.values(templates.value).flatMap(selection => selection?.fileIds ?? [])
    const fileError = await checkAttachableFiles(event, current.user, requestedFileIds, previousFileIds)
    if (fileError) return { ok: false, error: fileError }
  }

  const settings = await withAuditTransaction(current.user, async conn => saveNotificationSettings(body, conn))

  // Lead times, quiet hours and the understaffing switch all change which reminders should exist.
  // Re-plan right away instead of waiting for the next periodic pass: the sweep drops reminders the
  // new configuration no longer calls for and schedules the ones it now does.
  requestImmediateDispatch()

  return { ok: true, settings }
})
