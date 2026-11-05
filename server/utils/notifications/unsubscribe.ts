import { query } from '~/server/utils/db'
import { hmacToken } from '~/server/utils/auth'
import { setPreference } from '~/server/utils/notifications/preferences'
import { translate } from '~/shared/i18n'

interface UnsubscribeTarget {
  member_id: number | null
  type_key: string
}

export async function findUnsubscribeTarget(token: string): Promise<UnsubscribeTarget | null> {
  if (!token) return null
  const [delivery] = await query<UnsubscribeTarget[]>(
    `SELECT nd.member_id, n.type_key
     FROM notification_deliveries nd
     JOIN notifications n ON n.id = nd.notification_id
     WHERE nd.unsubscribe_token = ? AND nd.channel = 'email'
     LIMIT 1`,
    [hmacToken(token)],
  )
  return delivery && delivery.member_id ? delivery : null
}

export async function unsubscribe(token: string) {
  const target = await findUnsubscribeTarget(token)
  if (!target) return false
  await setPreference('member', Number(target.member_id), target.type_key as any, 'email', false)
  return true
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
}

// Same default locale as everywhere else in the notification pipeline (see recipients.ts).
const LOCALE = 'de' as const

function page(body: string) {
  const title = translate(LOCALE, 'notifications.unsubscribe.title')
  return `<!doctype html><html lang="${LOCALE}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="font-family: sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; text-align: center; color: #1e293b;">
<h1>${escapeHtml(title)}</h1>${body}
</body></html>`
}

export function renderUnsubscribeResult(success: boolean) {
  return page(`<p>${escapeHtml(translate(LOCALE, success ? 'notifications.unsubscribe.success' : 'notifications.unsubscribe.error'))}</p>`)
}

/** GET only shows this; mail scanners that follow links no longer unsubscribe anyone (SEC-26). */
export function renderUnsubscribeConfirmation(token: string) {
  const question = translate(LOCALE, 'notifications.unsubscribe.confirmQuestion')
  const button = translate(LOCALE, 'notifications.unsubscribe.confirmButton')
  return page(`<p>${escapeHtml(question)}</p>
<form method="post">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<button type="submit" style="font: inherit; padding: .6rem 1.2rem; border-radius: .5rem; border: 0; background: #1e293b; color: #fff; cursor: pointer;">${escapeHtml(button)}</button>
</form>`)
}
