import type { ViewCell, ViewTone, ViewValue, ViewValueFormat } from '~/shared/cashRegisterView'

// Display helpers for the kassensystem's overview view (shared/cashRegisterView.ts).
// Tailwind only sees literal class names, hence the lookup tables.

export const VIEW_TONE_TEXT: Record<ViewTone, string> = {
  default: 'text-base-800',
  muted: 'text-base-500',
  accent: 'text-accent-600',
  info: 'text-info-700',
  success: 'text-success-600',
  warning: 'text-warning-700',
  danger: 'text-danger-600',
}

export const VIEW_TONE_ICON: Record<ViewTone, string> = {
  default: 'bg-accent-50 text-accent-600',
  muted: 'bg-base-100 text-base-500',
  accent: 'bg-accent-50 text-accent-600',
  info: 'bg-info-50 text-info-600',
  success: 'bg-success-50 text-success-600',
  warning: 'bg-warning-50 text-warning-600',
  danger: 'bg-danger-50 text-danger-600',
}

export const VIEW_TONE_ALERT: Record<ViewTone, string> = {
  default: 'border-base-200 bg-white text-base-800',
  muted: 'border-base-200 bg-base-50 text-base-700',
  accent: 'border-accent-200 bg-accent-50 text-accent-900',
  info: 'border-info-200 bg-info-50 text-info-900',
  success: 'border-success-200 bg-success-50 text-success-900',
  warning: 'border-warning-200 bg-warning-50 text-warning-900',
  danger: 'border-danger-200 bg-danger-50 text-danger-900',
}

export const VIEW_TONE_BADGE: Record<ViewTone, 'base' | 'warning' | 'success' | 'danger' | 'baseMuted'> = {
  default: 'base',
  muted: 'baseMuted',
  accent: 'base',
  info: 'base',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
}

export function toViewValue(cell: ViewCell): ViewValue {
  if (cell === null) return { value: null }
  if (typeof cell === 'string') return { value: cell, format: 'text' }
  if (typeof cell === 'number') return { value: cell, format: 'number' }
  return cell
}

export function formatViewNumber(value: number, format: ViewValueFormat | undefined, locale: string) {
  switch (format) {
    case 'currency':
    case 'signedCurrency':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
        signDisplay: format === 'signedCurrency' ? 'exceptZero' : 'auto',
      }).format(value)
    case 'percent':
      return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)
    case 'signedNumber':
      return new Intl.NumberFormat(locale, { signDisplay: 'exceptZero', maximumFractionDigits: 2 }).format(value)
    default:
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
  }
}

/** The cell as display text (without tone). Empty cells render as an empty string. */
export function formatViewCell(cell: ViewCell, locale: string) {
  const value = toViewValue(cell)
  if (value.value === null || value.value === '') return ''

  const text = typeof value.value === 'number' && value.format !== 'text'
    ? formatViewNumber(value.value, value.format, locale)
    : String(value.value)

  return [value.prefix, text].join('') + (value.suffix ? ` ${value.suffix}` : '')
}
