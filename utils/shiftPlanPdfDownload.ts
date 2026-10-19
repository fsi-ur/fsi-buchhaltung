export async function downloadShiftPlanPdf(
  eventId: number,
  options: { includeDescriptions: boolean, highlightOwn?: boolean },
): Promise<{ ok: true } | { ok: false, error?: string }> {
  const response = await apiFetch.raw<Blob>(`/api/events/${eventId}/shifts/pdf`, {
    responseType: 'blob',
    query: {
      descriptions: options.includeDescriptions ? '1' : '0',
      own: options.highlightOwn ? '1' : '0',
    },
  })
  const blob = response._data

  if (!blob || !blob.type.includes('application/pdf')) {
    try {
      const parsed = JSON.parse(await blob!.text())
      return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : undefined }
    } catch {
      return { ok: false }
    }
  }

  const disposition = response.headers.get('content-disposition') ?? ''
  const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? `Schichtplan_${eventId}.pdf`

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
