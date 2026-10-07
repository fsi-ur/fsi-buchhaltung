export enum InvoiceStatus {
  Draft = 'draft',
  Open = 'open',
  Paid = 'paid',
  Cancelled = 'cancelled',
}

export enum InvoiceSourceType {
  Upload = 'upload',
  Generated = 'generated',
}

export interface InvoicePosition {
  id: number
  name: string
  description: string | null
  sphere: number
  cost_centre: number
  quantity: number
  unit: string | null
  unit_price: number
  tax: number
}

export interface Invoice {
  id: number
  company_id: number
  company_name: string | null
  source_type: InvoiceSourceType
  is_kleinunternehmer: boolean
  invoice_date: string
  due_date: string
  paid_at: string | null
  contact_person: string | null
  recipient_attention: string | null
  service_date: string | null
  invoice_number: string
  subject: string | null
  intro_text: string | null
  notes: string | null
  status: InvoiceStatus
  positions: InvoicePosition[]
}

export interface InvoiceRow {
  id: number
  company_id: number
  company_name: string | null
  source_type: InvoiceSourceType
  is_kleinunternehmer: boolean
  invoice_date: string
  due_date: string
  paid_at: string | null
  contact_person: string | null
  recipient_attention: string | null
  service_date: string | null
  invoice_number: string
  subject: string | null
  notes: string | null
  status: InvoiceStatus
  total_amount: number
}

export interface CreateInvoicePositionBody {
  id?: number
  name: string
  description: string | null
  sphere: number
  cost_centre: number
  quantity: number
  unit: string | null
  unit_price: number
  tax: number
}

export interface CreateInvoiceBody {
  company_id: number | null
  source_type: InvoiceSourceType
  is_kleinunternehmer: boolean
  invoice_date: string
  due_date: string
  paid_at: string | null
  contact_person: string | null
  recipient_attention: string | null
  service_date: string | null
  invoice_number: string
  subject: string | null
  intro_text: string | null
  notes: string | null
  status: InvoiceStatus
  positions: CreateInvoicePositionBody[]
}
