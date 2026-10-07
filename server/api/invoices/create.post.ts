import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { readMultipart } from '~/server/utils/api/request'
import { requirePermission } from '~/server/utils/api/guards'
import { getInvoiceTextSettings, reserveNextDefaultInvoiceNumber } from '~/server/utils/appSettings'
import { validateCostCentreSelection } from '~/server/utils/costCentres'
import { buildInvoicePdf } from '~/server/utils/invoicePdf'
import { getAssociationBoardLineForInvoice, getAssociationLogoForInvoice, getAssociationProfileForInvoice, getInvoiceCompany, invoiceNeedsUploadedFile, invoiceNumberExists, materializeFinalInvoiceTexts, normalizeInvoicePayload, validateInvoicePayload } from '~/server/utils/invoices'
import { storeAndAttachUploadedFile, validateUploadedFile } from '~/server/utils/files'
import { validateSphereSelection } from '~/server/utils/spheres'
import { InvoiceSourceType, InvoiceStatus } from '~/types/invoice'

interface CreateInvoiceSuccess {
  ok: true
  invoiceId: number
}

interface CreateInvoiceError {
  ok: false
  error: string
}

type CreateInvoiceResponse = CreateInvoiceSuccess | CreateInvoiceError

interface MysqlError extends Error {
  code?: string
}

export default defineEventHandler(async (event): Promise<CreateInvoiceResponse> => {
  const current = await requirePermission(event, 'invoices.edit')
  if (!current.ok) return current

  const multipart = await readMultipart(event)
  if (!multipart) return { ok: false, error: 'Invalid form data' }

  const invoiceJson = multipart.getField('invoice')
  if (!invoiceJson) return { ok: false, error: 'Missing invoice data' }

  let parsed = normalizeInvoicePayload(JSON.parse(invoiceJson))
  const preValidationError = validateInvoicePayload(parsed.invoice_number ? parsed : { ...parsed, invoice_number: 'DEFAULT' })
  if (preValidationError) return { ok: false, error: preValidationError }

  const fileError = validateUploadedFile(
    multipart.file,
    invoiceNeedsUploadedFile(parsed.source_type) ? 'A file is required for uploaded invoices' : undefined,
  )
  if (fileError && (multipart.file || invoiceNeedsUploadedFile(parsed.source_type))) {
    return { ok: false, error: fileError }
  }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const sphereValidationError = await validateSphereSelection(
        parsed.positions.map(position => ({
          sphereId: Number(position.sphere),
        })),
        [],
        conn,
      )
      if (sphereValidationError) return { ok: false, error: sphereValidationError }

      const costCentreValidationError = await validateCostCentreSelection(
        parsed.positions.map(position => ({
          costCentreId: Number(position.cost_centre),
        })),
        [],
        conn,
      )
      if (costCentreValidationError) return { ok: false, error: costCentreValidationError }

      const invoiceTextSettings = await getInvoiceTextSettings(conn)
      if (!parsed.invoice_number || invoiceTextSettings.invoice_number_manual_edit_disabled) {
        parsed = {
          ...parsed,
          invoice_number: await reserveNextDefaultInvoiceNumber(parsed.invoice_date, conn),
        }
      }

      const validationError = validateInvoicePayload(parsed)
      if (validationError) return { ok: false, error: validationError }

      if (await invoiceNumberExists(parsed.invoice_number, null, conn)) {
        return { ok: false, error: 'Invoice number already exists' }
      }

      const shouldLoadInvoiceTextContext = parsed.status !== InvoiceStatus.Draft || parsed.source_type === InvoiceSourceType.Generated
      const association = shouldLoadInvoiceTextContext ? await getAssociationProfileForInvoice(conn) : null
      if (parsed.source_type === InvoiceSourceType.Generated && !association) {
        return { ok: false, error: 'Association details are required to generate invoices' }
      }

      if (parsed.status !== InvoiceStatus.Draft) {
        parsed = materializeFinalInvoiceTexts(parsed, invoiceTextSettings, association)
      }

      const result: any = await query(
        `INSERT INTO invoices
          (company_id, source_type, is_kleinunternehmer, invoice_date, due_date, paid_at, contact_person, recipient_attention, service_date, invoice_number, subject, intro_text, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          parsed.company_id,
          parsed.source_type,
          parsed.is_kleinunternehmer,
          parsed.invoice_date,
          parsed.due_date,
          parsed.paid_at,
          parsed.contact_person,
          parsed.recipient_attention,
          parsed.service_date,
          parsed.invoice_number,
          parsed.subject,
          parsed.intro_text,
          parsed.notes,
          parsed.status,
        ],
        conn,
      )

      const invoiceId = Number(result.insertId)

      for (const position of parsed.positions) {
        await query(
          `INSERT INTO invoice_positions
            (invoice_id, name, description, sphere, cost_centre, quantity, unit, unit_price, tax)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceId,
            position.name,
            position.description,
            position.sphere,
            position.cost_centre,
            position.quantity,
            position.unit,
            position.unit_price,
            position.tax,
          ],
          conn,
        )
      }

      if (parsed.source_type === InvoiceSourceType.Upload && multipart.file) {
        await storeAndAttachUploadedFile(multipart.file, 'invoices', 'invoice', invoiceId, current.user.id, conn)
      }

      if (parsed.source_type === InvoiceSourceType.Generated) {
        if (!association) return { ok: false, error: 'Association details are required to generate invoices' }

        const company = await getInvoiceCompany(Number(parsed.company_id), conn)
        if (!company) return { ok: false, error: 'Company not found' }

        const logo = await getAssociationLogoForInvoice(conn)
        const boardLine = await getAssociationBoardLineForInvoice(conn)
        const pdfBuffer = buildInvoicePdf({ association, company, invoice: parsed, logo: logo ? {
          mimeType: logo.file.mime_type,
          data: logo.data,
        } : null, boardLine, invoiceTextSettings: invoiceTextSettings ?? undefined })
        await storeAndAttachUploadedFile({
          filename: `${parsed.invoice_number}.pdf`,
          type: 'application/pdf',
          data: pdfBuffer,
        }, 'invoices', 'invoice', invoiceId, current.user.id, conn)
      }

      return { ok: true, invoiceId }
    })
  } catch (err: any) {
    const error = err as MysqlError
    if (error.code === 'ER_DUP_ENTRY') return { ok: false, error: 'Invoice number already exists' }
    return { ok: false, error: `Failed to create invoice: ${err}` }
  }
})
