import { describe, expect, it } from 'vitest'
import {
  calculateInvoicePositionTotals,
  invoiceNeedsUploadedFile,
  materializeFinalInvoiceTexts,
  normalizeInvoicePayload,
  validateInvoicePayload,
} from '~/server/utils/invoices'
import { InvoiceSourceType, InvoiceStatus, type CreateInvoiceBody } from '~/types/invoice'

function validPayload(overrides: Record<string, any> = {}) {
  return {
    company_id: 1,
    invoice_date: '2026-01-15',
    due_date: '2026-02-15',
    invoice_number: 'R-2026-001',
    source_type: InvoiceSourceType.Generated,
    status: InvoiceStatus.Draft,
    paid_at: null,
    positions: [
      { name: 'Position', sphere: 1, cost_centre: 1, quantity: 2, unit_price: 10, tax: 19 },
    ],
    ...overrides,
  }
}

describe('validateInvoicePayload', () => {
  it('accepts a complete payload', () => {
    expect(validateInvoicePayload(validPayload())).toBeNull()
  })

  it.each([
    ['missing company', { company_id: null }],
    ['missing invoice date', { invoice_date: '' }],
    ['missing due date', { due_date: '' }],
    ['blank invoice number', { invoice_number: '   ' }],
    ['unknown source type', { source_type: 'scanned' }],
    ['unknown status', { status: 'archived' }],
    ['no positions', { positions: [] }],
  ])('rejects %s', (_label, overrides) => {
    expect(validateInvoicePayload(validPayload(overrides))).toBeTruthy()
  })

  it('rejects a non-object payload', () => {
    expect(validateInvoicePayload(null)).toBe('Missing invoice data')
    expect(validateInvoicePayload('invoice')).toBe('Missing invoice data')
  })

  // The paid/paid_at pair is the invariant the paid-invoice reporting depends on.
  it('requires a payment date exactly when the invoice is paid', () => {
    expect(validateInvoicePayload(validPayload({ status: InvoiceStatus.Paid, paid_at: null })))
      .toBe('Paid invoices require a payment date')
    expect(validateInvoicePayload(validPayload({ status: InvoiceStatus.Open, paid_at: '2026-02-01' })))
      .toBe('Only paid invoices can have a payment date')
    expect(validateInvoicePayload(validPayload({ status: InvoiceStatus.Paid, paid_at: '2026-02-01' })))
      .toBeNull()
  })

  it.each([
    ['a blank name', { name: '  ' }],
    ['a missing sphere', { sphere: 0 }],
    ['a fractional sphere', { sphere: 1.5 }],
    ['a missing cost centre', { cost_centre: null }],
    ['a zero quantity', { quantity: 0 }],
    ['a negative quantity', { quantity: -1 }],
    ['a negative unit price', { unit_price: -0.01 }],
    ['a negative tax rate', { tax: -19 }],
    ['a non-numeric quantity', { quantity: 'zwei' }],
  ])('rejects a position with %s', (_label, overrides) => {
    const payload = validPayload({
      positions: [{ name: 'Position', sphere: 1, cost_centre: 1, quantity: 1, unit_price: 10, tax: 19, ...overrides }],
    })
    expect(validateInvoicePayload(payload)).toBeTruthy()
  })

  it('allows a zero unit price and a zero tax rate', () => {
    const payload = validPayload({
      positions: [{ name: 'Gratis', sphere: 1, cost_centre: 1, quantity: 1, unit_price: 0, tax: 0 }],
    })
    expect(validateInvoicePayload(payload)).toBeNull()
  })
})

describe('calculateInvoicePositionTotals', () => {
  it('sums net and gross across positions', () => {
    const { netTotal, grossTotal } = calculateInvoicePositionTotals([
      { quantity: 2, unit_price: 10, tax: 19 },
      { quantity: 1, unit_price: 100, tax: 7 },
    ])

    expect(netTotal).toBeCloseTo(120, 10)
    expect(grossTotal).toBeCloseTo(2 * 10 * 1.19 + 100 * 1.07, 10)
  })

  it('groups the tax amounts by rate', () => {
    const { taxBreakdown } = calculateInvoicePositionTotals([
      { quantity: 1, unit_price: 100, tax: 19 },
      { quantity: 2, unit_price: 50, tax: 19 },
      { quantity: 1, unit_price: 100, tax: 7 },
    ])

    expect([...taxBreakdown.keys()].sort((a, b) => a - b)).toEqual([7, 19])
    expect(taxBreakdown.get(19)).toBeCloseTo(38, 10)
    expect(taxBreakdown.get(7)).toBeCloseTo(7, 10)
  })

  it('returns zeroes for an empty invoice', () => {
    const { netTotal, grossTotal, taxBreakdown } = calculateInvoicePositionTotals([])
    expect(netTotal).toBe(0)
    expect(grossTotal).toBe(0)
    expect(taxBreakdown.size).toBe(0)
  })
})

describe('invoiceNeedsUploadedFile', () => {
  it('only demands a file for uploaded invoices', () => {
    expect(invoiceNeedsUploadedFile(InvoiceSourceType.Upload)).toBe(true)
    expect(invoiceNeedsUploadedFile(InvoiceSourceType.Generated)).toBe(false)
  })
})

describe('normalizeInvoicePayload', () => {
  it('coerces numbers, trims text and nulls out blanks', () => {
    const normalized = normalizeInvoicePayload({
      company_id: '7',
      source_type: InvoiceSourceType.Generated,
      is_kleinunternehmer: 1,
      invoice_date: '2026-01-15',
      due_date: '2026-02-15',
      paid_at: null,
      contact_person: '  Anna  ',
      recipient_attention: '  Max Mustermann  ',
      service_date: null,
      invoice_number: '  R-1  ',
      subject: '   ',
      intro_text: null,
      notes: undefined,
      status: InvoiceStatus.Draft,
      positions: [
        { name: '  Bier  ', description: '  ', sphere: '2', cost_centre: '3', quantity: '4', unit: ' Kiste ', unit_price: '9.5', tax: '19' },
      ],
    } as unknown as CreateInvoiceBody)

    expect(normalized.company_id).toBe(7)
    expect(normalized.is_kleinunternehmer).toBe(true)
    expect(normalized.contact_person).toBe('Anna')
    expect(normalized.recipient_attention).toBe('Max Mustermann')
    expect(normalized.invoice_number).toBe('R-1')
    expect(normalized.subject).toBeNull()
    expect(normalized.notes).toBeNull()
    expect(normalized.positions[0]).toMatchObject({
      name: 'Bier',
      description: null,
      sphere: 2,
      cost_centre: 3,
      quantity: 4,
      unit: 'Kiste',
      unit_price: 9.5,
      tax: 19,
    })
  })
})

describe('materializeFinalInvoiceTexts', () => {
  const settings = {
    invoice_number_template: '{year}-{increment}',
    invoice_number_next_increment: 1,
    invoice_number_increment_digits: 3,
    invoice_number_manual_edit_disabled: false,
    subject: 'Rechnung {{invoice_number}}',
    intro_text: 'Hallo {{contact_person}}, zahlbar bis {{due_date}}.',
    notes: '',
    is_kleinunternehmer_default: false,
  }

  const base = {
    invoice_number: 'R-2026-001',
    contact_person: 'Anna',
    invoice_date: '2026-01-15',
    service_date: null,
    due_date: '2026-02-15',
    subject: null,
    intro_text: null,
    notes: null,
  } as unknown as CreateInvoiceBody

  // A draft's texts stay templates so they still re-render when it is finalised later.
  it('leaves a draft untouched', () => {
    const draft = { ...base, status: InvoiceStatus.Draft }
    expect(materializeFinalInvoiceTexts(draft, settings, null)).toBe(draft)
  })

  it('renders the settings templates once the invoice leaves draft', () => {
    const result = materializeFinalInvoiceTexts(
      { ...base, status: InvoiceStatus.Open },
      settings,
      { name: 'FSi' } as any,
    )

    expect(result.subject).toBe('Rechnung R-2026-001')
    expect(result.intro_text).toBe('Hallo Anna, zahlbar bis 15.02.2026.')
    expect(result.notes).toBeNull()
  })

  it('prefers texts already set on the invoice over the settings defaults', () => {
    const result = materializeFinalInvoiceTexts(
      { ...base, status: InvoiceStatus.Open, subject: 'Eigener Betreff' },
      settings,
      null,
    )
    expect(result.subject).toBe('Eigener Betreff')
  })
})
