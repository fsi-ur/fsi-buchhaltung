import { ReceiptStatus } from '~/types/receipt'
import { MAX_RECORD_POSITIONS, TOO_MANY_POSITIONS } from '~/server/utils/api/limits'

export function validateReceiptPayload(receipt: any) {
  if (!receipt.company_id || !receipt.receipt_date || !receipt.status || !Array.isArray(receipt.positions) || receipt.positions.length === 0) {
    return 'Missing required receipt fields'
  }
  if (receipt.positions.length > MAX_RECORD_POSITIONS) return TOO_MANY_POSITIONS

  if (receipt.positions.some((position: any) => !position?.sphere || !position?.cost_centre || position?.amount === null || position?.amount === undefined)) {
    return 'Each position requires sphere, cost centre and amount'
  }

  return null
}

export const RECEIPT_LOCKED_ERROR = 'Dieser Beleg ist Teil einer Auslage oder eines Kontoauszugs. Firma, Datum, Nummer, Positionen und Datei können nicht mehr geändert werden.'

function sameMoney(left: unknown, right: unknown) {
  return Math.round(Number(left) * 100) === Math.round(Number(right) * 100)
}

/**
 * A receipt referenced by a reimbursement or bank statement is booked (SEC-16): only its description
 * may still change. Returns true when the payload changes anything else.
 */
export function changesLockedReceiptFields(
  existing: { company_id: unknown, receipt_date: unknown, receipt_number: unknown },
  existingPositions: Array<{ id: unknown, sphere: unknown, cost_centre: unknown, amount: unknown, tax: unknown }>,
  updated: { company_id?: unknown, receipt_date?: unknown, receipt_number?: unknown, positions: any[] },
) {
  if (Number(existing.company_id) !== Number(updated.company_id)) return true
  if (String(existing.receipt_date ?? '').slice(0, 10) !== String(updated.receipt_date ?? '').slice(0, 10)) return true
  if ((existing.receipt_number || null) !== (updated.receipt_number || null)) return true

  if (existingPositions.length !== updated.positions.length) return true
  const byId = new Map(existingPositions.map(position => [Number(position.id), position]))
  for (const incoming of updated.positions) {
    const current = byId.get(Number(incoming?.id))
    if (!current) return true
    if (Number(current.sphere) !== Number(incoming.sphere)) return true
    if (Number(current.cost_centre) !== Number(incoming.cost_centre)) return true
    if (!sameMoney(current.amount, incoming.amount)) return true
    if (Number(current.tax ?? 19) !== Number(incoming.tax ?? 19)) return true
  }
  return false
}

export function receiptRequiresFile(status: ReceiptStatus | string) {
  return status === ReceiptStatus.Open || status === ReceiptStatus.Paid
}
