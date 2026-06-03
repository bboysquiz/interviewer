import type { Request, RequestHandler, Response, Router } from 'express'
import { Router as createRouter } from 'express'

import {
  AUTH_SESSION_COOKIE_NAME,
  AUTH_SESSION_TTL_DAYS,
} from './config.js'
import { seedDefaultCategoriesForUser, type SqliteDatabase } from './db.js'
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  normalizeUsername,
  verifyPassword,
} from './lib/auth.js'
import { coerceString, createId, nowIso } from './lib/text.js'

declare global {
  namespace Express {
    interface Request {
      authUser: AuthUser | null
    }
  }
}

export interface AuthUser {
  id: string
  username: string
}

interface UserRow {
  id: string
  username: string
  password_hash: string
}

interface SessionLookupRow {
  session_id: string
  user_id: string
  username: string
  expires_at: string
}

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/i

const parseCookies = (
  cookieHeader: string | undefined,
): Record<string, string> => {
  if (!cookieHeader?.trim()) {
    return {}
  }

  const pairs = cookieHeader.split(';')
  const cookies: Record<string, string> = {}

  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=')

    if (separatorIndex <= 0) {
      continue
    }

    const key = pair.slice(0, separatorIndex).trim()
    const value = pair.slice(separatorIndex + 1).trim()

    if (key) {
      cookies[key] = decodeURIComponent(value)
    }
  }

  return cookies
}

const shouldUseSecureCookies = (request: Request): boolean => {
  const forwardedProto = request
    .header('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()

  return request.secure || forwardedProto === 'https'
}

const serializeSessionCookie = (
  request: Request,
  token: string,
  maxAgeSeconds: number,
): string => {
  const attributes = [
    `${AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]

  if (shouldUseSecureCookies(request)) {
    attributes.push('Secure')
  }

  return attributes.join('; ')
}

const serializeExpiredSessionCookie = (request: Request): string => {
  const attributes = [
    `${AUTH_SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ]

  if (shouldUseSecureCookies(request)) {
    attributes.push('Secure')
  }

  return attributes.join('; ')
}

const validateUsername = (value: string): string | null => {
  const normalized = normalizeUsername(value)

  if (!normalized) {
    return 'Укажи имя пользователя.'
  }

  if (!USERNAME_PATTERN.test(normalized)) {
    return 'Имя пользователя может содержать только латинские буквы, цифры, точку, дефис и подчёркивание.'
  }

  return null
}

const validatePassword = (value: string): string | null => {
  if (value.trim().length < 8) {
    return 'Пароль должен содержать минимум 8 символов.'
  }

  return null
}

const getSessionTtlMs = (): number =>
  AUTH_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000

const getSessionTtlSeconds = (): number =>
  AUTH_SESSION_TTL_DAYS * 24 * 60 * 60

const lookupSession = (
  db: SqliteDatabase,
  token: string | null,
): SessionLookupRow | null => {
  if (!token) {
    return null
  }

  const row = db
    .prepare(
      `
        SELECT
          s.id AS session_id,
          u.id AS user_id,
          u.username,
          s.expires_at
        FROM auth_sessions s
        INNER JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
        LIMIT 1
      `,
    )
    .get(hashSessionToken(token)) as SessionLookupRow | undefined

  if (!row) {
    return null
  }

  if (Date.parse(row.expires_at) <= Date.now()) {
    db.prepare('DELETE FROM auth_sessions WHERE id = ?').run(row.session_id)
    return null
  }

  const timestamp = nowIso()
  db.prepare(
    `
      UPDATE auth_sessions
      SET last_seen_at = ?, updated_at = ?
      WHERE id = ?
    `,
  ).run(timestamp, timestamp, row.session_id)

  return row
}

const readSessionUser = (
  db: SqliteDatabase,
  request: Request,
): AuthUser | null => {
  const cookies = parseCookies(request.headers.cookie)
  const sessionToken = cookies[AUTH_SESSION_COOKIE_NAME] ?? null
  const session = lookupSession(db, sessionToken)

  if (!session) {
    return null
  }

  return {
    id: session.user_id,
    username: session.username,
  }
}

const attachSession = (
  db: SqliteDatabase,
  request: Request,
  response: Response,
  user: AuthUser,
): void => {
  const token = createSessionToken()
  const timestamp = nowIso()
  const expiresAt = new Date(Date.now() + getSessionTtlMs()).toISOString()

  db.prepare(
    `
      INSERT INTO auth_sessions (
        id,
        user_id,
        token_hash,
        expires_at,
        last_seen_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    createId(),
    user.id,
    hashSessionToken(token),
    expiresAt,
    timestamp,
    timestamp,
    timestamp,
  )

  response.setHeader(
    'Set-Cookie',
    serializeSessionCookie(request, token, getSessionTtlSeconds()),
  )
}

const clearSession = (
  db: SqliteDatabase,
  request: Request,
  response: Response,
): void => {
  const cookies = parseCookies(request.headers.cookie)
  const sessionToken = cookies[AUTH_SESSION_COOKIE_NAME] ?? null

  if (sessionToken) {
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(
      hashSessionToken(sessionToken),
    )
  }

  response.setHeader('Set-Cookie', serializeExpiredSessionCookie(request))
}

export const createAuthRouter = (db: SqliteDatabase): Router => {
  const router = createRouter()

  const userByUsernameStatement = db.prepare(
    `
      SELECT id, username, password_hash
      FROM users
      WHERE username = ?
      LIMIT 1
    `,
  )

  router.get('/me', (request, response) => {
    const user = readSessionUser(db, request)

    if (!user) {
      response.status(401).json({
        message: 'Сессия не найдена. Войди в аккаунт снова.',
        code: 'auth_unauthorized',
      })
      return
    }

    response.json({ user })
  })

  router.post('/register', (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const username = normalizeUsername(coerceString(body.username))
    const password = coerceString(body.password)

    const usernameError = validateUsername(username)
    if (usernameError) {
      response.status(400).json({
        message: usernameError,
        code: 'auth_validation_error',
      })
      return
    }

    const passwordError = validatePassword(password)
    if (passwordError) {
      response.status(400).json({
        message: passwordError,
        code: 'auth_validation_error',
      })
      return
    }

    const existingUser = userByUsernameStatement.get(username) as
      | UserRow
      | undefined

    if (existingUser) {
      response.status(409).json({
        message: 'Пользователь с таким именем уже существует.',
        code: 'auth_conflict',
      })
      return
    }

    const userId = createId()
    const timestamp = nowIso()
    const passwordHash = hashPassword(password)

    db.prepare(
      `
        INSERT INTO users (
          id,
          username,
          password_hash,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
    ).run(userId, username, passwordHash, timestamp, timestamp)
    seedDefaultCategoriesForUser(db, userId)

    const user: AuthUser = {
      id: userId,
      username,
    }

    attachSession(db, request, response, user)
    response.status(201).json({ user })
  })

  router.post('/login', (request, response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const username = normalizeUsername(coerceString(body.username))
    const password = coerceString(body.password)

    const user = userByUsernameStatement.get(username) as UserRow | undefined

    if (!user || !verifyPassword(password, user.password_hash)) {
      response.status(401).json({
        message: 'Неверное имя пользователя или пароль.',
        code: 'auth_invalid_credentials',
      })
      return
    }

    const authUser: AuthUser = {
      id: user.id,
      username: user.username,
    }

    attachSession(db, request, response, authUser)
    response.json({ user: authUser })
  })

  router.post('/logout', (request, response) => {
    clearSession(db, request, response)
    response.status(204).send()
  })

  return router
}

export const createRequireAuthMiddleware = (
  db: SqliteDatabase,
): RequestHandler => (request, response, next) => {
  const user = readSessionUser(db, request)
  request.authUser = user

  if (!user) {
    response.status(401).json({
      message: 'Нужна авторизация.',
      code: 'auth_unauthorized',
    })
    return
  }

  next()
}
