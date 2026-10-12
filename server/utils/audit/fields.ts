import { getAuditTableDefinition } from '~/server/utils/audit/registry'

export type FieldKind = 'money' | 'date' | 'datetime' | 'bool' | 'text' | 'number' | 'reference' | 'json'

const MONEY_COLUMNS = new Set([
  'amount', 'amount_before', 'amount_after', 'unit_price', 'unit_deposit',
  'expense_amount', 'income_amount', 'advance',
])

const BOOLEAN_COLUMNS = new Set([
  'is_active', 'is_default', 'is_done', 'is_kleinunternehmer', 'is_archived', 'is_published',
  'is_default_role', 'honorary', 'cash', 'requires_review', 'include_descendants', 'enabled',
  'must_change_password', 'active',
])

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/

/**
 * Columns are typed by DB value shape, not a per-table schema map: DATE columns serialize from
 * JSON_OBJECT() as bare "YYYY-MM-DD" and DATETIME as "YYYY-MM-DD HH:MM:SS" (a wall clock in the app
 * time zone), so the string shape alone tells them apart without hardcoding every column. TIMESTAMP
 * values have already been turned into ISO instants with "Z" by log.ts (markInstants) — still a
 * 'datetime' here, and the client's formatter converts them because they carry their offset.
 */
export function fieldKind(table: string, column: string, value: unknown): FieldKind {
  const def = getAuditTableDefinition(table)
  // A column registered in the table's `references` gets its target resolved to a name (fields.ts
  // resolveReferences). Any other `_id`/`_by` column is still rendered as a reference (right-aligned
  // "#123" style) rather than a bare number — even without a registered target, that's a more honest
  // rendering than pretending it's an arbitrary number, and keeps the display consistent across
  // tables that do and don't have a registry entry for a given FK column.
  if (def?.references?.[column]) return 'reference'
  if (/(^|_)(id|by)$/.test(column) && column !== 'id') return 'reference'

  if (value === null || value === undefined) {
    if (MONEY_COLUMNS.has(column)) return 'money'
    return 'text'
  }

  if (typeof value === 'string') {
    if (DATE_ONLY_PATTERN.test(value)) return 'date'
    if (DATETIME_PATTERN.test(value)) return 'datetime'
    if ((value.startsWith('{') || value.startsWith('[')) && isJsonParsable(value)) return 'json'
    return 'text'
  }

  if (typeof value === 'boolean') return 'bool'

  if (typeof value === 'number') {
    if (MONEY_COLUMNS.has(column)) return 'money'
    if (BOOLEAN_COLUMNS.has(column) && (value === 0 || value === 1)) return 'bool'
    return 'number'
  }

  return 'text'
}

function isJsonParsable(value: string) {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

/**
 * `audit.fields.<table>.<column>` / `audit.fields.common.<column>` labels only exist in i18n for
 * the tables/columns called out as priority in the audit log plan. Returning `null` here tells the
 * client no such key exists, so it falls back to the raw column name instead of rendering a
 * literal, untranslated i18n path.
 */
const TABLE_SPECIFIC_FIELD_KEYS: Record<string, Set<string>> = {
  receipts: new Set(['receipt_date', 'receipt_number', 'description', 'status', 'company_id']),
  receipt_positions: new Set(['sphere', 'cost_centre', 'amount', 'tax']),
  invoices: new Set(['invoice_number', 'invoice_date', 'due_date', 'paid_at', 'status', 'subject', 'company_id', 'is_kleinunternehmer']),
  invoice_positions: new Set(['name', 'description', 'sphere', 'cost_centre', 'quantity', 'unit', 'unit_price', 'tax']),
  reimbursements: new Set(['paid_by', 'checked_by', 'disbursed_by', 'iban', 'bic', 'advance', 'cash']),
  members: new Set(['first_name', 'last_name', 'birthdate', 'street', 'street_number', 'postal_code', 'city', 'subject', 'phone', 'email', 'status', 'honorary', 'applied_at', 'joined_at', 'left_at']),
  events: new Set(['name', 'starts_at', 'ends_at', 'location', 'expected_guests']),
  users: new Set(['username', 'is_active', 'must_change_password']),
  roles: new Set(['code', 'name', 'is_active', 'is_default']),
}

const COMMON_FIELD_KEYS = new Set([
  'status', 'note', 'notes', 'name', 'description', 'created_at', 'title',
])

export function fieldLabelKey(table: string, column: string): string | null {
  if (TABLE_SPECIFIC_FIELD_KEYS[table]?.has(column)) return `audit.fields.${table}.${column}`
  if (COMMON_FIELD_KEYS.has(column)) return `audit.fields.common.${column}`
  return null
}

/** Columns that are pure timestamp side effects and never worth a diff line of their own. */
export const GLOBALLY_IGNORED_COLUMNS = new Set(['updated_at'])
