import { defineEventHandler, getQuery, getRouterParam } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import {
  fetchCashRegisterEventOverview,
  isCashRegisterConnected,
  pickCashRegisterFilters,
} from '~/server/utils/cashRegisterApi'
import type { CashRegisterView } from '~/shared/cashRegisterView'

export type CashRegisterErrorReason = 'notConfigured' | 'unreachable' | 'rejected' | 'incompatible' | 'invalid'

export type EventCashRegisterResponse =
  | { ok: true, connected: false }
  | { ok: true, connected: true, linked: false }
  | { ok: true, connected: true, linked: true, view: CashRegisterView }
  | { ok: false, error: string, reason?: CashRegisterErrorReason }

const ERRORS: Record<CashRegisterErrorReason, string> = {
  notConfigured: 'Die Verbindung zum Kassensystem ist nicht eingerichtet',
  unreachable: 'Das Kassensystem ist nicht erreichbar',
  rejected: 'Das Kassensystem hat die Anfrage abgelehnt',
  incompatible: 'Die Version des Kassensystems passt nicht zu dieser Buchhaltung',
  invalid: 'Das Kassensystem hat ungültige Daten geliefert',
}

// Proxies the kassensystem's event overview (see server/utils/cashRegisterApi.ts).
// Filters are passed through as `f.<key>` query params, so filters the
// kassensystem adds later work without a change here.
export default defineEventHandler(async (event): Promise<EventCashRegisterResponse> => {
  const current = await requirePermission(event, 'cash_register.manage')
  if (!current.ok) return current

  const accountingEventId = Number(getRouterParam(event, 'id'))
  if (!Number.isInteger(accountingEventId) || accountingEventId <= 0) {
    return { ok: false, error: 'Invalid event id' }
  }

  if (!isCashRegisterConnected()) {
    return { ok: true, connected: false }
  }

  const query = getQuery(event)
  const result = await fetchCashRegisterEventOverview(accountingEventId, {
    locale: query.locale === 'en' ? 'en' : 'de',
    filters: pickCashRegisterFilters(query),
  })

  if (!result.ok) {
    const reason: CashRegisterErrorReason = result.error === 'remote' ? 'rejected' : result.error
    return { ok: false, error: ERRORS[reason], reason }
  }

  if (!result.linked) {
    return { ok: true, connected: true, linked: false }
  }

  return { ok: true, connected: true, linked: true, view: result.view }
})
