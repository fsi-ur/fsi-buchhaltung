import { defineEventHandler } from 'h3'
import { query, withAuditTransaction } from '~/server/utils/db'
import { getNumericRouteParam, readMultipart } from '~/server/utils/api/request'
import { requirePermission } from '~/server/utils/api/guards'
import { getInvoiceTextSettings } from '~/server/utils/appSettings'
import { validateCostCentreSelection } from '~/server/utils/costCentres'
import { buildInvoicePdf } from '~/server/utils/invoicePdf'
import { detachFileAttachment, getActiveFileAttachment, storeAndAttachUploadedFile, validateUploadedFile } from '~/server/utils/files'
import { getAssociationBoardLineForInvoice, getAssociationLogoForInvoice, getAssociationProfileForInvoice, getInvoiceCompany, invoiceNeedsUploadedFile, invoiceNumberExists, materializeFinalInvoiceTexts, normalizeInvoicePayload, validateInvoicePayload } from '~/server/utils/invoices'
import { validateSphereSelection } from '~/server/utils/spheres'
import { InvoiceSourceType, InvoiceStatus, type InvoicePosition } from '~/types/invoice'

interface UpdateInvoiceSuccess {
  ok: true
}

interface UpdateInvoiceError {
  ok: false
  error: string
}

type UpdateInvoiceResponse = UpdateInvoiceSuccess | UpdateInvoiceError

interface MysqlError extends Error {
  code?: string
}

function normalizeInvoiceLogRow(invoice: any) {
  return {
    company_id: invoice.company_id ? Number(invoice.company_id) : null,
    source_type: invoice.source_type as InvoiceSourceType,
    is_kleinunternehmer: Boolean(invoice.is_kleinunternehmer),
    invoice_date: String(invoice.invoice_date || ''),
    due_date: String(invoice.due_date || ''),
    paid_at: invoice.paid_at ? String(invoice.paid_at) : null,
    contact_person: invoice.contact_person ? String(invoice.contact_person).trim() : null,
    recipient_attention: invoice.recipient_attention ? String(invoice.recipient_attention).trim() : null,
    service_date: invoice.service_date ? String(invoice.service_date) : null,
    invoice_number: String(invoice.invoice_number || '').trim(),
    subject: invoice.subject ? String(invoice.subject).trim() : null,
    intro_text: invoice.intro_text ? String(invoice.intro_text).trim() : null,
    notes: invoice.notes ? String(invoice.notes).trim() : null,
    status: invoice.status as InvoiceStatus,
  }
}

function normalizeComparablePosition(position: any) {
  return {
    id: position.id ? Number(position.id) : undefined,
    name: String(position.name || '').trim(),
    description: String(position.description || '').trim() || null,
    sphere: Number(position.sphere),
    cost_centre: Number(position.cost_centre),
    quantity: Number(position.quantity),
    unit: position.unit ? String(position.unit).trim() : null,
    unit_price: Number(position.unit_price),
    tax: Number(position.tax),
  }
}

function normalizeDisplayedInvoicePosition(position: any) {
  return {
    name: String(position.name || '').trim(),
    description: String(position.description || '').trim() || null,
    quantity: Number(position.quantity),
    unit: position.unit ? String(position.unit).trim() : null,
    unit_price: Number(position.unit_price),
    tax: Number(position.tax),
  }
}

function buildGeneratedInvoiceComparable(invoice: Record<string, any>, positions: any[]) {
  return {
    company_id: invoice.company_id ? Number(invoice.company_id) : null,
    source_type: invoice.source_type,
    is_kleinunternehmer: Boolean(invoice.is_kleinunternehmer),
    invoice_date: String(invoice.invoice_date || ''),
    due_date: String(invoice.due_date || ''),
    paid_at: invoice.paid_at ? String(invoice.paid_at) : null,
    contact_person: invoice.contact_person ? String(invoice.contact_person).trim() : null,
    recipient_attention: invoice.recipient_attention ? String(invoice.recipient_attention).trim() : null,
    service_date: invoice.service_date ? String(invoice.service_date) : null,
    invoice_number: String(invoice.invoice_number || '').trim(),
    subject: invoice.subject ? String(invoice.subject).trim() : null,
    intro_text: invoice.intro_text ? String(invoice.intro_text).trim() : null,
    notes: invoice.notes ? String(invoice.notes).trim() : null,
    status: invoice.status,
    positions: positions.map(normalizeDisplayedInvoicePosition),
  }
}

export default defineEventHandler(async (event): Promise<UpdateInvoiceResponse> => {
  const current = await requirePermission(event, 'invoices.edit')
  if (!current.ok) return current

  const invoiceId = getNumericRouteParam(event)
  if (!invoiceId) return { ok: false, error: 'Invalid invoice id' }

  const multipart = await readMultipart(event)
  if (!multipart) return { ok: false, error: 'Missing form data' }

  const invoiceJson = multipart.getField('invoice')
  const removeExistingFile = multipart.getField('removeExistingFile') === 'true'
  if (!invoiceJson) return { ok: false, error: 'Missing invoice data' }

  let parsed = normalizeInvoicePayload(JSON.parse(invoiceJson))
  const validationError = validateInvoicePayload(parsed)
  if (validationError) return { ok: false, error: validationError }

  const fileError = validateUploadedFile(multipart.file)
  if (fileError && multipart.file) return { ok: false, error: fileError }

  try {
    return await withAuditTransaction(current.user, async (conn) => {
      const existingRows = await query<any[]>(
        `SELECT
          id,
          company_id,
          source_type,
          is_kleinunternehmer,
          invoice_date,
          due_date,
          paid_at,
          contact_person,
          recipient_attention,
          service_date,
          invoice_number,
          subject,
          intro_text,
          notes,
          status
         FROM invoices
         WHERE id = ?
         LIMIT 1`,
        [invoiceId],
        conn,
      )
      if (!existingRows.length) return { ok: false, error: 'Invoice not found' }
      const existing = normalizeInvoiceLogRow(existingRows[0])

      const bankStatementLinks = await query<{ bank_statement_id: number }[]>(
        `SELECT bank_statement_id FROM bank_statement_positions WHERE invoice_id = ? LIMIT 1`,
        [invoiceId],
        conn,
      )
      if (bankStatementLinks.length > 0) {
        return { ok: false, error: 'This invoice is part of a bank statement and cannot be edited' }
      }

      const existingPositions = await query<InvoicePosition[]>(
        `SELECT id, name, description, sphere, cost_centre, quantity, unit, unit_price, tax
         FROM invoice_positions
         WHERE invoice_id = ?
         ORDER BY id ASC`,
        [invoiceId],
        conn,
      )

      const sphereValidationError = await validateSphereSelection(
        parsed.positions.map(position => ({
          itemId: position.id ? Number(position.id) : null,
          sphereId: Number(position.sphere),
        })),
        existingPositions.map(position => ({
          itemId: Number(position.id),
          sphereId: Number(position.sphere),
        })),
        conn,
      )
      if (sphereValidationError) return { ok: false, error: sphereValidationError }

      const costCentreValidationError = await validateCostCentreSelection(
        parsed.positions.map(position => ({
          itemId: position.id ? Number(position.id) : null,
          costCentreId: Number(position.cost_centre),
        })),
        existingPositions.map(position => ({
          itemId: Number(position.id),
          costCentreId: Number(position.cost_centre),
        })),
        conn,
      )
      if (costCentreValidationError) return { ok: false, error: costCentreValidationError }

      if (existing.status !== InvoiceStatus.Draft) {
        const existingComparable = {
          company_id: existing.company_id,
          source_type: existing.source_type,
          is_kleinunternehmer: existing.is_kleinunternehmer,
          invoice_date: existing.invoice_date,
          due_date: existing.due_date,
          contact_person: existing.contact_person,
          recipient_attention: existing.recipient_attention,
          service_date: existing.service_date,
          invoice_number: existing.invoice_number,
          subject: existing.subject,
          intro_text: existing.intro_text,
          notes: existing.notes,
          positions: existingPositions.map(normalizeComparablePosition),
        }
        const nextComparable = {
          company_id: Number(parsed.company_id),
          source_type: parsed.source_type,
          is_kleinunternehmer: Boolean(parsed.is_kleinunternehmer),
          invoice_date: String(parsed.invoice_date),
          due_date: String(parsed.due_date),
          contact_person: parsed.contact_person,
          recipient_attention: parsed.recipient_attention,
          service_date: parsed.service_date,
          invoice_number: parsed.invoice_number,
          subject: parsed.subject,
          intro_text: parsed.intro_text,
          notes: parsed.notes,
          positions: parsed.positions.map(normalizeComparablePosition),
        }

        if (parsed.status === InvoiceStatus.Draft) {
          return { ok: false, error: 'Finalized invoices cannot be changed back to draft' }
        }

        if (multipart.file || removeExistingFile || JSON.stringify(existingComparable) !== JSON.stringify(nextComparable)) {
          return { ok: false, error: 'Only the status of finalized invoices can be changed' }
        }

        if (existing.status !== parsed.status || existing.paid_at !== parsed.paid_at) {
          await query(
            `UPDATE invoices
             SET status = ?, paid_at = ?
             WHERE id = ?`,
            [parsed.status, parsed.paid_at, invoiceId],
            conn,
          )
        }

        return { ok: true }
      }

      if (await invoiceNumberExists(parsed.invoice_number, invoiceId, conn)) {
        return { ok: false, error: 'Invoice number already exists' }
      }

      const existingSourceType = existing.source_type as InvoiceSourceType
      const existingAttachment = await getActiveFileAttachment('invoice', invoiceId, conn)
      const mustUploadFile = invoiceNeedsUploadedFile(parsed.source_type)
      const hasExistingFile = Boolean(existingAttachment)
      const canReuseExistingUpload = hasExistingFile && !removeExistingFile && existingSourceType === InvoiceSourceType.Upload
      const hasFileAfterSave = Boolean(multipart.file) || canReuseExistingUpload || parsed.source_type === InvoiceSourceType.Generated
      if (mustUploadFile && !hasFileAfterSave) return { ok: false, error: 'A file is required for uploaded invoices' }

      const shouldLoadInvoiceTextContext = parsed.status !== InvoiceStatus.Draft || parsed.source_type === InvoiceSourceType.Generated
      const association = shouldLoadInvoiceTextContext ? await getAssociationProfileForInvoice(conn) : null
      if (parsed.source_type === InvoiceSourceType.Generated && !association) {
        return { ok: false, error: 'Association details are required to generate invoices' }
      }

      const invoiceTextSettings = await getInvoiceTextSettings(conn)
      if (invoiceTextSettings.invoice_number_manual_edit_disabled && existing.invoice_number !== parsed.invoice_number) {
        return { ok: false, error: 'Invoice number cannot be changed manually' }
      }
      if (parsed.status !== InvoiceStatus.Draft) {
        parsed = materializeFinalInvoiceTexts(parsed, invoiceTextSettings, association)
      }

      const generatedComparableChanged = JSON.stringify(
        buildGeneratedInvoiceComparable(existing, existingPositions),
      ) !== JSON.stringify(
        buildGeneratedInvoiceComparable(parsed, parsed.positions),
      )
      const shouldRegenerateGeneratedPdf = parsed.source_type === InvoiceSourceType.Generated && (
        !existingAttachment
        || (
          generatedComparableChanged
          && (existing.status === InvoiceStatus.Draft || parsed.status === InvoiceStatus.Draft)
        )
      )

      await query(
        `UPDATE invoices
         SET company_id = ?, source_type = ?, is_kleinunternehmer = ?, invoice_date = ?, due_date = ?, paid_at = ?, contact_person = ?, recipient_attention = ?, service_date = ?, invoice_number = ?, subject = ?, intro_text = ?, notes = ?, status = ?
         WHERE id = ?`,
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
          invoiceId,
        ],
        conn,
      )

      const incomingIds = new Set(parsed.positions.filter(position => position.id).map(position => Number(position.id)))

      for (const existingPosition of existingPositions) {
        if (!incomingIds.has(Number(existingPosition.id))) {
          await query(`DELETE FROM invoice_positions WHERE id = ?`, [existingPosition.id], conn)
        }
      }

      for (const position of parsed.positions) {
        if (position.id) {
          await query(
            `UPDATE invoice_positions
             SET name = ?, description = ?, sphere = ?, cost_centre = ?, quantity = ?, unit = ?, unit_price = ?, tax = ?
             WHERE id = ? AND invoice_id = ?`,
            [
              position.name,
              position.description,
              position.sphere,
              position.cost_centre,
              position.quantity,
              position.unit,
              position.unit_price,
              position.tax,
              position.id,
              invoiceId,
            ],
            conn,
          )
          continue
        }

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

      const shouldReplaceAttachment = Boolean(existingAttachment) && (
        removeExistingFile
        || Boolean(multipart.file)
        || shouldRegenerateGeneratedPdf
      )

      if (shouldReplaceAttachment && existingAttachment) {
        await detachFileAttachment(existingAttachment.id, current.user.id, conn)
      }

      if (parsed.source_type === InvoiceSourceType.Upload) {
        if (!multipart.file && !canReuseExistingUpload) {
          return { ok: false, error: 'A file is required for uploaded invoices' }
        }

        if (multipart.file) {
          await storeAndAttachUploadedFile(multipart.file, 'invoices', 'invoice', invoiceId, current.user.id, conn)
        }
      }

      if (shouldRegenerateGeneratedPdf) {
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

      return { ok: true }
    })
  } catch (err: any) {
    const error = err as MysqlError
    if (error.code === 'ER_DUP_ENTRY') return { ok: false, error: 'Invoice number already exists' }
    return { ok: false, error: `Failed to update invoice: ${err}` }
  }
})
