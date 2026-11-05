import { describe, expect, it } from 'vitest'
import { acquireExportSlot, EXPORT_BUSY_GLOBAL, EXPORT_BUSY_SELF } from '~/server/utils/documentExport/concurrency'

describe('document export slots (SEC-32)', () => {
  it('allows one export per user and two overall', () => {
    const first = acquireExportSlot(1)
    expect(first.ok).toBe(true)
    expect(acquireExportSlot(1)).toEqual({ ok: false, error: EXPORT_BUSY_SELF })

    const second = acquireExportSlot(2)
    expect(second.ok).toBe(true)
    expect(acquireExportSlot(3)).toEqual({ ok: false, error: EXPORT_BUSY_GLOBAL })

    if (first.ok) first.release()
    if (second.ok) second.release()
    const again = acquireExportSlot(1)
    expect(again.ok).toBe(true)
    if (again.ok) again.release()
  })
})
