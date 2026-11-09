import { defineEventHandler, getQuery } from 'h3'
import { query } from '~/server/utils/db'
import { hasPermission, requirePermission } from '~/server/utils/api/guards'
import type { BankStatementReceiptOption, BankStatementInvoiceOption, BankStatementEventOption } from '~/types/bankStatement'
import { internalError } from '~/server/utils/api/errors'

interface OptionsSuccess {
  ok: true
  receipts: BankStatementReceiptOption[]
  invoices: BankStatementInvoiceOption[]
  events: BankStatementEventOption[]
}

interface OptionsError {
  ok: false
  error: string
}

type OptionsResponse = OptionsSuccess | OptionsError

export default defineEventHandler(async (event): Promise<OptionsResponse> => {
  const current = await requirePermission(event, 'bank_statements.view')
  if (!current.ok) return current

  const { currentStatementId: rawId } = getQuery(event)
  const parsedId = Number(rawId)
  const currentStatementId = rawId && Number.isInteger(parsedId) && parsedId > 0 ? parsedId : null

  // Editors get every linkable record; viewers only what the opened statement already links,
  // which is all the read-only form needs for its labels (SEC-29).
  const canEdit = hasPermission(current.user, 'bank_statements.edit')
  const viewerReceiptScope = canEdit ? '' : 'AND r.id IN (SELECT receipt_id FROM bank_statement_positions WHERE bank_statement_id = ?)'
  const viewerInvoiceScope = canEdit ? '' : 'AND i.id IN (SELECT invoice_id FROM bank_statement_positions WHERE bank_statement_id = ?)'
  const viewerParams = canEdit ? [] : [currentStatementId ?? 0]

  try {
    // Receipts: exclude those already in a reimbursement or another bank statement
    const receipts = await query(`
      SELECT r.id, r.receipt_date, r.receipt_number, c.name AS company_name,
        IFNULL(SUM(rp.amount), 0) AS total_amount
      FROM receipts r
      LEFT JOIN companies c ON c.id = r.company_id
      LEFT JOIN receipt_positions rp ON rp.receipt_id = r.id
      WHERE r.status IN ('open', 'paid')
        AND EXISTS (
          SELECT 1 FROM file_attachments fa
          WHERE fa.entity_type = 'receipt' AND fa.entity_id = r.id AND fa.detached_at IS NULL
        )
        AND r.id NOT IN (SELECT receipt_id FROM reimbursement_positions)
        AND r.id NOT IN (
          SELECT receipt_id FROM bank_statement_positions
          WHERE receipt_id IS NOT NULL
          ${currentStatementId ? 'AND bank_statement_id <> ?' : ''}
        )
        ${viewerReceiptScope}
      GROUP BY r.id
      ORDER BY r.receipt_date DESC, r.id DESC
    `, [...(currentStatementId ? [currentStatementId] : []), ...viewerParams])

    // Invoices: exclude cancelled and those already in another bank statement
    const invoices = await query(`
      SELECT i.id, i.invoice_date, i.invoice_number, c.name AS company_name,
        i.subject,
        IFNULL(SUM(ip.quantity * ip.unit_price * (1 + ip.tax / 100)), 0) AS total_amount
      FROM invoices i
      LEFT JOIN companies c ON c.id = i.company_id
      LEFT JOIN invoice_positions ip ON ip.invoice_id = i.id
      WHERE i.status IN ('open', 'paid')
        AND i.id NOT IN (
          SELECT invoice_id FROM bank_statement_positions
          WHERE invoice_id IS NOT NULL
          ${currentStatementId ? 'AND bank_statement_id <> ?' : ''}
        )
        ${viewerInvoiceScope}
      GROUP BY i.id
      ORDER BY i.invoice_date DESC, i.id DESC
    `, [...(currentStatementId ? [currentStatementId] : []), ...viewerParams])

    const events = await query(`
      SELECT e.id, e.name, e.starts_at
      FROM events e
      GROUP BY e.id
      ORDER BY e.starts_at DESC, e.id DESC
    `)

    return {
      ok: true,
      receipts: receipts.map((r: any) => ({
        id: Number(r.id),
        receipt_date: String(r.receipt_date),
        receipt_number: r.receipt_number ? String(r.receipt_number) : null,
        company_name: r.company_name ? String(r.company_name) : null,
        total_amount: Number(r.total_amount),
      })),
      invoices: invoices.map((i: any) => ({
        id: Number(i.id),
        invoice_date: String(i.invoice_date),
        invoice_number: String(i.invoice_number),
        company_name: i.company_name ? String(i.company_name) : null,
        subject: i.subject ? String(i.subject) : null,
        total_amount: Number(i.total_amount),
      })),
      events: events.map((e: any) => ({
        id: Number(e.id),
        name: String(e.name),
        starts_at: String(e.starts_at),
      })),
    }
  } catch (err: any) {
    return internalError('Failed to load options', err)
  }
})
