import type { InvoiceTextSettings } from '~/types/appSettings'

export interface InvoiceTextTemplateContext {
  invoice_number?: string | null
  year?: string | null
  month?: string | null
  day?: string | null
  date?: string | null
  invoice_date_year?: string | null
  invoice_date_month?: string | null
  invoice_date_day?: string | null
  association_name?: string | null
  contact_person?: string | null
  recipient_attention?: string | null
  invoice_date?: string | null
  service_date?: string | null
  due_date?: string | null
}

function formatIncrement(increment: number, digits = 1) {
  const normalizedIncrement = Number.isInteger(increment) && increment > 0 ? increment : 1
  const normalizedDigits = Number.isInteger(digits) && digits > 0 ? digits : 1
  return String(normalizedIncrement).padStart(normalizedDigits, '0')
}

export function formatInvoiceTemplateDate(value: string | null | undefined) {
  if (!value) return ''
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return String(value)
  return `${match[3]}.${match[2]}.${match[1]}`
}

function invoiceDateParts(value: string | null | undefined) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return {
    year: match?.[1] ?? '',
    month: match?.[2] ?? '',
    day: match?.[3] ?? '',
  }
}

export function renderInvoiceTextTemplate(template: string, context: InvoiceTextTemplateContext) {
  const invoiceDatePartsValue = invoiceDateParts(context.invoice_date)
  const values: Record<string, string> = {
    invoice_number: context.invoice_number?.trim() || '',
    year: context.year?.trim() || invoiceDatePartsValue.year,
    month: context.month?.trim() || invoiceDatePartsValue.month,
    day: context.day?.trim() || invoiceDatePartsValue.day,
    date: context.date?.trim() || formatInvoiceTemplateDate(context.invoice_date),
    invoice_date_year: context.invoice_date_year?.trim() || invoiceDatePartsValue.year,
    invoice_date_month: context.invoice_date_month?.trim() || invoiceDatePartsValue.month,
    invoice_date_day: context.invoice_date_day?.trim() || invoiceDatePartsValue.day,
    association_name: context.association_name?.trim() || '',
    contact_person: context.contact_person?.trim() || context.association_name?.trim() || '',
    recipient_attention: context.recipient_attention?.trim() || '',
    invoice_date: formatInvoiceTemplateDate(context.invoice_date),
    service_date: formatInvoiceTemplateDate(context.service_date || context.invoice_date),
    due_date: formatInvoiceTemplateDate(context.due_date),
  }

  return String(template || '').replace(/\{\{\s*([a-z_]+)\s*\}\}|\{\s*([a-z_]+)\s*\}/g, (match, doubleBraceKey, singleBraceKey) => {
    const key = String(doubleBraceKey || singleBraceKey || '')
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key]! : match
  })
}

export function renderInvoiceNumberTemplate(template: string, invoiceDate: string | null | undefined, increment: number, incrementDigits = 1) {
  const invoiceDatePartsValue = invoiceDateParts(invoiceDate)
  const formattedIncrement = formatIncrement(increment, incrementDigits)
  return renderInvoiceTextTemplate(template, {
    invoice_date: invoiceDate,
    year: invoiceDatePartsValue.year,
    month: invoiceDatePartsValue.month,
    day: invoiceDatePartsValue.day,
    date: formatInvoiceTemplateDate(invoiceDate),
    invoice_date_year: invoiceDatePartsValue.year,
    invoice_date_month: invoiceDatePartsValue.month,
    invoice_date_day: invoiceDatePartsValue.day,
    invoice_number: formattedIncrement,
  }).replace(/\{\{\s*increment\s*\}\}|\{\s*increment\s*\}/g, formattedIncrement)
}

export function renderInvoiceTextSettings(settings: InvoiceTextSettings, context: InvoiceTextTemplateContext): InvoiceTextSettings {
  return {
    invoice_number_template: settings.invoice_number_template,
    invoice_number_next_increment: settings.invoice_number_next_increment,
    invoice_number_increment_digits: settings.invoice_number_increment_digits,
    invoice_number_manual_edit_disabled: settings.invoice_number_manual_edit_disabled,
    subject: renderInvoiceTextTemplate(settings.subject, context),
    intro_text: renderInvoiceTextTemplate(settings.intro_text, context),
    notes: renderInvoiceTextTemplate(settings.notes, context),
    is_kleinunternehmer_default: settings.is_kleinunternehmer_default,
  }
}
