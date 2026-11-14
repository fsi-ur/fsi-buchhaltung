import type * as mariadb from 'mariadb'
import { query } from '~/server/utils/db'
import type {
  FinanceAccountOption,
  FinanceAccountRow,
  FinanceAccountType,
  SaveFinanceAccountBody,
} from '~/types/financeAccount'

/**
 * The association's own money accounts.
 *
 * Invariants (kept by the application, see {@link ensureDefaultFinanceAccount}):
 * - Bank features (statements, bank reimbursements, bank parts of the analysis) are on as long as
 *   at least one account is active (not archived).
 * - Whenever an active account with an IBAN exists, exactly one of them is the default — the one
 *   printed on invoices. Without such an account there is no default.
 * - The default needs an IBAN and can only be archived when no other active account with an IBAN
 *   could take over (archiving the last account switches bank features off). An account that
 *   anything books on cannot be deleted, only archived.
 */

export const BANK_FEATURES_DISABLED = 'Es ist kein aktives Konto angelegt. Bankfunktionen sind deaktiviert.'

const ACCOUNT_COLUMNS = `id, name, account_type, account_holder, iban, bic, bankname, identifier, notes, is_default, archived_at`

function optionalString(value: unknown, maxLength: number) {
  const normalized = String(value ?? '').trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

export function normalizeIban(value: unknown) {
  const normalized = String(value ?? '').replace(/\s+/g, '').toUpperCase()
  return normalized || null
}

/** ISO 13616 check: country code, check digits, alphanumeric BBAN, mod 97 == 1. */
export function isValidIban(iban: string) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`
  let remainder = 0
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55)
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

export function formatIban(iban: string | null) {
  if (!iban) return ''
  return iban.replace(/(.{4})/g, '$1 ').trim()
}

export function mapFinanceAccountRow(row: any): FinanceAccountRow {
  return {
    id: Number(row.id),
    name: String(row.name),
    account_type: row.account_type === 'other' ? 'other' : 'bank',
    account_holder: row.account_holder ? String(row.account_holder) : null,
    iban: row.iban ? String(row.iban) : null,
    bic: row.bic ? String(row.bic) : null,
    bankname: row.bankname ? String(row.bankname) : null,
    identifier: row.identifier ? String(row.identifier) : null,
    notes: row.notes ? String(row.notes) : null,
    is_default: Boolean(Number(row.is_default)),
    archived: row.archived_at !== null && row.archived_at !== undefined,
  }
}

export function toFinanceAccountOption(account: FinanceAccountRow): FinanceAccountOption {
  return {
    id: account.id,
    name: account.name,
    account_type: account.account_type,
    iban: account.iban,
    is_default: account.is_default,
    archived: account.archived,
  }
}

/** All accounts, active ones first (default on top), then archived; each group by name. */
export async function loadFinanceAccounts(conn?: mariadb.PoolConnection): Promise<FinanceAccountRow[]> {
  const rows = await query<any[]>(
    `SELECT ${ACCOUNT_COLUMNS}
     FROM finance_accounts
     ORDER BY archived_at IS NOT NULL ASC, is_default DESC, name ASC, id ASC`,
    [],
    conn,
  )
  return rows.map(mapFinanceAccountRow)
}

export async function loadFinanceAccount(id: number, conn?: mariadb.PoolConnection): Promise<FinanceAccountRow | null> {
  const rows = await query<any[]>(`SELECT ${ACCOUNT_COLUMNS} FROM finance_accounts WHERE id = ? LIMIT 1`, [id], conn)
  return rows.length ? mapFinanceAccountRow(rows[0]) : null
}

export async function hasActiveFinanceAccount(conn?: mariadb.PoolConnection) {
  const rows = await query<any[]>(`SELECT 1 FROM finance_accounts WHERE archived_at IS NULL LIMIT 1`, [], conn)
  return rows.length > 0
}

/** Any account, archived ones included — old bank data stays viewable while one exists. */
export async function hasAnyFinanceAccount(conn?: mariadb.PoolConnection) {
  const rows = await query<any[]>(`SELECT 1 FROM finance_accounts LIMIT 1`, [], conn)
  return rows.length > 0
}

export async function loadDefaultFinanceAccount(conn?: mariadb.PoolConnection): Promise<FinanceAccountRow | null> {
  const rows = await query<any[]>(
    `SELECT ${ACCOUNT_COLUMNS} FROM finance_accounts
     WHERE is_default = 1 AND archived_at IS NULL AND iban IS NOT NULL
     ORDER BY id ASC LIMIT 1`,
    [],
    conn,
  )
  return rows.length ? mapFinanceAccountRow(rows[0]) : null
}

/**
 * Repairs the default after a change: drops the flag from accounts that may not carry it and, when
 * no valid default is left but an active account with an IBAN exists, makes the oldest one default.
 */
export async function ensureDefaultFinanceAccount(conn: mariadb.PoolConnection) {
  await query(
    `UPDATE finance_accounts SET is_default = 0
     WHERE is_default = 1 AND (archived_at IS NOT NULL OR iban IS NULL)`,
    [],
    conn,
  )
  const defaults = await query<Array<{ id: number }>>(
    `SELECT id FROM finance_accounts WHERE is_default = 1 ORDER BY id ASC FOR UPDATE`,
    [],
    conn,
  )
  if (defaults.length > 1) {
    await query(`UPDATE finance_accounts SET is_default = 0 WHERE is_default = 1 AND id <> ?`, [defaults[0]!.id], conn)
  }
  if (defaults.length) return

  await query(
    `UPDATE finance_accounts SET is_default = 1
     WHERE archived_at IS NULL AND iban IS NOT NULL
     ORDER BY id ASC
     LIMIT 1`,
    [],
    conn,
  )
}

/** Whether anything books on the account: statements, transfers, reimbursements. */
export async function isFinanceAccountInUse(id: number, conn?: mariadb.PoolConnection) {
  const [row] = await query<Array<{ used: number }>>(
    `SELECT (
       EXISTS (SELECT 1 FROM bank_statements WHERE account_id = ?)
       OR EXISTS (SELECT 1 FROM bank_statement_positions WHERE counter_account_id = ?)
       OR EXISTS (SELECT 1 FROM reimbursements WHERE paid_from_account_id = ?)
     ) AS used`,
    [id, id, id],
    conn,
  )
  return Boolean(Number(row?.used))
}

export async function loadFinanceAccountIdsInUse(conn?: mariadb.PoolConnection) {
  const rows = await query<Array<{ id: number }>>(
    `SELECT account_id AS id FROM bank_statements
     UNION SELECT counter_account_id FROM bank_statement_positions WHERE counter_account_id IS NOT NULL
     UNION SELECT paid_from_account_id FROM reimbursements WHERE paid_from_account_id IS NOT NULL`,
    [],
    conn,
  )
  return new Set(rows.map(row => Number(row.id)))
}

/**
 * An account a record may (newly) book on: it exists and is active. A record that already books on
 * an account that was archived since may keep it (`currentId`), so old records stay editable.
 */
export async function validateBookableAccount(
  accountId: number | null,
  conn: mariadb.PoolConnection,
  currentId: number | null = null,
): Promise<string | null> {
  if (!accountId) return 'Bitte wähle ein Konto aus.'
  const account = await loadFinanceAccount(accountId, conn)
  if (!account) return 'Das gewählte Konto existiert nicht.'
  if (account.archived && accountId !== currentId) return `Das Konto „${account.name}" ist archiviert.`
  return null
}

export function normalizeFinanceAccountBody(body: Partial<SaveFinanceAccountBody> | null | undefined) {
  const accountType: FinanceAccountType = body?.account_type === 'other' ? 'other' : 'bank'
  const isBank = accountType === 'bank'
  return {
    id: Number(body?.id) > 0 ? Number(body?.id) : undefined,
    name: String(body?.name ?? '').trim(),
    account_type: accountType,
    account_holder: optionalString(body?.account_holder, 255),
    // Bank details only belong to bank accounts; an "other" account (PayPal, ...) has an identifier.
    iban: isBank ? normalizeIban(body?.iban) : null,
    bic: isBank ? (optionalString(body?.bic, 11)?.replace(/\s+/g, '').toUpperCase() ?? null) : null,
    bankname: isBank ? optionalString(body?.bankname, 127) : null,
    identifier: isBank ? null : optionalString(body?.identifier, 255),
    notes: optionalString(body?.notes, 5000),
    // An archived account is never the default (the save endpoint decides whether it may be archived).
    is_default: body?.is_default === true && body?.archived !== true,
    archived: body?.archived === true,
  }
}

export type NormalizedFinanceAccountBody = ReturnType<typeof normalizeFinanceAccountBody>

export function validateFinanceAccountBody(body: NormalizedFinanceAccountBody) {
  if (!body.name) return 'Bitte gib einen Namen für das Konto an.'
  if (body.name.length > 127) return 'Der Name darf höchstens 127 Zeichen lang sein.'
  if (body.account_type === 'bank') {
    if (!body.iban) return 'Ein Bankkonto braucht eine IBAN.'
    if (!isValidIban(body.iban)) return 'Die IBAN ist ungültig.'
  }
  if (body.is_default && !body.iban) return 'Nur ein Konto mit IBAN kann das Standardkonto sein.'
  return null
}
