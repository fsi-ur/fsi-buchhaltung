import { query } from '~/server/utils/db'
import { hashPassword } from '~/server/utils/auth'
import type { PermissionKey } from '~/config/permissions'

let counter = 0
function unique(prefix: string) {
  counter += 1
  return `${prefix}_${counter}`
}

export function resetFixtureCounter() {
  counter = 0
}

async function insert(sql: string, params: unknown[]): Promise<number> {
  const result = await query<any>(sql, params)
  return Number(result.insertId)
}

const passwordHashes = new Map<string, Promise<string>>()

function hashOnce(password: string) {
  const cached = passwordHashes.get(password)
  if (cached) return cached

  const pending = hashPassword(password)
  passwordHashes.set(password, pending)
  return pending
}

export async function createUser(options: {
  username?: string
  password?: string
  isActive?: boolean
  mustChangePassword?: boolean
  permissions?: PermissionKey[]
} = {}) {
  const username = options.username ?? unique('user')
  const passwordHash = await hashOnce(options.password ?? 'password')

  const id = await insert(
    `INSERT INTO users (username, password_hash, is_active, must_change_password)
     VALUES (?, ?, ?, ?)`,
    [username, passwordHash, options.isActive === false ? 0 : 1, options.mustChangePassword ? 1 : 0],
  )

  if (options.permissions?.length) await grantUserPermissions(id, options.permissions)

  return { id, username, password: options.password ?? 'password' }
}

export async function grantUserPermissions(userId: number, permissions: PermissionKey[]) {
  for (const permission of permissions) {
    await query(
      'INSERT IGNORE INTO user_permissions (user_id, permission_key) VALUES (?, ?)',
      [userId, permission],
    )
  }
}

export async function createRole(options: {
  code?: string
  name?: string
  isActive?: boolean
  isDefault?: boolean
  permissions?: PermissionKey[]
} = {}) {
  const code = options.code ?? unique('role')
  const id = await insert(
    `INSERT INTO roles (code, name, is_active, is_default) VALUES (?, ?, ?, ?)`,
    [code, options.name ?? code, options.isActive === false ? 0 : 1, options.isDefault ? 1 : 0],
  )

  for (const permission of options.permissions ?? []) {
    await query('INSERT IGNORE INTO role_permissions (role_id, permission_key) VALUES (?, ?)', [id, permission])
  }

  return id
}

export async function assignRole(userId: number, roleId: number) {
  await query('INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)', [userId, roleId])
}

export async function createPosition(options: {
  code?: string
  name?: string
  isActive?: boolean
  permissions?: PermissionKey[]
} = {}) {
  const code = options.code ?? unique('pos')
  const id = await insert(
    `INSERT INTO positions (code, name, is_active) VALUES (?, ?, ?)`,
    [code, options.name ?? code, options.isActive === false ? 0 : 1],
  )

  for (const permission of options.permissions ?? []) {
    await query('INSERT IGNORE INTO position_permissions (position_id, permission_key) VALUES (?, ?)', [id, permission])
  }

  return id
}

export async function createSubject(name = unique('subject')) {
  return insert('INSERT INTO subjects (name) VALUES (?)', [name])
}

export async function createMember(options: {
  accountId?: number | null
  firstName?: string
  lastName?: string
  status?: string
  subjectId?: number
  leftAt?: string | null
} = {}) {
  const subjectId = options.subjectId ?? await createSubject()

  return insert(
    `INSERT INTO members
      (account, last_name, first_name, birthdate, street, street_number, postal_code, city,
       subject, phone, email, status, applied_at, joined_at, left_at)
     VALUES (?, ?, ?, '2000-01-01', 'Teststr.', '1', '12345', 'Teststadt', ?, '0123', ?, ?, '2024-01-01', '2024-01-01', ?)`,
    [
      options.accountId ?? null,
      options.lastName ?? 'Muster',
      options.firstName ?? unique('Vorname'),
      subjectId,
      `${unique('mail')}@test.invalid`,
      options.status ?? 'active',
      options.leftAt ?? null,
    ],
  )
}

export async function assignPosition(memberId: number, positionId: number, options: {
  since?: string
  until?: string | null
} = {}) {
  return insert(
    'INSERT INTO member_positions (member_id, position_id, since, until) VALUES (?, ?, ?, ?)',
    [memberId, positionId, options.since ?? '2024-01-01', options.until ?? null],
  )
}

export async function createSphere(options: { code?: string, name?: string } = {}) {
  const code = options.code ?? unique('sph')
  return insert('INSERT INTO spheres (code, name) VALUES (?, ?)', [code, options.name ?? code])
}

export async function createCostCentre(options: { code?: string, name?: string } = {}) {
  const code = options.code ?? unique('cc')
  return insert('INSERT INTO cost_centres (code, name) VALUES (?, ?)', [code, options.name ?? code])
}

/** An own account (bank by default, with a valid IBAN); bank statements need one. */
export async function createFinanceAccount(options: {
  name?: string
  type?: 'bank' | 'other'
  iban?: string | null
  isDefault?: boolean
  archived?: boolean
} = {}) {
  const type = options.type ?? 'bank'
  const iban = options.iban !== undefined ? options.iban : (type === 'bank' ? 'DE89370400440532013000' : null)
  return insert(
    `INSERT INTO finance_accounts (name, account_type, iban, is_default, archived_at) VALUES (?, ?, ?, ?, ${options.archived ? 'CURRENT_TIMESTAMP' : 'NULL'})`,
    [options.name ?? unique('Konto'), type, iban, options.isDefault ? 1 : 0],
  )
}

export async function createCompany(options: { name?: string } = {}) {
  return insert('INSERT INTO companies (name) VALUES (?)', [options.name ?? unique('Firma')])
}

export async function createEvent(options: {
  name?: string
  startsAt?: string
  endsAt?: string
  location?: string | null
} = {}) {
  return insert(
    'INSERT INTO events (name, starts_at, ends_at, location) VALUES (?, ?, ?, ?)',
    [
      options.name ?? unique('Event'),
      options.startsAt ?? '2026-06-01 18:00:00',
      options.endsAt ?? '2026-06-01 23:00:00',
      options.location ?? 'Testort',
    ],
  )
}

export async function createReceipt(options: {
  companyId?: number
  status?: string
  receiptDate?: string
  positions?: Array<{ sphere: number, costCentre: number, amount: number, tax?: number }>
} = {}) {
  const companyId = options.companyId ?? await createCompany()
  const id = await insert(
    'INSERT INTO receipts (company_id, receipt_date, status) VALUES (?, ?, ?)',
    [companyId, options.receiptDate ?? '2026-03-01', options.status ?? 'draft'],
  )
  for (const position of options.positions ?? []) {
    await insert(
      'INSERT INTO receipt_positions (receipt_id, sphere, cost_centre, amount, tax) VALUES (?, ?, ?, ?, ?)',
      [id, position.sphere, position.costCentre, position.amount, position.tax ?? 19],
    )
  }
  return id
}
