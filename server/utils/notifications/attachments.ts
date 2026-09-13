import { loadAttachmentSelection, mergeAttachmentSelections, saveAttachmentSelection } from '~/server/utils/attachments'
import type { NotificationTypeKey } from '~/config/notificationTypes'
import type { AttachmentSelection, NotificationSettings } from '~/types/notification'
import type { DbConn } from '~/server/utils/notifications/types'

export const NOTIFICATION_ENTITY_TYPE = 'notification'

export async function saveNotificationAttachments(
  notificationId: number,
  selection: AttachmentSelection,
  userId: number | null,
  conn?: DbConn,
) {
  await saveAttachmentSelection(NOTIFICATION_ENTITY_TYPE, notificationId, selection, userId, conn)
}

export async function getNotificationAttachments(notificationId: number, conn?: DbConn): Promise<AttachmentSelection> {
  return loadAttachmentSelection(NOTIFICATION_ENTITY_TYPE, notificationId, conn)
}

export async function resolveNotificationAttachments(
  notificationId: number,
  typeKey: NotificationTypeKey,
  settings: NotificationSettings,
  conn?: DbConn,
): Promise<AttachmentSelection> {
  const own = await getNotificationAttachments(notificationId, conn)
  return mergeAttachmentSelections(own, settings.template_attachments[typeKey])
}
