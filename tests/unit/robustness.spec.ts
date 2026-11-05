import { describe, expect, it } from 'vitest'
import { renderNotification } from '~/server/utils/notifications/render'
import { DEFAULT_NOTIFICATION_SETTINGS } from '~/server/utils/notifications/settings'
import { renderArticle } from '~/server/utils/wiki/render'

// SEC-33
describe('notification placeholders', () => {
  it('does not expand placeholders that appear inside substituted values', () => {
    const rendered = renderNotification({
      type: 'custom.message',
      locale: 'de',
      payload: { member_name: '{association_iban}', association_iban: 'DE00 1234' },
      settings: DEFAULT_NOTIFICATION_SETTINGS,
      bodyOverride: 'Hallo {member_name}, unbekannt bleibt {gibts_nicht}',
      subjectOverride: 'Betreff',
    } as any)
    expect(rendered.body).toContain('Hallo {association_iban}')
    expect(rendered.body).not.toContain('DE00 1234')
    expect(rendered.body).toContain('{gibts_nicht}')
  })
})

describe('wiki tool links', () => {
  it('accept flat meta values only', () => {
    expect(renderArticle(':::tool{page="ReceiptList" meta=\'{"receiptId":5}\'}').ok).toBe(true)
    expect(renderArticle(':::tool{page="ReceiptList" meta=\'{"returnTarget":{"page":"X"}}\'}').ok).toBe(false)
    expect(renderArticle(':::tool{page="ReceiptList" meta=\'{"nested":{"a":1}}\'}').ok).toBe(false)
  })
})
