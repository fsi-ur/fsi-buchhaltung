import { defineEventHandler, setResponseHeaders } from 'h3'
import { securityHeaders } from '~/server/utils/securityHeaders'

const headers = securityHeaders()

export default defineEventHandler((event) => {
  setResponseHeaders(event, headers)
})
