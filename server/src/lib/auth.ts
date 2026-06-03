import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export const LEGACY_BOOTSTRAP_USERNAME = 'bboysquiz'
export const LEGACY_BOOTSTRAP_PASSWORD_HASH =
  'scrypt$be7eaaf7436abf5130b2cd79f73ff2c4$40736edfdb1aeb801da7976357c6419a48afafe0a0c7511d89e65616d27dc74cfd22dc9d31e5df4b382ff79c2183f92c7ab23d032eef71680d30f44fe51f6901'

const SCRYPT_KEY_LENGTH = 64

export const hashPassword = (password: string): string => {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export const verifyPassword = (
  password: string,
  passwordHash: string,
): boolean => {
  const [algorithm, salt, expectedHash] = passwordHash.split('$')

  if (
    algorithm !== 'scrypt'
    || !salt
    || !expectedHash
    || expectedHash.length % 2 !== 0
  ) {
    return false
  }

  const computedHash = scryptSync(
    password,
    salt,
    expectedHash.length / 2,
  ).toString('hex')

  const expectedBuffer = Buffer.from(expectedHash, 'hex')
  const computedBuffer = Buffer.from(computedHash, 'hex')

  if (expectedBuffer.length !== computedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, computedBuffer)
}

export const createSessionToken = (): string =>
  randomBytes(32).toString('base64url')

export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex')

export const normalizeUsername = (value: string): string =>
  value.trim().toLowerCase()

