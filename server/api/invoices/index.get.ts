import { defineEventHandler } from 'h3'
import { query } from '~/server/utils/db'
import { requirePermission } from '~/server/utils/api/guards'
import { InvoiceSourceType, InvoiceStatus, type InvoiceRow } from '~/types/invoice'

interface GetInvoicesSuccess {
  ok: true
  invoices: InvoiceRow[]
}

interface GetInvoicesError {
  ok: false
  error: string
}

type GetInvoicesResponse = GetInvoicesSuccess | GetInvoicesError

export default defineEventHandler(async (event): Promise<GetInvoicesResponse> => {
  const current = await requirePermission(event, 'invoices.view')
  if (!current.ok) return current

  try {
    const invoices = await query<any[]>(
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
        i.notes,
        i.status,
        IFNULL(SUM(ip.quantity * ip.unit_price * (1 + (ip.tax / 100))), 0) AS total_amount
       FROM invoices i
       LEFT JOIN companies c ON c.id = i.company_id
       LEFT JOIN invoice_positions ip ON ip.invoice_id = i.id
       GROUP BY i.id
       ORDER BY i.invoice_date DESC, i.id DESC`
    )

    return {
      ok: true,
      invoices: invoices.map(invoice => ({
        id: Number(invoice.id),
        company_id: Number(invoice.company_id),
        company_name: invoice.company_name ? String(invoice.company_name) : null,
        source_type: invoice.source_type as InvoiceSourceType,
        is_kleinunternehmer: Boolean(invoice.is_kleinunternehmer),
        invoice_date: String(invoice.invoice_date),
        due_date: String(invoice.due_date),
        paid_at: invoice.paid_at ? String(invoice.paid_at) : null,
        contact_person: invoice.contact_person ? String(invoice.contact_person) : null,
        recipient_attention: invoice.recipient_attention ? String(invoice.recipient_attention) : null,
        service_date: invoice.service_date ? String(invoice.service_date) : null,
        invoice_number: String(invoice.invoice_number),
        subject: invoice.subject ? String(invoice.subject) : null,
        notes: invoice.notes ? String(invoice.notes) : null,
        status: invoice.status as InvoiceStatus,
        total_amount: Number(invoice.total_amount),
      })),
    }
  } catch (err: any) {
    return { ok: false, error: `Failed to load invoices: ${err}` }
  }
})
