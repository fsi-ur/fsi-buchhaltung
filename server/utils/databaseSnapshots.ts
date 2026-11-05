import { isWellFormedStoredFilePath, resolveStoredFilePath } from '~/server/utils/storedFilePath'
import type mariadb from 'mariadb'
import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { getDbConnection, query, withTransaction } from '~/server/utils/db'
import { normalizeBigInt } from '~/server/utils/normalize'

const SNAPSHOT_FORMAT = 'fsi-buchhaltung.database-snapshot'
const ENCRYPTED_SNAPSHOT_FORMAT = 'fsi-buchhaltung.encrypted-database-snapshot'
const SNAPSHOT_VERSION = 3
const SUPPORTED_SNAPSHOT_VERSIONS = new Set([1, 2, 3])
const CONTENT_EXCLUDED_TABLES = new Set(['sessions'])
/**
 * Tables that are not part of a snapshot at all — neither exported nor deleted/replaced on restore.
 * `system_events` is the restore log itself (SEC-09): it must survive the restore it records.
 */
export const SNAPSHOT_EXCLUDED_TABLES = new Set(['system_events'])
const SIGNATURE_ALGORITHM = 'hmac-sha256'
const ENCRYPTED_SNAPSHOT_MAGIC = Buffer.from('FSI-DB-SNAPSHOT-ENC\0', 'utf8')
const ENCRYPTED_SNAPSHOT_TAG_LENGTH = 16
const ENCRYPTED_SNAPSHOT_SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export type SnapshotErrorCode =
  | 'invalidPassword'
  | 'wrongPassword'
  | 'notEncrypted'
  | 'corruptedFile'
  | 'unsupportedFormat'
  | 'schemaMismatch'
  | 'integrityFailed'
  | 'archiveInvalid'
  | 'archiveFilesMissing'
  | 'previewExpired'
  | 'untrustedSnapshot'

export class SnapshotError extends Error {
  constructor(
    public readonly code: SnapshotErrorCode,
    message: string,
    public readonly params: Record<string, string | number> = {},
  ) {
    super(message)
    this.name = 'SnapshotError'
  }
}

interface TableColumn {
  table_name: string
  column_name: string
  ordinal_position: number
}

interface SnapshotTable {
  name: string
  columns: string[]
  rows: Record<string, unknown>[]
  checksum?: string
}

interface FileArchiveManifestItem {
  id: number
  file_path: string
  original_name: string
  archive_path: string
  included: boolean
}

interface FileArchiveManifest {
  format: string
  files: FileArchiveManifestItem[]
}

interface TarEntry {
  name: string
  content: Buffer
}

export interface DatabaseSnapshot {
  format: typeof SNAPSHOT_FORMAT
  version: number
  createdAt: string
  database: string | null
  app?: {
    name: string
    version: string | null
  }
  schema?: {
    version: string
    checksum?: string
  }
  integrity?: {
    algorithm: 'sha256'
    checksum: string
  }
  /** HMAC of `integrity.checksum` with this server's signing key (SEC-09). */
  signature?: {
    algorithm: typeof SIGNATURE_ALGORITHM
    value: string
  }
  excludedContent?: string[]
  tables: SnapshotTable[]
}

interface EncryptedSnapshotHeader {
  format: typeof ENCRYPTED_SNAPSHOT_FORMAT
  version: 1
  cipher: 'aes-256-gcm'
  kdf: 'scrypt'
  kdfOptions: typeof ENCRYPTED_SNAPSHOT_SCRYPT_OPTIONS
  salt: string
  iv: string
  tagLength: number
}

export interface SnapshotPreview {
  ok: true
  format: string
  version: number
  createdAt: string | null
  database: string | null
  appName: string | null
  appVersion: string | null
  schemaVersion: string | null
  schemaChecksum: string | null
  tables: number
  rows: number
  excludedContent: string[]
  integrity: {
    present: boolean
    valid: boolean
    algorithm: string | null
    checksum: string | null
  }
  /** `valid` = created and signed by this server (same signing key) and unmodified since. */
  signature: {
    present: boolean
    valid: boolean
  }
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z0-9_]+$/.test(identifier)) throw new Error(`Invalid database identifier: ${identifier}`)
  return `\`${identifier}\``
}

function stableStringify(value: unknown): string {
  if (typeof value === 'undefined') return 'null'
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const object = value as Record<string, unknown>
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(',')}}`
}

function sha256(value: unknown) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex')
}

function normalizeSnapshotPassword(password: unknown) {
  const value = String(password || '')
  if (value.length < 12) throw new SnapshotError('invalidPassword', 'Snapshot password must contain at least 12 characters')
  return value
}

function deriveSnapshotEncryptionKey(password: string, salt: Buffer) {
  return crypto.scryptSync(password, salt, 32, ENCRYPTED_SNAPSHOT_SCRYPT_OPTIONS)
}

export function isEncryptedSnapshotBuffer(value: Buffer) {
  return value.subarray(0, ENCRYPTED_SNAPSHOT_MAGIC.length).equals(ENCRYPTED_SNAPSHOT_MAGIC)
}

function buildEncryptedSnapshotHeader(password: string) {
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = deriveSnapshotEncryptionKey(password, salt)
  const header: EncryptedSnapshotHeader = {
    format: ENCRYPTED_SNAPSHOT_FORMAT,
    version: 1,
    cipher: 'aes-256-gcm',
    kdf: 'scrypt',
    kdfOptions: ENCRYPTED_SNAPSHOT_SCRYPT_OPTIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tagLength: ENCRYPTED_SNAPSHOT_TAG_LENGTH,
  }

  return { header, key, iv }
}

export function createEncryptedDatabaseSnapshotStream(passwordValue: unknown) {
  const password = normalizeSnapshotPassword(passwordValue)
  const { header, key, iv } = buildEncryptedSnapshotHeader(password)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, { authTagLength: ENCRYPTED_SNAPSHOT_TAG_LENGTH })
  const headerBuffer = Buffer.from(JSON.stringify(header), 'utf8')
  const headerLength = Buffer.alloc(4)
  headerLength.writeUInt32BE(headerBuffer.length, 0)

  return Readable.from((async function* () {
    yield ENCRYPTED_SNAPSHOT_MAGIC
    yield headerLength
    yield headerBuffer

    for await (const chunk of createDatabaseSnapshotStream()) {
      const encrypted = cipher.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'))
      if (encrypted.length) yield encrypted
    }

    const final = cipher.final()
    if (final.length) yield final
    yield cipher.getAuthTag()
  })())
}

export function decryptDatabaseSnapshotBuffer(encryptedSnapshot: Buffer, passwordValue: unknown) {
  if (!isEncryptedSnapshotBuffer(encryptedSnapshot)) throw new SnapshotError('notEncrypted', 'Snapshot is not encrypted')
  const password = normalizeSnapshotPassword(passwordValue)

  if (encryptedSnapshot.length < ENCRYPTED_SNAPSHOT_MAGIC.length + 4 + ENCRYPTED_SNAPSHOT_TAG_LENGTH) {
    throw new SnapshotError('corruptedFile', 'Encrypted snapshot is incomplete')
  }

  const headerLengthOffset = ENCRYPTED_SNAPSHOT_MAGIC.length
  const headerLength = encryptedSnapshot.readUInt32BE(headerLengthOffset)
  const headerStart = headerLengthOffset + 4
  const headerEnd = headerStart + headerLength
  const tagStart = encryptedSnapshot.length - ENCRYPTED_SNAPSHOT_TAG_LENGTH

  if (headerLength <= 0 || headerEnd >= tagStart) throw new SnapshotError('corruptedFile', 'Encrypted snapshot header is invalid')

  let header: EncryptedSnapshotHeader
  try {
    header = JSON.parse(encryptedSnapshot.subarray(headerStart, headerEnd).toString('utf8')) as EncryptedSnapshotHeader
  } catch {
    throw new SnapshotError('corruptedFile', 'Encrypted snapshot header is invalid')
  }
  if (
    header.format !== ENCRYPTED_SNAPSHOT_FORMAT ||
    header.version !== 1 ||
    header.cipher !== 'aes-256-gcm' ||
    header.kdf !== 'scrypt' ||
    header.tagLength !== ENCRYPTED_SNAPSHOT_TAG_LENGTH
  ) {
    throw new SnapshotError('unsupportedFormat', 'Unsupported encrypted snapshot format')
  }

  const salt = Buffer.from(header.salt, 'base64')
  const iv = Buffer.from(header.iv, 'base64')
  const key = deriveSnapshotEncryptionKey(password, salt)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: ENCRYPTED_SNAPSHOT_TAG_LENGTH })
  decipher.setAuthTag(encryptedSnapshot.subarray(tagStart))

  try {
    return Buffer.concat([
      decipher.update(encryptedSnapshot.subarray(headerEnd, tagStart)),
      decipher.final(),
    ])
  } catch {
    // AES-GCM authentication failure: wrong password or tampered ciphertext
    throw new SnapshotError('wrongPassword', 'Snapshot password is incorrect or the snapshot file is corrupted')
  }
}

export function parseEncryptedDatabaseSnapshot(encryptedSnapshot: Buffer, passwordValue: unknown) {
  const decrypted = decryptDatabaseSnapshotBuffer(encryptedSnapshot, passwordValue)
  try {
    return JSON.parse(decrypted.toString('utf8'))
  } catch {
    throw new SnapshotError('corruptedFile', 'Decrypted snapshot is not valid JSON')
  }
}

function snapshotSigningKey() {
  const explicit = process.env.SNAPSHOT_SIGNING_KEY
  if (explicit) return Buffer.from(explicit, 'utf8')
  const sessionSecret = process.env.SESSION_SECRET
  if (!sessionSecret) throw new Error('Missing SNAPSHOT_SIGNING_KEY / SESSION_SECRET env var')
  return crypto.createHmac('sha256', sessionSecret).update('fsi-buchhaltung snapshot signing v1').digest()
}

function signChecksum(checksum: string) {
  return crypto.createHmac('sha256', snapshotSigningKey()).update(checksum).digest('hex')
}

function snapshotSignature(checksum: string) {
  return { algorithm: SIGNATURE_ALGORITHM, value: signChecksum(checksum) } as const
}

function isSignatureValid(snapshot: DatabaseSnapshot, integrityValid: boolean) {
  const value = snapshot.signature?.value
  const checksum = snapshot.integrity?.checksum
  if (!integrityValid || !checksum || snapshot.signature?.algorithm !== SIGNATURE_ALGORITHM || typeof value !== 'string') return false
  const expected = Buffer.from(signChecksum(checksum), 'hex')
  const actual = Buffer.from(value, 'hex')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function checksumSnapshot(snapshot: DatabaseSnapshot) {
  const { integrity, signature: _signature, ...snapshotWithoutIntegrity } = snapshot
  if (Number(snapshot.version) >= 3) {
    return sha256({
      ...snapshotWithoutIntegrity,
      tables: snapshot.tables.map(table => ({
        name: table.name,
        columns: table.columns,
        checksum: table.checksum || sha256(tablePayload(table)),
        rows: (table as SnapshotTable & { rowCount?: number }).rowCount ?? table.rows.length,
      })),
    })
  }
  return sha256(snapshotWithoutIntegrity)
}

function tablePayload(table: SnapshotTable) {
  return {
    name: table.name,
    columns: table.columns,
    rows: table.rows,
  }
}

function startTableChecksum(table: { name: string, columns: string[] }) {
  const hash = crypto.createHash('sha256')
  hash.update('{"columns":')
  hash.update(stableStringify(table.columns))
  hash.update(',"name":')
  hash.update(stableStringify(table.name))
  hash.update(',"rows":[')
  return hash
}

async function computeTableChecksum(table: { name: string, columns: string[] }) {
  if (CONTENT_EXCLUDED_TABLES.has(table.name)) {
    return {
      checksum: sha256(tablePayload({ name: table.name, columns: table.columns, rows: [] })),
      rows: 0,
    }
  }

  const conn = await getDbConnection()
  const hash = startTableChecksum(table)
  let count = 0

  try {
    const stream = conn.queryStream(`SELECT * FROM ${quoteIdentifier(table.name)}`)
    for await (const rawRow of stream) {
      if (count > 0) hash.update(',')
      hash.update(stableStringify(normalizeBigInt(rawRow)))
      count += 1
    }
  } finally {
    conn.release()
  }

  hash.update(']}')
  return { checksum: hash.digest('hex'), rows: count }
}

async function* streamTableRows(table: { name: string }) {
  if (CONTENT_EXCLUDED_TABLES.has(table.name)) return

  const conn = await getDbConnection()

  try {
    const stream = conn.queryStream(`SELECT * FROM ${quoteIdentifier(table.name)}`)
    for await (const rawRow of stream) {
      yield normalizeBigInt(rawRow)
    }
  } finally {
    conn.release()
  }
}

export function createDatabaseSnapshotStream() {
  return Readable.from((async function* () {
    const tableDefinitions = await getTableColumns()
    const tableStats = new Map<string, { checksum: string, rows: number }>()

    for (const table of tableDefinitions) {
      tableStats.set(table.name, await computeTableChecksum(table))
    }

    const snapshotMeta: Omit<DatabaseSnapshot, 'tables'> & { tables: [] } = {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      createdAt: new Date().toISOString(),
      database: process.env.DB_NAME || null,
      app: {
        name: process.env.npm_package_name || 'fsi-buchhaltung',
        version: process.env.npm_package_version || null,
      },
      schema: {
        version: process.env.DB_SCHEMA_VERSION || 'init.sql',
        checksum: sha256(tableDefinitions),
      },
      excludedContent: [...CONTENT_EXCLUDED_TABLES],
      tables: [],
    }
    const integrityTables = tableDefinitions.map(table => ({
      name: table.name,
      columns: table.columns,
      rows: [],
      rowCount: tableStats.get(table.name)?.rows || 0,
      checksum: tableStats.get(table.name)!.checksum,
    })) as Array<SnapshotTable & { rowCount: number }>
    const integrity = {
      algorithm: 'sha256' as const,
      checksum: checksumSnapshot({
        ...snapshotMeta,
        tables: integrityTables,
      }),
    }

    yield '{\n'
    yield `  "format": ${JSON.stringify(snapshotMeta.format)},\n`
    yield `  "version": ${snapshotMeta.version},\n`
    yield `  "createdAt": ${JSON.stringify(snapshotMeta.createdAt)},\n`
    yield `  "database": ${JSON.stringify(snapshotMeta.database)},\n`
    yield `  "app": ${JSON.stringify(snapshotMeta.app, null, 2).replace(/\n/g, '\n  ')},\n`
    yield `  "schema": ${JSON.stringify(snapshotMeta.schema, null, 2).replace(/\n/g, '\n  ')},\n`
    yield `  "integrity": ${JSON.stringify(integrity, null, 2).replace(/\n/g, '\n  ')},\n`
    yield `  "signature": ${JSON.stringify(snapshotSignature(integrity.checksum), null, 2).replace(/\n/g, '\n  ')},\n`
    yield `  "excludedContent": ${JSON.stringify(snapshotMeta.excludedContent, null, 2).replace(/\n/g, '\n  ')},\n`
    yield '  "tables": [\n'

    for (const [tableIndex, table] of tableDefinitions.entries()) {
      const stats = tableStats.get(table.name)!
      if (tableIndex > 0) yield ',\n'
      yield '    {\n'
      yield `      "name": ${JSON.stringify(table.name)},\n`
      yield `      "columns": ${JSON.stringify(table.columns, null, 2).replace(/\n/g, '\n      ')},\n`
      yield '      "rows": ['

      let rowIndex = 0
      for await (const row of streamTableRows(table)) {
        if (rowIndex === 0) yield '\n'
        if (rowIndex > 0) yield ',\n'
        yield `        ${JSON.stringify(row, null, 2).replace(/\n/g, '\n        ')}`
        rowIndex += 1
      }

      if (rowIndex > 0) yield '\n      '
      yield `],\n      "checksum": ${JSON.stringify(stats.checksum)}\n`
      yield '    }'
    }

    yield '\n  ]\n'
    yield '}\n'
  })())
}

function parseTarArchive(archive: Buffer) {
  const entries = new Map<string, Buffer>()
  let offset = 0

  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512)
    offset += 512

    if (header.every(byte => byte === 0)) break

    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim()
    const typeFlag = header.subarray(156, 157).toString('ascii') || '0'
    if (!/^[0-7]*$/.test(sizeText)) throw new SnapshotError('archiveInvalid', 'Invalid file archive entry size')

    const size = parseInt(sizeText || '0', 8)
    if (!Number.isFinite(size) || size < 0) throw new SnapshotError('archiveInvalid', 'Invalid file archive entry size')
    if (offset + size > archive.length) throw new SnapshotError('archiveInvalid', 'Files archive is incomplete')

    const content = archive.subarray(offset, offset + size)
    const paddingSize = (512 - (size % 512)) % 512
    offset += size + paddingSize

    if (offset > archive.length) throw new SnapshotError('archiveInvalid', 'Files archive is incomplete')

    if (typeFlag === '0' || typeFlag === '\0') {
      entries.set(name, content)
    }
  }

  if (offset + 512 > archive.length && !archive.subarray(offset).every(byte => byte === 0)) {
    throw new SnapshotError('archiveInvalid', 'Files archive is incomplete')
  }

  return entries
}

function getSnapshotFiles(snapshot: DatabaseSnapshot) {
  const filesTable = snapshot.tables.find(table => table.name === 'files')
  if (!filesTable) return []

  return filesTable.rows.map(row => ({
    id: Number(row.id),
    file_path: String(row.file_path || ''),
    original_name: String(row.original_name || ''),
  })).filter(file => Number.isFinite(file.id) && file.file_path)
}

/**
 * Every `files.file_path` of a snapshot must look like one `storeUploadedFile` writes (SEC-08) —
 * a restored row is later streamed, mailed and deleted by path.
 */
function assertSnapshotFilePaths(snapshot: DatabaseSnapshot) {
  const filesTable = snapshot.tables.find(table => table.name === 'files')
  for (const row of filesTable?.rows ?? []) {
    if (!isWellFormedStoredFilePath(row.file_path) || !resolveStoredFilePath(row.file_path, '/srv/uploads-check')) {
      throw new SnapshotError('archiveInvalid', `Invalid snapshot file path: ${String(row.file_path).slice(0, 200)}`)
    }
  }
}

function readFilesArchive(archive: Buffer) {
  const entries = parseTarArchive(archive)
  const manifestContent = entries.get('manifest.json')
  if (!manifestContent) throw new SnapshotError('archiveInvalid', 'Files archive manifest is missing')

  let manifest: FileArchiveManifest
  try {
    manifest = JSON.parse(manifestContent.toString('utf8')) as FileArchiveManifest
  } catch {
    throw new SnapshotError('archiveInvalid', 'Files archive manifest is invalid')
  }
  if (manifest.format !== 'fsi-buchhaltung.files-archive' || !Array.isArray(manifest.files)) {
    throw new SnapshotError('archiveInvalid', 'Unsupported files archive format')
  }

  return { entries, manifest }
}

export function previewFilesArchiveForSnapshot(snapshotValue: unknown, archive: Buffer) {
  const snapshot = validateSnapshot(snapshotValue)
  const snapshotFiles = getSnapshotFiles(snapshot)
  const { entries, manifest } = readFilesArchive(archive)
  const manifestByFilePath = new Map(manifest.files.map(file => [file.file_path, file]))
  const missingFiles: string[] = []

  for (const snapshotFile of snapshotFiles) {
    const archivedFile = manifestByFilePath.get(snapshotFile.file_path)
    if (!archivedFile?.included || !entries.has(archivedFile.archive_path)) {
      missingFiles.push(snapshotFile.original_name || snapshotFile.file_path)
    }
  }

  if (missingFiles.length) {
    throw new SnapshotError('archiveFilesMissing', `Files archive is missing ${missingFiles.length} file(s)`, { count: missingFiles.length })
  }

  return {
    fileCount: snapshotFiles.length,
    archiveFileCount: manifest.files.filter(file => file.included).length,
  }
}

async function getTableColumns(conn?: mariadb.PoolConnection) {
  const database = process.env.DB_NAME
  const rows = await query<TableColumn[]>(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, ORDINAL_POSITION AS ordinal_position
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME IN (
         SELECT TABLE_NAME
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ?
           AND TABLE_TYPE = 'BASE TABLE'
       )
     ORDER BY TABLE_NAME, ORDINAL_POSITION`,
    [database, database],
    conn,
  )

  const tables = new Map<string, string[]>()
  for (const row of rows) {
    if (SNAPSHOT_EXCLUDED_TABLES.has(row.table_name)) continue
    if (!tables.has(row.table_name)) tables.set(row.table_name, [])
    tables.get(row.table_name)!.push(row.column_name)
  }

  return [...tables.entries()].map(([name, columns]) => ({ name, columns }))
}

export async function createDatabaseSnapshot(): Promise<DatabaseSnapshot> {
  const tableDefinitions = await getTableColumns()
  const tables: SnapshotTable[] = []

  for (const table of tableDefinitions) {
    const rows = CONTENT_EXCLUDED_TABLES.has(table.name)
      ? []
      : await query<Record<string, unknown>[]>(
          `SELECT * FROM ${quoteIdentifier(table.name)}`,
        )
    tables.push({
      name: table.name,
      columns: table.columns,
      rows,
      checksum: sha256(tablePayload({ name: table.name, columns: table.columns, rows })),
    })
  }

  const snapshot: DatabaseSnapshot = {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    database: process.env.DB_NAME || null,
    app: {
      name: process.env.npm_package_name || 'fsi-buchhaltung',
      version: process.env.npm_package_version || null,
    },
    schema: {
      version: process.env.DB_SCHEMA_VERSION || 'init.sql',
      checksum: sha256(tableDefinitions),
    },
    excludedContent: [...CONTENT_EXCLUDED_TABLES],
    tables,
  }

  snapshot.integrity = {
    algorithm: 'sha256',
    checksum: checksumSnapshot(snapshot),
  }
  snapshot.signature = snapshotSignature(snapshot.integrity.checksum)

  return snapshot
}

function validateSnapshot(value: unknown): DatabaseSnapshot {
  if (!value || typeof value !== 'object') throw new SnapshotError('unsupportedFormat', 'Invalid snapshot payload')

  const snapshot = value as DatabaseSnapshot
  if (snapshot.format !== SNAPSHOT_FORMAT || !SUPPORTED_SNAPSHOT_VERSIONS.has(Number(snapshot.version))) {
    throw new SnapshotError('unsupportedFormat', 'Unsupported snapshot format')
  }
  if (!Array.isArray(snapshot.tables)) throw new SnapshotError('unsupportedFormat', 'Snapshot tables are missing')

  for (const table of snapshot.tables) {
    if (!table || typeof table.name !== 'string' || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
      throw new SnapshotError('unsupportedFormat', 'Snapshot contains an invalid table entry')
    }
    try {
      quoteIdentifier(table.name)
      table.columns.forEach(quoteIdentifier)
    } catch {
      throw new SnapshotError('unsupportedFormat', `Snapshot contains invalid identifiers for table ${table.name}`)
    }
    if (table.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
      throw new SnapshotError('unsupportedFormat', `Snapshot contains invalid rows for table ${table.name}`)
    }
  }

  return snapshot
}

export function previewDatabaseSnapshot(value: unknown): SnapshotPreview {
  const snapshot = validateSnapshot(value)
  const integrityChecksum = snapshot.integrity?.checksum || null
  const integrityValid = integrityChecksum ? checksumSnapshot(snapshot) === integrityChecksum : false
  const signatureValid = isSignatureValid(snapshot, integrityValid)

  if (snapshot.integrity && snapshot.integrity.algorithm !== 'sha256') {
    throw new SnapshotError('unsupportedFormat', 'Unsupported snapshot checksum algorithm')
  }

  for (const table of snapshot.tables) {
    if (table.checksum && table.checksum !== sha256(tablePayload(table))) {
      throw new SnapshotError('integrityFailed', `Snapshot checksum does not match table ${table.name}`)
    }
  }

  return {
    ok: true,
    format: snapshot.format,
    version: Number(snapshot.version),
    createdAt: typeof snapshot.createdAt === 'string' ? snapshot.createdAt : null,
    database: typeof snapshot.database === 'string' ? snapshot.database : null,
    appName: snapshot.app?.name || null,
    appVersion: snapshot.app?.version || null,
    schemaVersion: snapshot.schema?.version || null,
    schemaChecksum: snapshot.schema?.checksum || null,
    tables: snapshot.tables.length,
    rows: snapshot.tables.reduce((sum, table) => (
      CONTENT_EXCLUDED_TABLES.has(table.name) ? sum : sum + table.rows.length
    ), 0),
    excludedContent: Array.isArray(snapshot.excludedContent) ? snapshot.excludedContent : [],
    integrity: {
      present: Boolean(integrityChecksum),
      valid: integrityValid,
      algorithm: snapshot.integrity?.algorithm || null,
      checksum: integrityChecksum,
    },
    signature: {
      present: Boolean(snapshot.signature),
      valid: signatureValid,
    },
  }
}

export async function assertSnapshotMatchesCurrentSchema(snapshot: DatabaseSnapshot, conn?: mariadb.PoolConnection) {
  const currentTables = await getTableColumns(conn)
  const currentTableMap = new Map(currentTables.map(table => [table.name, table.columns]))
  const snapshotTableMap = new Map(snapshot.tables.map(table => [table.name, table]))

  const missingTables = currentTables.filter(table => !snapshotTableMap.has(table.name)).map(table => table.name)
  const unknownTables = snapshot.tables.filter(table => !currentTableMap.has(table.name)).map(table => table.name)
  if (missingTables.length || unknownTables.length) {
    const parts: string[] = []
    if (missingTables.length) parts.push(`tables missing from snapshot: ${missingTables.join(', ')}`)
    if (unknownTables.length) parts.push(`tables in snapshot not in DB: ${unknownTables.join(', ')}`)
    throw new SnapshotError('schemaMismatch', `Snapshot schema does not match this app database`, { details: parts.join(' | ') })
  }

  for (const table of snapshot.tables) {
    const currentColumns = currentTableMap.get(table.name)!
    const currentColumnKey = currentColumns.join('|')
    const snapshotColumnKey = table.columns.join('|')
    if (currentColumnKey !== snapshotColumnKey) {
      const currentColumnSet = new Set(currentColumns)
      const snapshotColumnSet = new Set(table.columns)
      const addedColumns = currentColumns.filter(col => !snapshotColumnSet.has(col))
      const removedColumns = table.columns.filter(col => !currentColumnSet.has(col))
      const parts: string[] = [`table: ${table.name}`]
      if (addedColumns.length) parts.push(`columns added since snapshot: ${addedColumns.join(', ')}`)
      if (removedColumns.length) parts.push(`columns removed since snapshot: ${removedColumns.join(', ')}`)
      if (!addedColumns.length && !removedColumns.length) parts.push(`column order differs — DB: [${currentColumns.join(', ')}], snapshot: [${table.columns.join(', ')}]`)
      throw new SnapshotError('schemaMismatch', `Snapshot columns do not match table ${table.name}`, { details: parts.join(' | ') })
    }
  }

  return { currentTables, snapshotTableMap }
}

export async function previewDatabaseSnapshotForCurrentSchema(value: unknown) {
  const snapshot = validateSnapshot(value)
  const preview = previewDatabaseSnapshot(snapshot)
  await assertSnapshotMatchesCurrentSchema(snapshot)
  return preview
}

export async function restoreDatabaseSnapshot(
  value: unknown,
  beforeCommit?: () => Promise<void>,
  options: { allowForeign?: boolean } = {},
) {
  const snapshot = validateSnapshot(value)
  assertSnapshotFilePaths(snapshot)
  const preview = previewDatabaseSnapshot(snapshot)
  if (preview.integrity.present && !preview.integrity.valid) {
    throw new SnapshotError('integrityFailed', 'Snapshot integrity check failed')
  }
  // Unsigned (old) or foreign snapshots need an explicit confirmation — a restore rewrites users,
  // permissions and the audit history (SEC-09).
  if (!preview.signature.valid && !options.allowForeign) {
    throw new SnapshotError('untrustedSnapshot', 'Snapshot was not signed by this server')
  }

  return await withTransaction(async (conn) => {
    const { currentTables, snapshotTableMap } = await assertSnapshotMatchesCurrentSchema(snapshot, conn)

    try {
      await query('SET FOREIGN_KEY_CHECKS = 0', [], conn)

      for (const table of [...currentTables].reverse()) {
        await query(`DELETE FROM ${quoteIdentifier(table.name)}`, [], conn)
      }

      const insertTables = [
        ...currentTables.filter(table => table.name !== 'entity_versions'),
        ...currentTables.filter(table => table.name === 'entity_versions'),
      ]

      for (const table of insertTables) {
        const snapshotTable = snapshotTableMap.get(table.name)!
        const rows = CONTENT_EXCLUDED_TABLES.has(table.name) ? [] : snapshotTable.rows
        if (table.name === 'entity_versions') {
          await query(`DELETE FROM ${quoteIdentifier(table.name)}`, [], conn)
        }
        if (!rows.length) continue

        const columnList = table.columns.map(quoteIdentifier).join(', ')
        const placeholderList = table.columns.map(() => '?').join(', ')
        const sql = `INSERT INTO ${quoteIdentifier(table.name)} (${columnList}) VALUES (${placeholderList})`

        for (const row of rows) {
          await query(sql, table.columns.map(column => row[column] ?? null), conn)
        }
      }

      if (beforeCommit) await beforeCommit()
    } finally {
      await query('SET FOREIGN_KEY_CHECKS = 1', [], conn)
    }

    return {
      ok: true as const,
      tables: snapshot.tables.length,
      rows: snapshot.tables.reduce((sum, table) => (
        CONTENT_EXCLUDED_TABLES.has(table.name) ? sum : sum + table.rows.length
      ), 0),
    }
  })
}

export function prepareFilesArchiveRestoreForSnapshot(snapshotValue: unknown, archive: Buffer) {
  const snapshot = validateSnapshot(snapshotValue)
  const snapshotFiles = getSnapshotFiles(snapshot)
  const { entries, manifest } = readFilesArchive(archive)
  const manifestByFilePath = new Map(manifest.files.map(file => [file.file_path, file]))
  const uploadRoot = process.env.UPLOAD_DIR

  if (!uploadRoot) throw new Error('Missing UPLOAD_DIR env var')

  const resolvedUploadRoot = path.resolve(uploadRoot)
  const filesToWrite: TarEntry[] = []

  for (const snapshotFile of snapshotFiles) {
    const archivedFile = manifestByFilePath.get(snapshotFile.file_path)
    if (!archivedFile?.included) throw new SnapshotError('archiveFilesMissing', `Files archive is missing ${snapshotFile.original_name}`, { count: 1 })

    const content = entries.get(archivedFile.archive_path)
    if (!content) throw new SnapshotError('archiveFilesMissing', `Files archive is missing ${snapshotFile.original_name}`, { count: 1 })

    const absolutePath = resolveStoredFilePath(snapshotFile.file_path, resolvedUploadRoot)
    if (!absolutePath) {
      throw new SnapshotError('archiveInvalid', `Invalid snapshot file path: ${snapshotFile.file_path}`)
    }

    filesToWrite.push({ name: absolutePath, content })
  }

  return filesToWrite
}

export async function restorePreparedFilesArchive(filesToWrite: TarEntry[]) {
  const backups: Array<{ name: string, existed: boolean, content?: Buffer }> = []

  try {
    for (const file of filesToWrite) {
      try {
        backups.push({ name: file.name, existed: true, content: await fs.readFile(file.name) })
      } catch (err: any) {
        if (err?.code !== 'ENOENT') throw err
        backups.push({ name: file.name, existed: false })
      }

      await fs.mkdir(path.dirname(file.name), { recursive: true })
      await fs.writeFile(file.name, file.content, { mode: 0o640 })
    }
  } catch (err) {
    for (const backup of backups.reverse()) {
      if (backup.existed) {
        await fs.mkdir(path.dirname(backup.name), { recursive: true })
        await fs.writeFile(backup.name, backup.content!, { mode: 0o640 })
      } else {
        await fs.rm(backup.name, { force: true })
      }
    }

    throw err
  }

  return {
    ok: true as const,
    files: filesToWrite.length,
  }
}

export async function restoreFilesArchiveForSnapshot(snapshotValue: unknown, archive: Buffer) {
  return await restorePreparedFilesArchive(prepareFilesArchiveRestoreForSnapshot(snapshotValue, archive))
}
