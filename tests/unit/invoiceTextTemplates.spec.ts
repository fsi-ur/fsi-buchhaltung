import { describe, expect, it } from 'vitest'
import {
  formatInvoiceTemplateDate,
  renderInvoiceNumberTemplate,
  renderInvoiceTextTemplate,
} from '~/utils/invoiceTextTemplates'

describe('formatInvoiceTemplateDate', () => {
  it('renders an ISO date in German notation', () => {
    expect(formatInvoiceTemplateDate('2026-01-15')).toBe('15.01.2026')
  })

  it('passes anything unrecognised through unchanged', () => {
    expect(formatInvoiceTemplateDate('15.01.2026')).toBe('15.01.2026')
    expect(formatInvoiceTemplateDate('2026-01-15T10:00:00')).toBe('2026-01-15T10:00:00')
  })

  it('renders an absent date as an empty string', () => {
    expect(formatInvoiceTemplateDate(null)).toBe('')
    expect(formatInvoiceTemplateDate(undefined)).toBe('')
    expect(formatInvoiceTemplateDate('')).toBe('')
  })
})

describe('renderInvoiceTextTemplate', () => {
  const context = {
    invoice_number: 'R-2026-001',
    association_name: 'FSi',
    contact_person: 'Anna',
    invoice_date: '2026-01-15',
    service_date: '2026-01-10',
    due_date: '2026-02-15',
  }

  it('supports both the single- and double-brace spellings', () => {
    expect(renderInvoiceTextTemplate('{{invoice_number}} / {invoice_number}', context))
      .toBe('R-2026-001 / R-2026-001')
  })

  it('tolerates whitespace inside the braces', () => {
    expect(renderInvoiceTextTemplate('{{  invoice_number  }}', context)).toBe('R-2026-001')
  })

  it('derives the date parts from the invoice date', () => {
    expect(renderInvoiceTextTemplate('{year}-{month}-{day}', context)).toBe('2026-01-15')
    expect(renderInvoiceTextTemplate('{date}', context)).toBe('15.01.2026')
  })

  it('formats every date placeholder in German notation', () => {
    expect(renderInvoiceTextTemplate('{invoice_date}|{service_date}|{due_date}', context))
      .toBe('15.01.2026|10.01.2026|15.02.2026')
  })

  // A one-day service falls back to the invoice date rather than rendering blank.
  it('falls back to the invoice date when no service date is set', () => {
    expect(renderInvoiceTextTemplate('{service_date}', { ...context, service_date: null }))
      .toBe('15.01.2026')
  })

  it('falls back to the association name when there is no contact person', () => {
    expect(renderInvoiceTextTemplate('{contact_person}', { ...context, contact_person: null }))
      .toBe('FSi')
  })

  it('renders the recipient attention name, or nothing when unset', () => {
    expect(renderInvoiceTextTemplate('Hallo {recipient_attention}', { ...context, recipient_attention: ' Max ' })).toBe('Hallo Max')
    expect(renderInvoiceTextTemplate('{recipient_attention}', context)).toBe('')
  })

  // An unknown placeholder must survive verbatim
  it('leaves an unknown placeholder untouched', () => {
    expect(renderInvoiceTextTemplate('Hallo {{empfaenger}}', context)).toBe('Hallo {{empfaenger}}')
  })

  it('renders an empty template as an empty string', () => {
    expect(renderInvoiceTextTemplate('', context)).toBe('')
    expect(renderInvoiceTextTemplate(null as any, context)).toBe('')
  })
})

describe('renderInvoiceNumberTemplate', () => {
  it('pads the increment to the configured width', () => {
    expect(renderInvoiceNumberTemplate('{year}-{increment}', '2026-01-15', 7, 3)).toBe('2026-007')
  })

  it('defaults to a single digit', () => {
    expect(renderInvoiceNumberTemplate('{increment}', '2026-01-15', 7)).toBe('7')
  })

  it('does not truncate an increment wider than the configured width', () => {
    expect(renderInvoiceNumberTemplate('{increment}', '2026-01-15', 1234, 2)).toBe('1234')
  })

  it('falls back to 1 for a non-positive or fractional increment', () => {
    expect(renderInvoiceNumberTemplate('{increment}', '2026-01-15', 0, 2)).toBe('01')
    expect(renderInvoiceNumberTemplate('{increment}', '2026-01-15', -5, 2)).toBe('01')
    expect(renderInvoiceNumberTemplate('{increment}', '2026-01-15', 1.5, 2)).toBe('01')
  })

  it('combines date parts with the increment', () => {
    expect(renderInvoiceNumberTemplate('FSi-{year}{month}-{increment}', '2026-03-04', 12, 4))
      .toBe('FSi-202603-0012')
  })

  it('renders empty date parts when no invoice date is known', () => {
    expect(renderInvoiceNumberTemplate('{year}-{increment}', null, 1, 2)).toBe('-01')
  })
})
