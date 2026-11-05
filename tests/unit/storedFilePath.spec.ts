import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { isWellFormedStoredFilePath, resolveStoredFilePath } from '~/server/utils/storedFilePath'

const root = path.resolve('/srv/uploads')

describe('resolveStoredFilePath (SEC-08)', () => {
  it('resolves regular stored paths inside UPLOAD_DIR', () => {
    expect(resolveStoredFilePath('/uploads/receipts/0b9f.pdf', root)).toBe(path.join(root, 'receipts', '0b9f.pdf'))
  })

  it('refuses traversal, absolute and Windows-style paths', () => {
    for (const bad of [
      '/uploads/../../app/.env',
      '/uploads/receipts/../../../etc/passwd',
      '/etc/passwd',
      '/uploads//etc/passwd',
      'C:\\Windows\\win.ini',
      '/uploads/receipts\\..\\..\\x',
      '/uploads/receipts/x\u0000.pdf',
      '',
    ]) {
      expect(resolveStoredFilePath(bad, root), bad).toBeNull()
    }
  })

  it('refuses the root itself and needs an UPLOAD_DIR', () => {
    expect(resolveStoredFilePath('/uploads/', root)).toBeNull()
    expect(resolveStoredFilePath('/uploads/receipts/a.pdf', '')).toBeNull()
  })

  it('works with UPLOAD_DIR=/ (no double-separator prefix bug)', () => {
    const fsRoot = path.resolve('/')
    expect(resolveStoredFilePath('/uploads/receipts/a.pdf', fsRoot)).toBe(path.join(fsRoot, 'receipts', 'a.pdf'))
  })
})

describe('isWellFormedStoredFilePath', () => {
  it('accepts the storeUploadedFile shape only', () => {
    expect(isWellFormedStoredFilePath('/uploads/receipts/3f2a5c1e-0000-4000-8000-000000000000.pdf')).toBe(true)
    expect(isWellFormedStoredFilePath('/uploads/receipts/sub/x.pdf')).toBe(false)
    expect(isWellFormedStoredFilePath('/uploads/receipts/..')).toBe(false)
    expect(isWellFormedStoredFilePath('/uploads/../x')).toBe(false)
    expect(isWellFormedStoredFilePath('/var/x.pdf')).toBe(false)
  })
})

describe('snapshot restore refuses crafted file paths', () => {
  it('throws before touching the database', async () => {
    const { restoreDatabaseSnapshot } = await import('~/server/utils/databaseSnapshots')
    const snapshot = {
      format: 'fsi-buchhaltung.database-snapshot',
      version: 3,
      tables: [{ name: 'files', columns: ['id', 'file_path'], rows: [{ id: 1, file_path: '/uploads/../../app/.env' }] }],
    }
    await expect(restoreDatabaseSnapshot(snapshot)).rejects.toThrow(/Invalid snapshot file path/)
  })
})
