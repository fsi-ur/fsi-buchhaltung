import { query } from '~/server/utils/db'
import type { InvoiceTextSettings, InvoiceTextVariable } from '~/types/appSettings'
import { renderInvoiceNumberTemplate } from '~/utils/invoiceTextTemplates'

const INVOICE_TEXT_SETTING_KEYS = {
  invoice_number_template: 'invoice_number_template',
  invoice_number_next_increment: 'invoice_number_next_increment',
  invoice_number_increment_digits: 'invoice_number_increment_digits',
  invoice_number_manual_edit_disabled: 'invoice_number_manual_edit_disabled',
  subject: 'invoice_text_subject',
  intro_text: 'invoice_text_intro_text',
  notes: 'invoice_text_notes',
  is_kleinunternehmer_default: 'invoice_is_kleinunternehmer_default',
} as const

export const DEFAULT_INVOICE_TEXT_SETTINGS: InvoiceTextSettings = {
  invoice_number_template: 'RE-{year}-{increment}',
  invoice_number_next_increment: 1,
  invoice_number_increment_digits: 1,
  invoice_number_manual_edit_disabled: false,
  subject: 'Rechnung {invoice_number}',
  intro_text: 'Für die vereinbarten Leistungen stellen wir Ihnen wie vereinbart den folgenden Betrag in Rechnung:',
  notes: 'Mit freundlichen Grüßen\n{contact_person}',
  is_kleinunternehmer_default: false,
}

export const INVOICE_TEXT_VARIABLES: InvoiceTextVariable[] = [
  { key: 'invoice_number', label: 'Rechnungs-Nr.' },
  { key: 'year', label: 'Jahr des Rechnungsdatums' },
  { key: 'month', label: 'Monat des Rechnungsdatums' },
  { key: 'day', label: 'Tag des Rechnungsdatums' },
  { key: 'date', label: 'Rechnungsdatum' },
  { key: 'increment', label: 'Fortlaufende Nummer' },
  { key: 'association_name', label: 'Verein' },
  { key: 'contact_person', label: 'Ansprechperson' },
  { key: 'recipient_attention', label: 'z. Hd. (Empfänger)' },
  { key: 'service_date', label: 'Leistungsdatum' },
  { key: 'due_date', label: 'Fällig am' },
]

export function normalizeInvoiceTextSettings(input: Partial<InvoiceTextSettings> | null | undefined): InvoiceTextSettings {
  const nextIncrement = Number(input?.invoice_number_next_increment)
  const incrementDigits = Number(input?.invoice_number_increment_digits)
  return {
    invoice_number_template: String(input?.invoice_number_template ?? '').trim() || DEFAULT_INVOICE_TEXT_SETTINGS.invoice_number_template,
    invoice_number_next_increment: Number.isInteger(nextIncrement) && nextIncrement > 0 ? nextIncrement : DEFAULT_INVOICE_TEXT_SETTINGS.invoice_number_next_increment,
    invoice_number_increment_digits: Number.isInteger(incrementDigits) && incrementDigits >= 1 ? incrementDigits : DEFAULT_INVOICE_TEXT_SETTINGS.invoice_number_increment_digits,
    invoice_number_manual_edit_disabled: Boolean(input?.invoice_number_manual_edit_disabled),
    subject: String(input?.subject ?? '').trim() || DEFAULT_INVOICE_TEXT_SETTINGS.subject,
    intro_text: String(input?.intro_text ?? '').trim() || DEFAULT_INVOICE_TEXT_SETTINGS.intro_text,
    notes: String(input?.notes ?? '').trim() || DEFAULT_INVOICE_TEXT_SETTINGS.notes,
    is_kleinunternehmer_default: Boolean(input?.is_kleinunternehmer_default),
  }
}

export async function getInvoiceTextSettings(conn?: any): Promise<InvoiceTextSettings> {
  let rows: Array<{ setting_key: string, setting_value: string | null }> = []
  try {
    rows = await query<Array<{ setting_key: string, setting_value: string | null }>>(
      `SELECT setting_key, setting_value
       FROM app_settings
       WHERE setting_key IN (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        INVOICE_TEXT_SETTING_KEYS.invoice_number_template,
        INVOICE_TEXT_SETTING_KEYS.invoice_number_next_increment,
        INVOICE_TEXT_SETTING_KEYS.invoice_number_increment_digits,
        INVOICE_TEXT_SETTING_KEYS.invoice_number_manual_edit_disabled,
        INVOICE_TEXT_SETTING_KEYS.subject,
        INVOICE_TEXT_SETTING_KEYS.intro_text,
        INVOICE_TEXT_SETTING_KEYS.notes,
        INVOICE_TEXT_SETTING_KEYS.is_kleinunternehmer_default,
      ],
      conn,
    )
  } catch (err: any) {
    if (err?.code !== 'ER_NO_SUCH_TABLE') throw err
    return DEFAULT_INVOICE_TEXT_SETTINGS
  }

  const values = new Map(rows.map(row => [row.setting_key, row.setting_value || '']))
  return normalizeInvoiceTextSettings({
    invoice_number_template: values.get(INVOICE_TEXT_SETTING_KEYS.invoice_number_template),
    invoice_number_next_increment: Number(values.get(INVOICE_TEXT_SETTING_KEYS.invoice_number_next_increment)),
    invoice_number_increment_digits: Number(values.get(INVOICE_TEXT_SETTING_KEYS.invoice_number_increment_digits)),
    invoice_number_manual_edit_disabled: values.get(INVOICE_TEXT_SETTING_KEYS.invoice_number_manual_edit_disabled) === 'true',
    subject: values.get(INVOICE_TEXT_SETTING_KEYS.subject),
    intro_text: values.get(INVOICE_TEXT_SETTING_KEYS.intro_text),
    notes: values.get(INVOICE_TEXT_SETTING_KEYS.notes),
    is_kleinunternehmer_default: values.get(INVOICE_TEXT_SETTING_KEYS.is_kleinunternehmer_default) === 'true',
  })
}

export async function saveInvoiceTextSettings(settings: Partial<InvoiceTextSettings>, conn?: any) {
  const normalized = normalizeInvoiceTextSettings(settings)

  await query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?), (?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
    [
      INVOICE_TEXT_SETTING_KEYS.invoice_number_template,
      normalized.invoice_number_template,
      INVOICE_TEXT_SETTING_KEYS.invoice_number_next_increment,
      String(normalized.invoice_number_next_increment),
      INVOICE_TEXT_SETTING_KEYS.invoice_number_increment_digits,
      String(normalized.invoice_number_increment_digits),
      INVOICE_TEXT_SETTING_KEYS.invoice_number_manual_edit_disabled,
      String(normalized.invoice_number_manual_edit_disabled),
      INVOICE_TEXT_SETTING_KEYS.subject,
      normalized.subject,
      INVOICE_TEXT_SETTING_KEYS.intro_text,
      normalized.intro_text,
      INVOICE_TEXT_SETTING_KEYS.notes,
      normalized.notes,
      INVOICE_TEXT_SETTING_KEYS.is_kleinunternehmer_default,
      String(normalized.is_kleinunternehmer_default),
    ],
    conn,
  )

  return normalized
}

export async function reserveNextDefaultInvoiceNumber(invoiceDate: string, conn?: any) {
  const rows = await query<Array<{ setting_key: string, setting_value: string | null }>>(
    `SELECT setting_key, setting_value
     FROM app_settings
     WHERE setting_key IN (?, ?, ?)
     FOR UPDATE`,
    [
      INVOICE_TEXT_SETTING_KEYS.invoice_number_template,
      INVOICE_TEXT_SETTING_KEYS.invoice_number_next_increment,
      INVOICE_TEXT_SETTING_KEYS.invoice_number_increment_digits,
    ],
    conn,
  )

  const values = new Map(rows.map(row => [row.setting_key, row.setting_value || '']))
  const template = String(values.get(INVOICE_TEXT_SETTING_KEYS.invoice_number_template) || DEFAULT_INVOICE_TEXT_SETTINGS.invoice_number_template)
  let incrementDigits = Number(values.get(INVOICE_TEXT_SETTING_KEYS.invoice_number_increment_digits) || DEFAULT_INVOICE_TEXT_SETTINGS.invoice_number_increment_digits)
  if (!Number.isInteger(incrementDigits) || incrementDigits < 1) incrementDigits = DEFAULT_INVOICE_TEXT_SETTINGS.invoice_number_increment_digits
  let increment = Number(values.get(INVOICE_TEXT_SETTING_KEYS.invoice_number_next_increment) || DEFAULT_INVOICE_TEXT_SETTINGS.invoice_number_next_increment)
  if (!Number.isInteger(increment) || increment < 1) increment = DEFAULT_INVOICE_TEXT_SETTINGS.invoice_number_next_increment

  for (let attempts = 0; attempts < 1000; attempts += 1) {
    const invoiceNumber = renderInvoiceNumberTemplate(template, invoiceDate, increment, incrementDigits).trim()
    const existing = await query<Array<{ id: number }>>(
      `SELECT id
       FROM invoices
       WHERE invoice_number = ?
       LIMIT 1`,
      [invoiceNumber],
      conn,
    )

    if (!existing.length) {
      await query(
        `INSERT INTO app_settings (setting_key, setting_value)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [
          INVOICE_TEXT_SETTING_KEYS.invoice_number_next_increment,
          String(increment + 1),
        ],
        conn,
      )

      return invoiceNumber
    }

    increment += 1
  }

  throw new Error('Failed to reserve a unique default invoice number')
}
