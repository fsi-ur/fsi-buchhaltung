import { defineEventHandler, getQuery, setHeader } from 'h3'
import { findUnsubscribeTarget, renderUnsubscribeConfirmation, renderUnsubscribeResult } from '~/server/utils/notifications/unsubscribe'

/** Shows a confirmation page; the actual opt-out happens on POST (unsubscribe.post.ts). */
export default defineEventHandler(async (event) => {
  const token = String(getQuery(event).token || '')
  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  if (!await findUnsubscribeTarget(token)) return renderUnsubscribeResult(false)
  return renderUnsubscribeConfirmation(token)
})
