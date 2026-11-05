import path from 'node:path'

/**
 * Where stored files live on disk (SEC-08). `files.file_path` is `/uploads/<folder>/<uuid><ext>`;
 * every read, stream and delete must resolve it through here so a crafted path (from a restored
 * snapshot, say) can never point outside UPLOAD_DIR.
 */

/**
 * Shape written by `storeUploadedFile`: `/uploads/<folder>/<file name>` — exactly one folder level,
 * no further separators. (The file name is a uuid plus the client's extension; old rows may carry
 * odd extensions, so the name itself is not pinned down — `resolveStoredFilePath` does the safety.)
 */
export const STORED_FILE_PATH_PATTERN = /^\/uploads\/[A-Za-z0-9_-]+\/[^/\\]+$/

export function isWellFormedStoredFilePath(filePath: unknown): filePath is string {
  if (typeof filePath !== 'string' || !STORED_FILE_PATH_PATTERN.test(filePath)) return false
  const name = filePath.slice(filePath.lastIndexOf('/') + 1)
  return name !== '.' && name !== '..'
}

/**
 * Absolute path of a stored file, or null when UPLOAD_DIR is unset or the path would leave it.
 * Callers treat null as "file not found".
 */
export function resolveStoredFilePath(filePath: unknown, uploadRoot = process.env.UPLOAD_DIR): string | null {
  if (!uploadRoot || typeof filePath !== 'string' || !filePath) return null
  if (filePath.includes('\0')) return null

  const relative = filePath.replace(/^\/uploads\//, '')
  // Windows separators would be path separators on a Windows host; refuse them everywhere.
  if (relative.includes('\\')) return null
  if (path.isAbsolute(relative) || path.win32.isAbsolute(relative)) return null

  const root = path.resolve(uploadRoot)
  const prefix = root.endsWith(path.sep) ? root : root + path.sep
  const absolute = path.resolve(root, relative)
  return absolute.startsWith(prefix) ? absolute : null
}
