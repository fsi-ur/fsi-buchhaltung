import { defineEventHandler, getQuery, readBody, setHeader } from 'h3'
import { renderUnsubscribeResult, unsubscribe } from '~/server/utils/notifications/unsubscribe'

/**
 * The opt-out itself: from the confirmation page's form, or as RFC 8058 one-click POST by the mail
 * client (token in the URL, body `List-Unsubscribe=One-Click`).
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown> | string | null>(event).catch(() => null)
  const fromBody = body && typeof body === 'object' ? String(body.token || '') : ''
  const token = String(getQuery(event).token || fromBody || '')

  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  return renderUnsubscribeResult(await unsubscribe(token))
})
