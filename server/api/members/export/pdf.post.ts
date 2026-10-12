import { defineEventHandler, readBody, setHeader } from 'h3'
import { requirePermission } from '~/server/utils/api/guards'
import { getAssociationLogoForInvoice, getAssociationProfileForInvoice } from '~/server/utils/invoices'
import { loadMembersForExport, memberExportFileName, parseMemberExportConfig } from '~/server/utils/memberExport'
import { buildMemberListPdf } from '~/server/utils/memberListPdf'
import { appTodayLocalDate } from '~/server/utils/time'

export default defineEventHandler(async (event) => {
  const current = await requirePermission(event, 'members.view')
  if (!current.ok) return current

  const parsed = parseMemberExportConfig(await readBody(event))
  if (!parsed.ok) return parsed

  const members = await loadMembersForExport(parsed.config.statuses)
  const association = await getAssociationProfileForInvoice()

  let logo: { mimeType: string, data: Buffer } | null = null
  try {
    const attachedLogo = await getAssociationLogoForInvoice()
    if (attachedLogo) {
      logo = { mimeType: attachedLogo.file.mime_type, data: attachedLogo.data }
    }
  } catch {
    logo = null
  }

  const createdOn = await appTodayLocalDate()
  const pdf = buildMemberListPdf({ config: parsed.config, members, association, logo, createdOn })

  setHeader(event, 'Content-Type', 'application/pdf')
  setHeader(event, 'Content-Disposition', `attachment; filename="${memberExportFileName('pdf', createdOn)}"`)
  return pdf
})
