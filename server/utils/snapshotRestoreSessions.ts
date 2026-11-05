import crypto from 'crypto'
import { SnapshotError, type DatabaseSnapshot, type SnapshotPreview } from '~/server/utils/databaseSnapshots'

const RESTORE_SESSION_MAX_AGE_MS = 15 * 60 * 1000

interface SnapshotRestoreSession {
  userId: number
  snapshot: DatabaseSnapshot
  preview: SnapshotPreview
  createdAt: number
}

// A decrypted snapshot is the whole database in memory — one pending restore per user (SEC-09/32).
const restoreSessions = new Map<string, SnapshotRestoreSession>()

function pruneRestoreSessions() {
  const expiresBefore = Date.now() - RESTORE_SESSION_MAX_AGE_MS
  for (const [token, session] of restoreSessions.entries()) {
    if (session.createdAt < expiresBefore) restoreSessions.delete(token)
  }
}

export function createSnapshotRestoreSession(userId: number, snapshot: DatabaseSnapshot, preview: SnapshotPreview) {
  pruneRestoreSessions()
  for (const [token, session] of restoreSessions.entries()) {
    if (session.userId === userId) restoreSessions.delete(token)
  }
  const token = crypto.randomBytes(32).toString('base64url')
  restoreSessions.set(token, { userId, snapshot, preview, createdAt: Date.now() })
  return token
}

/** The pending restore of this token — only for the user who created the preview. */
export function getSnapshotRestoreSession(userId: number, tokenValue: unknown) {
  pruneRestoreSessions()
  const token = String(tokenValue || '')
  const session = restoreSessions.get(token)
  if (!session || session.userId !== userId) throw new SnapshotError('previewExpired', 'Restore preview has expired')
  return session
}

export function consumeSnapshotRestoreSession(userId: number, tokenValue: unknown) {
  const token = String(tokenValue || '')
  const session = getSnapshotRestoreSession(userId, token)
  restoreSessions.delete(token)
  return session
}
