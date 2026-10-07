import fs from 'fs/promises'
import path from 'path'
import { query } from '~/server/utils/db'
import { getAttachedFile } from '~/server/utils/files'
import type { InvoiceTextSettings } from '~/types/appSettings'
import { InvoiceSourceType, InvoiceStatus, type CreateInvoiceBody } from '~/types/invoice'
import type { AssociationProfileRow } from '~/types/association'
import type { CompanyRow } from '~/types/company'
import type { FileRow } from '~/types/file'
import { renderInvoiceTextTemplate } from '~/utils/invoiceTextTemplates'

export function validateInvoicePayload(invoice: any) {
  if (!invoice || typeof invoice !== 'object') return 'Missing invoice data'
  if (!invoice.company_id) return 'A company is required'
  if (!invoice.invoice_date) return 'An invoice date is required'
  if (!invoice.due_date) return 'A due date is required'
  if (!invoice.invoice_number || String(invoice.invoice_number).trim().length < 1) return 'An invoice number is required'
  if (!Object.values(InvoiceSourceType).includes(invoice.source_type)) return 'Invalid invoice source'
  if (!Object.values(InvoiceStatus).includes(invoice.status)) return 'Invalid invoice status'
  if (invoice.status === InvoiceStatus.Paid && !invoice.paid_at) return 'Paid invoices require a payment date'
  if (invoice.status !== InvoiceStatus.Paid && invoice.paid_at) return 'Only paid invoices can have a payment date'
  if (!Array.isArray(invoice.positions) || invoice.positions.length === 0) return 'At least one invoice position is required'

  for (const position of invoice.positions) {
    if (!position?.name || String(position.name).trim().length < 1) {
      return 'Each position requires a name'
    }

    if (!Number.isInteger(Number(position.sphere)) || Number(position.sphere) <= 0) {
      return 'Each position requires a sphere'
    }

    if (!Number.isInteger(Number(position.cost_centre)) || Number(position.cost_centre) <= 0) {
      return 'Each position requires a cost centre'
    }

    if (!Number.isFinite(Number(position.quantity)) || Number(position.quantity) <= 0) {
      return 'Each position requires a quantity greater than zero'
    }

    if (!Number.isFinite(Number(position.unit_price)) || Number(position.unit_price) < 0) {
      return 'Each position requires a unit price'
    }

    if (!Number.isFinite(Number(position.tax)) || Number(position.tax) < 0) {
      return 'Each position requires a valid tax rate'
    }
  }

  return null
}

export function invoiceNeedsUploadedFile(sourceType: InvoiceSourceType | string) {
  return sourceType === InvoiceSourceType.Upload
}

export function normalizeInvoicePayload(invoice: CreateInvoiceBody): CreateInvoiceBody {
  return {
    company_id: invoice.company_id ? Number(invoice.company_id) : null,
    source_type: invoice.source_type,
    is_kleinunternehmer: Boolean(invoice.is_kleinunternehmer),
    invoice_date: String(invoice.invoice_date || ''),
    due_date: String(invoice.due_date || ''),
    paid_at: invoice.paid_at ? String(invoice.paid_at) : null,
    contact_person: invoice.contact_person?.trim() || null,
    recipient_attention: invoice.recipient_attention?.trim() || null,
    service_date: invoice.service_date ? String(invoice.service_date) : null,
    invoice_number: String(invoice.invoice_number || '').trim(),
    subject: invoice.subject?.trim() || null,
    intro_text: invoice.intro_text?.trim() || null,
    notes: invoice.notes?.trim() || null,
    status: invoice.status,
    positions: invoice.positions.map(position => ({
      id: position.id ? Number(position.id) : undefined,
      name: String(position.name || '').trim(),
      description: String(position.description || '').trim() || null,
      sphere: Number(position.sphere),
      cost_centre: Number(position.cost_centre),
      quantity: Number(position.quantity),
      unit: position.unit?.trim() || null,
      unit_price: Number(position.unit_price),
      tax: Number(position.tax),
    })),
  }
}

export function materializeFinalInvoiceTexts(
  invoice: CreateInvoiceBody,
  settings: InvoiceTextSettings,
  association: AssociationProfileRow | null,
): CreateInvoiceBody {
  if (invoice.status === InvoiceStatus.Draft) return invoice

  const context = {
    invoice_number: invoice.invoice_number,
    association_name: association?.name ?? null,
    contact_person: invoice.contact_person,
    recipient_attention: invoice.recipient_attention,
    invoice_date: invoice.invoice_date,
    service_date: invoice.service_date,
    due_date: invoice.due_date,
  }

  return {
    ...invoice,
    subject: renderInvoiceTextTemplate(invoice.subject || settings.subject, context).trim() || null,
    intro_text: renderInvoiceTextTemplate(invoice.intro_text || settings.intro_text, context).trim() || null,
    notes: renderInvoiceTextTemplate(invoice.notes || settings.notes, context).trim() || null,
  }
}

export function calculateInvoicePositionTotals(positions: Array<{ quantity: number, unit_price: number, tax: number }>) {
  let netTotal = 0
  let grossTotal = 0
  const taxBreakdown = new Map<number, number>()

  for (const position of positions) {
    const net = Number(position.quantity) * Number(position.unit_price)
    const taxAmount = net * (Number(position.tax) / 100)
    netTotal += net
    grossTotal += net + taxAmount
    taxBreakdown.set(Number(position.tax), (taxBreakdown.get(Number(position.tax)) || 0) + taxAmount)
  }

  return {
    netTotal,
    grossTotal,
    taxBreakdown,
  }
}

export async function getAssociationProfileForInvoice(conn?: any): Promise<AssociationProfileRow | null> {
  const rows = await query<Array<Omit<AssociationProfileRow, 'responsible_member_ids' | 'responsible_position_ids'>>>(
    `SELECT
      id, name, short_name, street, street_number, postal_code, city, email, phone, website,
      vat_id, iban, bic, bankname, register_number, register_court
     FROM association_profiles
     ORDER BY id ASC
     LIMIT 1`,
    [],
    conn,
  )

  if (!rows.length) return null

  return {
    ...rows[0]!,
    responsible_member_ids: [],
    responsible_position_ids: [],
  }
}

export async function getAssociationResponsibleMemberNames(conn?: any): Promise<string[]> {
  const [memberRows, positionRows] = await Promise.all([
    query<Array<{ full_name: string }>>(
      `SELECT DISTINCT TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS full_name
       FROM association_responsible_members arm
       INNER JOIN members m ON m.id = arm.member_id
       ORDER BY m.last_name ASC, m.first_name ASC`,
      [],
      conn,
    ),
    query<Array<{ full_name: string | null }>>(
      `SELECT DISTINCT TRIM(CONCAT(m.first_name, ' ', m.last_name)) AS full_name
       FROM association_responsible_positions arp
       INNER JOIN member_positions mp
         ON mp.position_id = arp.position_id
         AND mp.since <= CURRENT_DATE()
         AND (mp.until IS NULL OR mp.until >= CURRENT_DATE())
       INNER JOIN members m ON m.id = mp.member_id
       ORDER BY m.last_name ASC, m.first_name ASC`,
      [],
      conn,
    ),
  ])

  const names = [...memberRows, ...positionRows]
    .map(row => String(row.full_name || '').trim())
    .filter(Boolean)

  return Array.from(new Set(names))
}

export async function getAssociationBoardLineForInvoice(conn?: any): Promise<string | null> {
  const uniqueNames = await getAssociationResponsibleMemberNames(conn)
  return uniqueNames.length ? `Vorstand gem. §26 BGB: ${uniqueNames.join(', ')}` : null
}

export async function getInvoiceCompany(companyId: number, conn?: any): Promise<CompanyRow | null> {
  const rows = await query<CompanyRow[]>(
    `SELECT id, name, street, street_number, postal_code, city, country, iban, bic, bankname, vat_id, email, phone, notes
     FROM companies
     WHERE id = ?
     LIMIT 1`,
    [companyId],
    conn,
  )

  return rows[0] ?? null
}

export async function invoiceNumberExists(invoiceNumber: string, excludeInvoiceId?: number | null, conn?: any) {
  const rows = await query<Array<{ id: number }>>(
    `SELECT id
     FROM invoices
     WHERE invoice_number = ?
       AND (? IS NULL OR id <> ?)
     LIMIT 1`,
    [invoiceNumber, excludeInvoiceId ?? null, excludeInvoiceId ?? null],
    conn,
  )

  return rows.length > 0
}

export async function getAssociationLogoForInvoice(conn?: any): Promise<null | {
  file: FileRow
  data: Buffer
}> {
  const profileRows = await query<Array<{ id: number }>>(
    `SELECT id
     FROM association_profiles
     ORDER BY id ASC
     LIMIT 1`,
    [],
    conn,
  )

  const profileId = Number(profileRows[0]?.id || 0)
  if (!profileId) return null

  const file = await getAttachedFile('association_profile_logo', profileId, conn)
  if (!file) return null

  const uploadRoot = process.env.UPLOAD_DIR!
  const relativePath = file.file_path.replace(/^\/uploads\//, '')
  const absolutePath = path.join(uploadRoot, relativePath)
  const data = await fs.readFile(absolutePath)

  return { file, data }
}
