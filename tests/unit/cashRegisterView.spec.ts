import { describe, expect, it } from 'vitest'
import { CASH_REGISTER_CONTRACT_VERSION, parseCashRegisterView } from '~/shared/cashRegisterView'
import { pickCashRegisterFilters } from '~/server/utils/cashRegisterApi'
import { formatViewCell } from '~/utils/cashRegisterViewFormat'

const totals = {
  orderRevenue: 120,
  orderRevenueCash: 100,
  orderRevenueCard: 20,
  depositNet: 4,
  donations: 5,
  fachschaftPayments: 30,
  fachschaftPaymentCount: 3,
  fachschaftGivenOutWorth: 12,
  totalIncome: 155,
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    contractVersion: CASH_REGISTER_CONTRACT_VERSION,
    linked: true,
    event: { id: 7, name: 'Sommerfest' },
    generatedAt: '2026-10-25T12:00:00.000Z',
    totals,
    filters: [],
    sections: [],
    ...overrides,
  }
}

describe('parseCashRegisterView', () => {
  it('accepts an unlinked event', () => {
    expect(parseCashRegisterView({ ok: true, contractVersion: 1, linked: false })).toEqual({ ok: true, linked: false })
  })

  it('reports remote errors and other contract versions', () => {
    expect(parseCashRegisterView({ ok: false, error: 'Not authenticated' })).toEqual({ ok: false, error: 'remote', message: 'Not authenticated' })
    expect(parseCashRegisterView(response({ contractVersion: 2 }))).toEqual({ ok: false, error: 'incompatible' })
    expect(parseCashRegisterView('nope')).toEqual({ ok: false, error: 'invalid' })
    expect(parseCashRegisterView(response({ totals: { ...totals, donations: 'x' } }))).toEqual({ ok: false, error: 'invalid' })
  })

  it('keeps known sections and drops unknown or malformed ones', () => {
    const result = parseCashRegisterView(response({
      sections: [
        { type: 'stats', id: 'stats', items: [{ label: 'Umsatz', value: { value: 120, format: 'currency' }, icon: 'material-symbols:euro-rounded' }] },
        { type: 'futureWidget', id: 'x' },
        { type: 'card', id: 'empty', title: 'Leer', blocks: [{ type: 'futureBlock' }] },
        {
          type: 'card',
          id: 'sales',
          title: 'Verkäufe',
          width: 'half',
          icon: 'https://evil.example/icon.svg',
          blocks: [
            { type: 'futureBlock' },
            {
              type: 'table',
              columns: [{ label: 'Artikel' }, { label: 'Umsatz', align: 'right' }],
              rows: [{ key: 'a', cells: ['Bier', { value: 'x', format: 'nonsense' }, { broken: true }], bar: 250, filter: { key: 'standId', value: '3' } }],
            },
          ],
        },
      ],
    }))

    expect(result.ok && result.linked).toBe(true)
    if (!result.ok || !result.linked) return
    expect(result.view.sections.map(section => section.id)).toEqual(['stats', 'sales'])

    const card = result.view.sections[1]!
    if (card.type !== 'card') return
    // A non-icon URL is dropped, like the unknown block.
    expect('icon' in card).toBe(false)
    expect(card.blocks).toHaveLength(1)
    const table = card.blocks[0]!
    if (table.type !== 'table') throw new Error('expected table')
    // Unreadable cells keep their position, bars are clamped, the bad format is dropped.
    expect(table.rows[0]).toEqual({ key: 'a', cells: ['Bier', { value: 'x' }, { value: null }], bar: 100, filter: { key: 'standId', value: '3' } })
  })

  it('rejects chart points that are not instants', () => {
    const result = parseCashRegisterView(response({
      sections: [{
        type: 'card',
        id: 'hourly',
        title: 'Umsatz pro Stunde',
        blocks: [{ type: 'hourlyChart', points: [{ hour: '2026-10-25T10:00:00Z', value: 3 }, { hour: '2026-10-25 11:00:00', value: 4 }] }],
      }],
    }))
    if (!result.ok || !result.linked) throw new Error('expected a view')
    const card = result.view.sections[0]!
    if (card.type !== 'card' || card.blocks[0]!.type !== 'hourlyChart') throw new Error('expected a chart')
    expect(card.blocks[0]!.points).toEqual([{ hour: '2026-10-25T10:00:00Z', value: 3 }])
  })
})

describe('pickCashRegisterFilters', () => {
  it('passes only well-formed f.<key> params through', () => {
    expect(pickCashRegisterFilters({
      'locale': 'de',
      'f.standId': '3',
      'f.locale': 'en',
      'f.bad key': '1',
      'f.long': 'x'.repeat(65),
      'f.list': ['a', 'b'],
      'standId': '9',
    })).toEqual({ standId: '3' })
  })
})

describe('formatViewCell', () => {
  it('formats by the declared format with prefix and suffix', () => {
    expect(formatViewCell({ value: 1234.5, format: 'currency', prefix: '~' }, 'de-DE')).toBe('~1.234,50 €')
    expect(formatViewCell({ value: -2, format: 'signedNumber' }, 'de-DE')).toBe('-2')
    expect(formatViewCell({ value: 3, format: 'signedCurrency' }, 'en-US')).toBe('+€3.00')
    expect(formatViewCell({ value: 12, suffix: 'Stk.' }, 'de-DE')).toBe('12 Stk.')
    expect(formatViewCell(null, 'de-DE')).toBe('')
    expect(formatViewCell('Bier', 'de-DE')).toBe('Bier')
  })
})
