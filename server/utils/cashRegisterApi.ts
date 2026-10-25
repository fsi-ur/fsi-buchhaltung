import {
  parseCashRegisterView,
  VIEW_FILTER_KEY_PATTERN,
  VIEW_FILTER_VALUE_MAX_LENGTH,
  type CashRegisterViewParseResult,
} from '~/shared/cashRegisterView'

// Client for the kassensystem's integration API. Only this server talks to it
// (the key never reaches a browser); the kassensystem decides the content of
// the overview, see shared/cashRegisterView.ts.
const cashRegisterMode = (process.env.CASH_REGISTER_MODE || 'standalone').toLowerCase()

export function isCashRegisterConnected() {
  return cashRegisterMode === 'connected'
}

function apiConfig() {
  const baseUrl = (process.env.CASH_REGISTER_API_URL || '').trim().replace(/\/+$/, '')
  const apiKey = (process.env.CASH_REGISTER_API_KEY || '').trim()
  const timeout = Number(process.env.CASH_REGISTER_API_TIMEOUT_MS || 10_000)
  if (!baseUrl || !apiKey) return null
  return { baseUrl, apiKey, timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 10_000 }
}

/** Only well-formed filter params are passed on; the kassensystem validates their values. */
export function pickCashRegisterFilters(query: Record<string, unknown>): Record<string, string> {
  const filters: Record<string, string> = {}
  for (const [name, value] of Object.entries(query)) {
    if (!name.startsWith('f.') || typeof value !== 'string') continue
    const key = name.slice(2)
    if (!VIEW_FILTER_KEY_PATTERN.test(key) || key === 'locale' || value.length > VIEW_FILTER_VALUE_MAX_LENGTH) continue
    filters[key] = value
    if (Object.keys(filters).length >= 10) break
  }
  return filters
}

export type CashRegisterFetchResult =
  | CashRegisterViewParseResult
  | { ok: false, error: 'notConfigured' | 'unreachable' }

export async function fetchCashRegisterEventOverview(
  accountingEventId: number,
  options: { locale: 'de' | 'en', filters: Record<string, string> },
): Promise<CashRegisterFetchResult> {
  const config = apiConfig()
  if (!config) return { ok: false, error: 'notConfigured' }

  const url = new URL(`${config.baseUrl}/api/integration/v1/events/${accountingEventId}/overview`)
  url.searchParams.set('locale', options.locale)
  for (const [key, value] of Object.entries(options.filters)) url.searchParams.set(key, value)

  let body: unknown
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${config.apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(config.timeout),
    })
    if (!response.ok) return { ok: false, error: 'unreachable' }
    body = await response.json()
  } catch {
    return { ok: false, error: 'unreachable' }
  }

  return parseCashRegisterView(body)
}
