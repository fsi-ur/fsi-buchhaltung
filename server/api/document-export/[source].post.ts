import { defineEventHandler, readBody, setHeader } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getAssociationLogoForInvoice, getAssociationProfileForInvoice } from '~/server/utils/invoices'
import { buildDocumentExportZip, documentExportFileName, parseDocumentExportRequest, resolveDocumentExportScope } from '~/server/utils/documentExport/engine'
import { buildMergedDocumentExportPdf } from '~/server/utils/documentExport/pdf'
import { DOCUMENT_EXPORT_SOURCES } from '~/server/utils/documentExport/registry'
import type { DocumentExportContext } from '~/server/utils/documentExport/types'
import { appNowLocalDateTime, appTodayLocalDate } from '~/server/utils/time'
import { DOCUMENT_EXPORT_COST_CENTRE_SCOPE, DOCUMENT_EXPORT_PERMISSIONS, isDocumentExportSourceKey } from '~/shared/documentExport'

/**
 * Bundles the documents of several records of one source (see the registry) into one download:
 * a merged PDF (optional linked overview, then each document or a placeholder page) or a ZIP of the
 * original files (optional Excel index). Requires all of the source's `DOCUMENT_EXPORT_PERMISSIONS`.
 * An optional cost-centre scope (finance analysis) shows split records' share for that cost centre.
 */
export default defineEventHandler(async (event) => {
  const key = event.context.params?.source
  if (!isDocumentExportSourceKey(key)) return { ok: false as const, error: 'Unbekannte Exportquelle.' }
  const source = DOCUMENT_EXPORT_SOURCES[key]

  const current = await requirePermission(event, DOCUMENT_EXPORT_PERMISSIONS[key], { requireAll: true })
  if (!current.ok) return current

  const parsed = parseDocumentExportRequest(await readBody(event))
  if (!parsed.ok) return parsed
  const { request } = parsed

  if (request.costCentre && !DOCUMENT_EXPORT_COST_CENTRE_SCOPE[key]) {
    return { ok: false as const, error: 'Dieser Export kann nicht nach Kostenstelle erfolgen.' }
  }

  try {
    const resolved = await resolveDocumentExportScope(request.costCentre)
    if (!resolved.ok) return resolved

    const loaded = await source.load(request.ids, resolved.scope)
    if (!loaded.ok) return loaded

    let logo: DocumentExportContext['logo'] = null
    try {
      const attachedLogo = await getAssociationLogoForInvoice()
      if (attachedLogo) logo = { mimeType: attachedLogo.file.mime_type, data: attachedLogo.data }
    } catch {
      logo = null
    }

    const context: DocumentExportContext = {
      createdOn: await appTodayLocalDate(),
      association: await getAssociationProfileForInvoice(),
      logo,
      scope: resolved.scope,
    }

    if (request.format === 'pdf') {
      const pdf = await buildMergedDocumentExportPdf({ source, items: loaded.items, includeCover: request.includeCover, context })
      setHeader(event, 'Content-Type', 'application/pdf')
      setHeader(event, 'Content-Disposition', `attachment; filename="${documentExportFileName(source, 'pdf', context.createdOn)}"`)
      return pdf
    }

    const zip = buildDocumentExportZip({
      source,
      items: loaded.items,
      includeIndex: request.includeIndex,
      modifiedAt: await appNowLocalDateTime(),
      context,
    })
    if (!zip.ok) return zip

    setHeader(event, 'Content-Type', 'application/zip')
    setHeader(event, 'Content-Disposition', `attachment; filename="${documentExportFileName(source, 'zip', context.createdOn)}"`)
    return zip.data
  } catch (err: any) {
    console.error(`document export (${key}) failed`, err)
    return { ok: false as const, error: 'Der Export konnte nicht erstellt werden.' }
  }
})
