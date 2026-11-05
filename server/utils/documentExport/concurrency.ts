/**
 * Document exports hold all selected files plus the merged PDF/ZIP in memory (up to
 * MAX_DOCUMENT_EXPORT_BYTES each). One running export per user and a small global cap keep a few
 * clicks from exhausting the server's memory (SEC-32). Single-instance, in memory.
 */
const MAX_CONCURRENT_EXPORTS = 2
const running = new Set<number>()

export const EXPORT_BUSY_SELF = 'Es läuft bereits ein Export von dir. Bitte warte, bis er fertig ist.'
export const EXPORT_BUSY_GLOBAL = 'Gerade laufen zu viele Exporte. Bitte versuche es gleich noch einmal.'

/** Reserves an export slot; returns an error message or a release function. */
export function acquireExportSlot(userId: number): { ok: true, release: () => void } | { ok: false, error: string } {
  if (running.has(userId)) return { ok: false, error: EXPORT_BUSY_SELF }
  if (running.size >= MAX_CONCURRENT_EXPORTS) return { ok: false, error: EXPORT_BUSY_GLOBAL }
  running.add(userId)
  let released = false
  return {
    ok: true,
    release: () => {
      if (released) return
      released = true
      running.delete(userId)
    },
  }
}
