import { beforeEach, describe, expect, it } from 'vitest'
import login from '~/server/api/auth/login.post'
import { loginIpLimiter, loginLockout } from '~/server/utils/rateLimit'
import { resetDatabase } from '../helpers/db'
import { createUser, resetFixtureCounter } from '../helpers/fixtures'
import { callHandler } from '../helpers/handler'

function attempt(username: string, password: string) {
  return callHandler(login, { body: { username, password } })
}

// SEC-04 / SEC-18
describe('login hardening', () => {
  beforeEach(async () => {
    await resetDatabase()
    resetFixtureCounter()
    loginLockout.reset()
    loginIpLimiter.reset()
  })

  it('unknown and inactive users get the same answer as a wrong password', async () => {
    await createUser({ username: 'aktiv', password: 'richtig123' })
    await createUser({ username: 'inaktiv', password: 'richtig123', isActive: false })

    const unknown = await attempt('gibtsnicht', 'falsch')
    const wrong = await attempt('aktiv', 'falsch')
    const inactiveWrong = await attempt('inaktiv', 'falsch')

    for (const call of [unknown, wrong, inactiveWrong]) {
      expect(call.result).toMatchObject({ ok: false, code: 'invalid_credentials' })
    }

    const inactiveRight = await attempt('inaktiv', 'richtig123')
    expect(inactiveRight.result).toMatchObject({ ok: false, code: 'inactive_user' })
  })

  it('locks a username after 5 failures, even for the right password', async () => {
    await createUser({ username: 'ziel', password: 'richtig123' })
    for (let i = 0; i < 5; i += 1) await attempt('ziel', `falsch${i}`)

    const locked = await attempt('Ziel', 'richtig123')
    expect(locked.status).toBe(429)
    expect(locked.result).toMatchObject({ ok: false, code: 'rate_limited' })
  })

  it('a successful login resets the failure count', async () => {
    await createUser({ username: 'ok', password: 'richtig123' })
    for (let i = 0; i < 4; i += 1) await attempt('ok', 'falsch')
    expect((await attempt('ok', 'richtig123')).result.ok).toBe(true)
    for (let i = 0; i < 4; i += 1) await attempt('ok', 'falsch')
    expect((await attempt('ok', 'richtig123')).result.ok).toBe(true)
  })
})
