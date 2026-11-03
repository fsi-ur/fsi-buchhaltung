import { computed } from 'vue'
import { useAuth } from '~/composables/useAuth'
import {
  DOCUMENT_EXPORT_PERMISSIONS,
  type DocumentExportRequest,
  type DocumentExportSourceKey,
} from '~/shared/documentExport'

const EXPECTED_CONTENT_TYPES = {
  pdf: 'application/pdf',
  zip: 'application/zip',
} as const

/**
 * Bulk document export of one source (see shared/documentExport.ts). `canExport` gates the table's
 * selection; `download` posts the request and saves the returned file.
 */
export function useDocumentExport(source: DocumentExportSourceKey) {
  const { hasPermission } = useAuth()

  const canExport = computed(() => DOCUMENT_EXPORT_PERMISSIONS[source].every(permission => hasPermission(permission)))

  async function download(request: DocumentExportRequest): Promise<{ ok: true } | { ok: false, error?: string }> {
    const response = await apiFetch.raw<Blob>(`/api/document-export/${source}`, {
      method: 'POST',
      body: request,
      responseType: 'blob',
    })
    const blob = response._data

    // Failures come back as `{ ok: false, error }` JSON instead of the file.
    if (!blob || !blob.type.includes(EXPECTED_CONTENT_TYPES[request.format])) {
      try {
        const parsed = JSON.parse(await blob!.text())
        return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : undefined }
      } catch {
        return { ok: false }
      }
    }

    const disposition = response.headers.get('content-disposition') ?? ''
    const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? `export.${request.format}`

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

  return { canExport, download }
}
