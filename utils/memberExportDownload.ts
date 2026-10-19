import type { MemberExportConfig } from '~/types/member'

export type MemberExportFormat = 'pdf' | 'excel'

const EXPECTED_CONTENT_TYPES: Record<MemberExportFormat, string> = {
  pdf: 'application/pdf',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

export async function downloadMemberListExport(
  format: MemberExportFormat,
  config: MemberExportConfig,
): Promise<{ ok: true } | { ok: false, error?: string }> {
  const response = await apiFetch.raw<Blob>(`/api/members/export/${format}`, {
    method: 'POST',
    body: config,
    responseType: 'blob',
  })
  const blob = response._data

  if (!blob || !blob.type.includes(EXPECTED_CONTENT_TYPES[format])) {
    try {
      const parsed = JSON.parse(await blob!.text())
      return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : undefined }
    } catch {
      return { ok: false }
    }
  }

  const disposition = response.headers.get('content-disposition') ?? ''
  const fallbackName = format === 'pdf' ? 'Mitgliederliste.pdf' : 'Mitgliederliste.xlsx'
  const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackName

  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)

  return { ok: true }
}
