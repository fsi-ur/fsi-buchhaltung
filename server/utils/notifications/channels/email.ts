import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type { NotificationChannel } from '~/server/utils/notifications/types'
import { renderNotificationBodyHtml } from '~/utils/notificationFormatting'

let transporter: Transporter | null | undefined

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter
  if (!process.env.SMTP_HOST) {
    transporter = null
    return transporter
  }
  const port = Number(process.env.SMTP_PORT || 587)
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465

  if (secure !== (port === 465)) {
    console.warn(`notifications email: SMTP_SECURE=${secure} with port ${port} — port 465 needs true, 587/25 need false`)
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  })
  return transporter
}

export const emailChannel: NotificationChannel = {
  key: 'email',
  isConfigured: settings => Boolean(process.env.SMTP_HOST) && settings.channels_enabled.email,
  addressFor: recipient => recipient.email,
  async send({ recipient, rendered, settings, unsubscribeToken, attachments }) {
    const client = getTransporter()
    if (!client) throw new Error('SMTP is not configured')
    if (!recipient.email) throw new Error('Recipient has no e-mail address')

    const fromName = settings.email_from_name || 'FSi'
    let body = rendered.body
    let unsubscribeUrl: string | null = null

    if (unsubscribeToken) {
      const baseUrl = (process.env.APP_BASE_URL || '/').replace(/\/$/, '')
      unsubscribeUrl = `${baseUrl}/api/notifications/unsubscribe?token=${unsubscribeToken}`
      body = `${body}\n\n---\n\nAbmelden: ${unsubscribeUrl}`
    }

    const bodyHtml = renderNotificationBodyHtml(body)

    await client.sendMail({
      from: `"${fromName}" <${process.env.SMTP_FROM || 'noreply@example.com'}>`,
      to: recipient.email,
      subject: rendered.subject,
      text: body,
      html: bodyHtml,
      attachments: attachments?.length
        ? attachments.map(attachment => ({
            filename: attachment.filename,
            content: attachment.content,
            contentType: attachment.contentType,
          }))
        : undefined,
    })
  },
}
