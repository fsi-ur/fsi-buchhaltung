import type { PdfColor } from '~/server/utils/pdf'

export const PDF_COLORS = {
  accent: [0.761, 0.255, 0.047] as PdfColor,
  accentTint: [1, 0.929, 0.835] as PdfColor,
  accentWash: [1, 0.969, 0.929] as PdfColor,
  positive: [0.016, 0.471, 0.341] as PdfColor,
  positiveWash: [0.925, 0.992, 0.961] as PdfColor,
  negative: [0.725, 0.11, 0.11] as PdfColor,
  warning: [0.706, 0.325, 0.035] as PdfColor,
  warningWash: [0.996, 0.953, 0.78] as PdfColor,
  neutral: [0.392, 0.455, 0.545] as PdfColor,
  neutralWash: [0.945, 0.961, 0.976] as PdfColor,
} as const
