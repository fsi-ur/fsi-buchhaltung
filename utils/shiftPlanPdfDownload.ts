async function downloadPdf(
  url: string,
  query: Record<string, string>,
  fallbackFileName: string,
): Promise<{ ok: true } | { ok: false, error?: string }> {
  const response = await apiFetch.raw<Blob>(url, {
    responseType: 'blob',
    query,
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
  const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallbackFileName

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

export async function downloadShiftPlanPdf(
  eventId: number,
  options: { includeDescriptions: boolean, highlightOwn?: boolean },
): Promise<{ ok: true } | { ok: false, error?: string }> {
  return downloadPdf(`/api/events/${eventId}/shifts/pdf`, {
    descriptions: options.includeDescriptions ? '1' : '0',
    own: options.highlightOwn ? '1' : '0',
  }, `Schichtplan_${eventId}.pdf`)
}

/** The personal shift plan an inbox entry came with (see server/api/notifications/inbox/[id]/shift-plan.get.ts). */
export async function downloadNotificationShiftPlan(deliveryId: number): Promise<{ ok: true } | { ok: false, error?: string }> {
  return downloadPdf(`/api/notifications/inbox/${deliveryId}/shift-plan`, {}, 'Schichtplan.pdf')
}
