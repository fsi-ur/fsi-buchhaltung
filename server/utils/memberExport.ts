import { query } from '~/server/utils/db'
import { isMemberStatus, parseMemberStatus } from '~/server/utils/members'
import {
  MemberStatus,
  type MemberExportColumn,
  type MemberExportConfig,
  type MemberExportDataColumnKey,
} from '~/types/member'
import type { LocalDate } from '~/shared/time'

export interface MemberExportRow {
  last_name: string
  first_name: string
  birthdate: string
  status: MemberStatus
  honorary: boolean
  subject_name: string | null
  email: string
  phone: string
  street: string
  street_number: string
  postal_code: string
  city: string
  joined_at: string
  left_at: string | null
}

const DATA_COLUMN_KEYS: MemberExportDataColumnKey[] = [
  'last_name', 'first_name', 'birthdate', 'subject', 'status', 'email', 'phone', 'address', 'joined_at', 'left_at',
]

const MAX_COLUMNS = 10
const MAX_TITLE_LENGTH = 160
const MAX_LABEL_LENGTH = 60
const MAX_HINT_LENGTH = 80

const STATUS_LABELS: Record<MemberStatus, string> = {
  [MemberStatus.Active]: 'Aktiv',
  [MemberStatus.Passive]: 'Passiv',
  [MemberStatus.Hold]: 'Ruhend',
  [MemberStatus.Left]: 'Ausgetreten',
}

/** Relative column widths for the PDF table and character widths for the Excel sheet, per column kind. */
const COLUMN_METRICS: Record<MemberExportDataColumnKey | 'blank', { weight: number, excelWidth: number }> = {
  last_name: { weight: 1, excelWidth: 20 },
  first_name: { weight: 1, excelWidth: 18 },
  birthdate: { weight: 1, excelWidth: 13 },
  subject: { weight: 1.1, excelWidth: 22 },
  status: { weight: 0.85, excelWidth: 13 },
  email: { weight: 1.5, excelWidth: 30 },
  phone: { weight: 1, excelWidth: 18 },
  address: { weight: 1.7, excelWidth: 34 },
  joined_at: { weight: 1, excelWidth: 13 },
  left_at: { weight: 1, excelWidth: 13 },
  blank: { weight: 1.4, excelWidth: 26 },
}

export function memberExportColumnMetrics(column: MemberExportColumn) {
  return COLUMN_METRICS[column.key]
}

export function parseMemberExportConfig(body: unknown): { ok: true, config: MemberExportConfig } | { ok: false, error: string } {
  const raw = (body ?? {}) as Record<string, unknown>

  const title = String(raw.title ?? '').trim()
  if (!title) return { ok: false, error: 'Ein Titel ist erforderlich.' }
  if (title.length > MAX_TITLE_LENGTH) return { ok: false, error: 'Der Titel ist zu lang.' }

  if (!Array.isArray(raw.columns) || !raw.columns.length) {
    return { ok: false, error: 'Mindestens eine Spalte ist erforderlich.' }
  }
  if (raw.columns.length > MAX_COLUMNS) {
    return { ok: false, error: `Höchstens ${MAX_COLUMNS} Spalten sind erlaubt.` }
  }

  const columns: MemberExportColumn[] = []
  for (const entry of raw.columns) {
    const column = (entry ?? {}) as Record<string, unknown>
    const key = String(column.key ?? '')
    if (key !== 'blank' && !DATA_COLUMN_KEYS.includes(key as MemberExportDataColumnKey)) {
      return { ok: false, error: 'Ungültige Spaltenauswahl.' }
    }

    const label = String(column.label ?? '').trim()
    if (!label) return { ok: false, error: 'Jede Spalte benötigt eine Beschriftung.' }
    if (label.length > MAX_LABEL_LENGTH) return { ok: false, error: 'Eine Spaltenbeschriftung ist zu lang.' }

    const hint = String(column.hint ?? '').trim()
    if (hint.length > MAX_HINT_LENGTH) return { ok: false, error: 'Ein Spaltenhinweis ist zu lang.' }

    columns.push({ key: key as MemberExportColumn['key'], label, ...(hint ? { hint } : {}) })
  }

  if (!Array.isArray(raw.statuses) || !raw.statuses.length) {
    return { ok: false, error: 'Mindestens ein Mitgliedsstatus ist erforderlich.' }
  }

  const statuses: MemberStatus[] = []
  for (const entry of raw.statuses) {
    const status = String(entry ?? '')
    if (!isMemberStatus(status)) return { ok: false, error: 'Ungültiger Mitgliedsstatus.' }
    if (!statuses.includes(status)) statuses.push(status)
  }

  return { ok: true, config: { title, columns, statuses } }
}

export async function loadMembersForExport(statuses: MemberStatus[]): Promise<MemberExportRow[]> {
  const placeholders = statuses.map(() => '?').join(', ')
  const rows: any[] = await query(
    `
    SELECT
      m.last_name,
      m.first_name,
      m.birthdate,
      m.status,
      m.honorary,
      m.email,
      m.phone,
      m.street,
      m.street_number,
      m.postal_code,
      m.city,
      m.joined_at,
      m.left_at,
      s.name AS subject_name
    FROM members m
    LEFT JOIN subjects s ON s.id = m.subject
    WHERE m.status IN (${placeholders})
    ORDER BY m.last_name ASC, m.first_name ASC
    `,
    statuses,
  )

  return rows.map(row => ({
    last_name: String(row.last_name ?? ''),
    first_name: String(row.first_name ?? ''),
    birthdate: String(row.birthdate ?? ''),
    status: (parseMemberStatus(String(row.status)) ?? MemberStatus.Active) as MemberStatus,
    honorary: Boolean(row.honorary),
    subject_name: row.subject_name ? String(row.subject_name) : null,
    email: String(row.email ?? ''),
    phone: String(row.phone ?? ''),
    street: String(row.street ?? ''),
    street_number: String(row.street_number ?? ''),
    postal_code: String(row.postal_code ?? ''),
    city: String(row.city ?? ''),
    joined_at: String(row.joined_at ?? ''),
    left_at: row.left_at ? String(row.left_at) : null,
  }))
}

function formatExportDate(value: string | null | undefined) {
  if (!value) return ''
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return value
  return `${match[3]}.${match[2]}.${match[1]}`
}

export function memberExportCellValue(member: MemberExportRow, column: MemberExportColumn): string {
  switch (column.key) {
    case 'last_name':
      return member.last_name
    case 'first_name':
      return member.first_name
    case 'birthdate':
      return formatExportDate(member.birthdate)
    case 'subject':
      return member.subject_name ?? ''
    case 'status': {
      const label = STATUS_LABELS[member.status]
      return member.honorary ? `${label} · Ehrenmitglied` : label
    }
    case 'email':
      return member.email
    case 'phone':
      return member.phone
    case 'address': {
      const streetLine = [member.street, member.street_number].map(part => part.trim()).filter(Boolean).join(' ')
      const cityLine = [member.postal_code, member.city].map(part => part.trim()).filter(Boolean).join(' ')
      return [streetLine, cityLine].filter(Boolean).join(', ')
    }
    case 'joined_at':
      return formatExportDate(member.joined_at)
    case 'left_at':
      return formatExportDate(member.left_at)
    case 'blank':
      return ''
  }
}

export function memberExportFileName(extension: 'pdf' | 'xlsx', createdOn: LocalDate) {
  return `Mitgliederliste_${createdOn}.${extension}`
}
