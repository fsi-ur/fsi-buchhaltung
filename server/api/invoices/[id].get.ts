import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { getNumericRouteParam } from '~/server/utils/api/request'
import { requirePermission } from '~/server/utils/api/guards'
import { getAttachedFile } from '~/server/utils/files'
import type { FileRow } from '~/types/file'
import type { Invoice, InvoicePosition } from '~/types/invoice'

interface GetInvoiceSuccess {
  ok: true
  invoice: Invoice
  file: FileRow | null
  statusLocked: boolean
}

interface GetInvoiceError {
  ok: false
  error: string
}

export type GetInvoiceResponse = GetInvoiceSuccess | GetInvoiceError

export default defineEventHandler(async (event): Promise<GetInvoiceResponse> => {
  const current = await requirePermission(event, 'invoices.view')
  if (!current.ok) return current

  const invoiceId = getNumericRouteParam(event)
  if (!invoiceId) return { ok: false, error: 'Invalid invoice id' }

  try {
    const invoiceRows = await query<any[]>(
      `SELECT
        i.id,
        i.company_id,
        c.name AS company_name,
        i.source_type,
        i.is_kleinunternehmer,
        i.invoice_date,
        i.due_date,
        i.paid_at,
        i.contact_person,
        i.recipient_attention,
        i.service_date,
        i.invoice_number,
        i.subject,
        i.intro_text,
        i.notes,
        i.status
       FROM invoices i
       LEFT JOIN companies c ON c.id = i.company_id
       WHERE i.id = ?
       LIMIT 1`,
      [invoiceId],
    )

    if (!invoiceRows.length) return { ok: false, error: 'Invoice not found' }

    const positions = await query<InvoicePosition[]>(
      `SELECT id, name, description, sphere, cost_centre, quantity, unit, unit_price, tax
       FROM invoice_positions
       WHERE invoice_id = ?
       ORDER BY id ASC`,
      [invoiceId],
    )

    const bankStatementLinks = await query<{ bank_statement_id: number }[]>(
      `SELECT bank_statement_id FROM bank_statement_positions WHERE invoice_id = ? LIMIT 1`,
      [invoiceId],
    )

    const file = await getAttachedFile('invoice', invoiceId)

    return {
      ok: true,
      statusLocked: bankStatementLinks.length > 0,
      invoice: {
        id: Number(invoiceRows[0].id),
        company_id: Number(invoiceRows[0].company_id),
        company_name: invoiceRows[0].company_name ? String(invoiceRows[0].company_name) : null,
        source_type: invoiceRows[0].source_type,
        is_kleinunternehmer: Boolean(invoiceRows[0].is_kleinunternehmer),
        invoice_date: String(invoiceRows[0].invoice_date),
        due_date: String(invoiceRows[0].due_date),
        paid_at: invoiceRows[0].paid_at ? String(invoiceRows[0].paid_at) : null,
        contact_person: invoiceRows[0].contact_person ? String(invoiceRows[0].contact_person) : null,
        recipient_attention: invoiceRows[0].recipient_attention ? String(invoiceRows[0].recipient_attention) : null,
        service_date: invoiceRows[0].service_date ? String(invoiceRows[0].service_date) : null,
        invoice_number: String(invoiceRows[0].invoice_number),
        subject: invoiceRows[0].subject ? String(invoiceRows[0].subject) : null,
        intro_text: invoiceRows[0].intro_text ? String(invoiceRows[0].intro_text) : null,
        notes: invoiceRows[0].notes ? String(invoiceRows[0].notes) : null,
        status: invoiceRows[0].status,
        positions: positions.map(position => ({
          id: Number(position.id),
          name: String(position.name),
          description: position.description ? String(position.description) : null,
          sphere: Number(position.sphere),
          cost_centre: Number(position.cost_centre),
          quantity: Number(position.quantity),
          unit: position.unit ? String(position.unit) : null,
          unit_price: Number(position.unit_price),
          tax: Number(position.tax),
        })),
      },
      file: file
        ? {
            id: Number(file.id),
            file_path: String(file.file_path),
            original_name: String(file.original_name),
            mime_type: String(file.mime_type),
            file_size: Number(file.file_size),
          }
        : null,
    }
  } catch (err: any) {
    return { ok: false, error: `Failed to load invoice: ${err}` }
  }
})
