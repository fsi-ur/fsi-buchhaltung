// The kassensystem's event overview as delivered by its integration API
// (GET /api/integration/v1/events/:id/overview). The kassensystem describes the
// overview as generic, already translated building blocks; this app only knows
// how to draw them (components/Page/Events/planning/cashRegister/). New
// figures or sections therefore ship with the kassensystem alone.
//
// Copy of the kassensystem's server/utils/integration/viewContract.ts. The
// response is foreign input, so parseCashRegisterView() keeps only what
// matches these types: unknown block types (from a newer kassensystem) and
// malformed parts are dropped instead of breaking the tab.

export const CASH_REGISTER_CONTRACT_VERSION = 1

export type ViewTone = 'default' | 'muted' | 'accent' | 'info' | 'success' | 'warning' | 'danger'
export type ViewValueFormat = 'text' | 'number' | 'signedNumber' | 'currency' | 'signedCurrency' | 'percent'

export interface ViewValue {
  value: number | string | null
  format?: ViewValueFormat
  tone?: ViewTone
  prefix?: string
  suffix?: string
}

export type ViewCell = ViewValue | string | number | null

export interface ViewFilterAction {
  key: string
  value: string
}

export interface ViewFilter {
  key: string
  label: string
  value: string
  options: Array<{ value: string, label: string }>
  activeNote?: string
}

export interface ViewStatTile {
  label: string
  value: ViewCell
  meta?: string
  icon?: string
  tone?: ViewTone
}

export interface ViewTableColumn {
  label: string
  align?: 'left' | 'right'
}

export interface ViewTableRow {
  key: string
  cells: ViewCell[]
  bar?: number
  note?: string
  badge?: { label: string, tone?: ViewTone }
  filter?: ViewFilterAction
  selected?: boolean
}

export interface ViewListItem {
  label: string
  value: ViewCell
  style?: 'normal' | 'strong' | 'muted' | 'indent'
  tone?: ViewTone
}

export type ViewBlock =
  | { type: 'table', title?: string, columns: ViewTableColumn[], rows: ViewTableRow[], footer?: ViewCell[], empty?: string, notes?: string[] }
  | { type: 'list', title?: string, items: ViewListItem[], notes?: string[] }
  | { type: 'metric', label?: string, value: ViewCell, caption?: string, tone?: ViewTone }
  | { type: 'hourlyChart', title?: string, points: Array<{ hour: string, value: number, caption?: string }>, valueFormat?: ViewValueFormat, empty?: string, notes?: string[] }
  | { type: 'text', text: string, tone?: ViewTone, style?: 'normal' | 'note' }

export type ViewSection =
  | { type: 'stats', id: string, items: ViewStatTile[] }
  | { type: 'alert', id: string, text: string, tone?: ViewTone, icon?: string }
  | { type: 'card', id: string, title: string, icon?: string, tone?: ViewTone, width?: 'full' | 'half', columns?: 1 | 2, blocks: ViewBlock[] }

/** Figures for the whole event that this app may calculate with (sections are display only). */
export interface CashRegisterEventTotals {
  orderRevenue: number
  orderRevenueCash: number
  orderRevenueCard: number
  depositNet: number
  donations: number
  fachschaftPayments: number
  fachschaftPaymentCount: number
  fachschaftGivenOutWorth: number
  totalIncome: number
}

export interface CashRegisterView {
  event: { id: number, name: string }
  generatedAt: string
  totals: CashRegisterEventTotals
  filters: ViewFilter[]
  sections: ViewSection[]
}

export type CashRegisterViewParseResult =
  | { ok: true, linked: false }
  | { ok: true, linked: true, view: CashRegisterView }
  | { ok: false, error: 'invalid' | 'incompatible' | 'remote', message?: string }

const TONES: readonly ViewTone[] = ['default', 'muted', 'accent', 'info', 'success', 'warning', 'danger']
const FORMATS: readonly ViewValueFormat[] = ['text', 'number', 'signedNumber', 'currency', 'signedCurrency', 'percent']
const ICON_PATTERN = /^material-symbols:[a-z0-9-]{1,64}$/
/** Filter keys and values travel back to the kassensystem as query parameters. */
export const VIEW_FILTER_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/
export const VIEW_FILTER_VALUE_MAX_LENGTH = 64

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown, max = 2000) => typeof value === 'string' ? value.slice(0, max) : undefined
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]) => allowed.includes(value as T) ? value as T : undefined
const tone = (value: unknown) => oneOf(value, TONES)
const icon = (value: unknown) => typeof value === 'string' && ICON_PATTERN.test(value) ? value : undefined
const list = <T>(value: unknown, parse: (entry: unknown) => T | undefined, max = 500): T[] =>
  Array.isArray(value) ? value.slice(0, max).map(parse).filter((entry): entry is T => entry !== undefined) : []
const notes = (value: unknown) => {
  const entries = list(value, entry => str(entry), 20)
  return entries.length ? entries : undefined
}

/** Drops undefined properties so parsed objects stay minimal. */
function compact<T extends Json>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key]
  }
  return value
}

function parseCell(value: unknown): ViewCell | undefined {
  if (value === null) return null
  if (typeof value === 'string') return value.slice(0, 500)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (!isObject(value)) return undefined

  const raw = value.value
  return compact({
    value: typeof raw === 'string' ? raw.slice(0, 500) : (num(raw) ?? null),
    format: oneOf(value.format, FORMATS),
    tone: tone(value.tone),
    prefix: str(value.prefix, 20),
    suffix: str(value.suffix, 40),
  })
}

/** Table cells keep their position: an unreadable cell becomes empty instead of shifting the columns. */
const cells = (value: unknown): ViewCell[] =>
  Array.isArray(value) ? value.slice(0, 20).map(cell => parseCell(cell) ?? null) : []

function parseFilterAction(value: unknown): ViewFilterAction | undefined {
  if (!isObject(value)) return undefined
  const key = str(value.key)
  const filterValue = str(value.value)
  if (!key || !VIEW_FILTER_KEY_PATTERN.test(key) || filterValue === undefined || filterValue.length > VIEW_FILTER_VALUE_MAX_LENGTH) return undefined
  return { key, value: filterValue }
}

function parseFilter(value: unknown): ViewFilter | undefined {
  if (!isObject(value)) return undefined
  const action = parseFilterAction(value)
  const label = str(value.label, 200)
  const options = list(value.options, (option) => {
    if (!isObject(option)) return undefined
    const optionValue = str(option.value, VIEW_FILTER_VALUE_MAX_LENGTH)
    const optionLabel = str(option.label, 200)
    return optionValue !== undefined && optionLabel !== undefined ? { value: optionValue, label: optionLabel } : undefined
  })
  if (!action || label === undefined || !options.length) return undefined
  return compact({ key: action.key, label, value: action.value, options, activeNote: str(value.activeNote) })
}

function parseRow(value: unknown, index: number): ViewTableRow | undefined {
  if (!isObject(value)) return undefined
  const badge = isObject(value.badge) && str(value.badge.label, 100)
    ? compact({ label: str(value.badge.label, 100)!, tone: tone(value.badge.tone) })
    : undefined
  const bar = num(value.bar)
  return compact({
    key: str(value.key, 200) ?? String(index),
    cells: cells(value.cells),
    bar: bar === undefined ? undefined : Math.min(100, Math.max(0, bar)),
    note: str(value.note),
    badge,
    filter: parseFilterAction(value.filter),
    selected: value.selected === true ? true : undefined,
  })
}

function parseBlock(value: unknown): ViewBlock | undefined {
  if (!isObject(value)) return undefined

  switch (value.type) {
    case 'table': {
      const columns = list(value.columns, (column) => {
        if (!isObject(column) || str(column.label, 200) === undefined) return undefined
        return compact({ label: str(column.label, 200)!, align: oneOf(column.align, ['left', 'right'] as const) })
      }, 20)
      if (!columns.length) return undefined
      const footer = Array.isArray(value.footer) ? cells(value.footer) : undefined
      return compact({
        type: 'table' as const,
        title: str(value.title, 200),
        columns,
        rows: Array.isArray(value.rows) ? value.rows.slice(0, 1000).map(parseRow).filter((row): row is ViewTableRow => row !== undefined) : [],
        footer: footer?.length ? footer : undefined,
        empty: str(value.empty),
        notes: notes(value.notes),
      })
    }
    case 'list':
      return compact({
        type: 'list' as const,
        title: str(value.title, 200),
        items: list(value.items, (item) => {
          if (!isObject(item) || str(item.label, 300) === undefined) return undefined
          return compact({
            label: str(item.label, 300)!,
            value: parseCell(item.value) ?? null,
            style: oneOf(item.style, ['normal', 'strong', 'muted', 'indent'] as const),
            tone: tone(item.tone),
          })
        }, 100),
        notes: notes(value.notes),
      })
    case 'metric':
      return compact({
        type: 'metric' as const,
        label: str(value.label, 200),
        value: parseCell(value.value) ?? null,
        caption: str(value.caption),
        tone: tone(value.tone),
      })
    case 'hourlyChart':
      return compact({
        type: 'hourlyChart' as const,
        title: str(value.title, 200),
        points: list(value.points, (point) => {
          if (!isObject(point)) return undefined
          const hour = str(point.hour, 40)
          const pointValue = num(point.value)
          // Only real instants: the chart converts them into the app time zone.
          if (!hour || pointValue === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(hour)) return undefined
          return compact({ hour, value: pointValue, caption: str(point.caption, 100) })
        }, 24 * 60),
        valueFormat: oneOf(value.valueFormat, FORMATS),
        empty: str(value.empty),
        notes: notes(value.notes),
      })
    case 'text': {
      const text = str(value.text)
      if (text === undefined) return undefined
      return compact({ type: 'text' as const, text, tone: tone(value.tone), style: oneOf(value.style, ['normal', 'note'] as const) })
    }
    default:
      return undefined
  }
}

function parseSection(value: unknown, index: number): ViewSection | undefined {
  if (!isObject(value)) return undefined
  const id = str(value.id, 100) ?? `section-${index}`

  switch (value.type) {
    case 'stats': {
      const items = list(value.items, (item) => {
        if (!isObject(item) || str(item.label, 200) === undefined) return undefined
        return compact({
          label: str(item.label, 200)!,
          value: parseCell(item.value) ?? null,
          meta: str(item.meta),
          icon: icon(item.icon),
          tone: tone(item.tone),
        })
      }, 12)
      return items.length ? { type: 'stats', id, items } : undefined
    }
    case 'alert': {
      const text = str(value.text)
      return text === undefined ? undefined : compact({ type: 'alert' as const, id, text, tone: tone(value.tone), icon: icon(value.icon) })
    }
    case 'card': {
      const title = str(value.title, 200)
      const blocks = list(value.blocks, parseBlock, 20)
      if (title === undefined || !blocks.length) return undefined
      return compact({
        type: 'card' as const,
        id,
        title,
        icon: icon(value.icon),
        tone: tone(value.tone),
        width: oneOf(value.width, ['full', 'half'] as const),
        columns: value.columns === 2 ? 2 as const : undefined,
        blocks,
      })
    }
    default:
      return undefined
  }
}

const TOTAL_KEYS: Array<keyof CashRegisterEventTotals> = [
  'orderRevenue', 'orderRevenueCash', 'orderRevenueCard', 'depositNet', 'donations',
  'fachschaftPayments', 'fachschaftPaymentCount', 'fachschaftGivenOutWorth', 'totalIncome',
]

export function parseCashRegisterView(body: unknown): CashRegisterViewParseResult {
  if (!isObject(body)) return { ok: false, error: 'invalid' }
  if (body.ok !== true) return { ok: false, error: 'remote', message: str(body.error, 300) }
  if (num(body.contractVersion) !== CASH_REGISTER_CONTRACT_VERSION) return { ok: false, error: 'incompatible' }
  if (body.linked === false) return { ok: true, linked: false }
  if (body.linked !== true || !isObject(body.event) || !isObject(body.totals)) return { ok: false, error: 'invalid' }

  const totals = {} as CashRegisterEventTotals
  for (const key of TOTAL_KEYS) {
    const value = num(body.totals[key])
    if (value === undefined) return { ok: false, error: 'invalid' }
    totals[key] = value
  }

  return {
    ok: true,
    linked: true,
    view: {
      event: { id: num(body.event.id) ?? 0, name: str(body.event.name, 300) ?? '' },
      generatedAt: str(body.generatedAt, 40) ?? '',
      totals,
      filters: list(body.filters, parseFilter, 10),
      sections: Array.isArray(body.sections)
        ? body.sections.slice(0, 50).map(parseSection).filter((section): section is ViewSection => section !== undefined)
        : [],
    },
  }
}
