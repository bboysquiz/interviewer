import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const serverRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = path.resolve(serverRoot, '..')
const rootEnvPath = path.join(repoRoot, '.env')
const serverEnvPath = path.join(serverRoot, '.env')

const loadEnvFile = (filePath: string, override = false): void => {
  if (!fs.existsSync(filePath)) {
    return
  }

  dotenv.config({
    path: filePath,
    override,
  })
}

loadEnvFile(rootEnvPath)
loadEnvFile(serverEnvPath, true)

const isAmvera = Boolean(process.env.AMVERA)

const normalizeAiProvider = (
  value: string | undefined,
  fallback: 'gemini' | 'groq',
): 'gemini' | 'groq' => {
  if (value === 'gemini' || value === 'groq') {
    return value
  }

  return fallback
}

const parseListEnv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const parsePositiveIntEnv = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(value ?? '', 10)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

export const SERVER_ROOT = serverRoot
export const SERVER_HOST = process.env.HOST?.trim() || '0.0.0.0'
export const SERVER_PORT = Number(process.env.PORT ?? 3000)
export const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:5173'
export const DATABASE_PATH =
  process.env.DATABASE_PATH ??
  (isAmvera ? '/data/app.db' : path.join(SERVER_ROOT, 'data', 'app.db'))
export const UPLOADS_DIR =
  process.env.UPLOADS_DIR ??
  (isAmvera ? '/data/uploads' : path.join(SERVER_ROOT, 'uploads'))
export const SCHEMA_PATH = path.join(SERVER_ROOT, 'schema.sql')
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? ''
export const OPENAI_IMAGE_ANALYSIS_MODEL =
  process.env.OPENAI_IMAGE_ANALYSIS_MODEL ?? 'gpt-4.1-mini'
export const OPENAI_INTERVIEW_QUESTION_MODEL =
  process.env.OPENAI_INTERVIEW_QUESTION_MODEL ?? 'gpt-4.1-mini'
export const OPENAI_INTERVIEW_EVALUATION_MODEL =
  process.env.OPENAI_INTERVIEW_EVALUATION_MODEL ?? 'gpt-4.1-mini'
export const AI_PRIMARY_PROVIDER = normalizeAiProvider(
  process.env.AI_PRIMARY_PROVIDER,
  'gemini',
)
export const AI_FALLBACK_PROVIDER = normalizeAiProvider(
  process.env.AI_FALLBACK_PROVIDER,
  'groq',
)
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? ''
export const GEMINI_DOH_URL = process.env.GEMINI_DOH_URL?.trim() ?? ''
export const GEMINI_DNS_SERVERS = parseListEnv(process.env.GEMINI_DNS_SERVERS)
export const GEMINI_VISION_MODEL =
  process.env.GEMINI_VISION_MODEL ?? 'gemini-2.5-flash'
export const GEMINI_INTERVIEW_QUESTION_MODEL =
  process.env.GEMINI_INTERVIEW_QUESTION_MODEL ?? 'gemini-2.5-flash'
export const GEMINI_INTERVIEW_EVALUATION_MODEL =
  process.env.GEMINI_INTERVIEW_EVALUATION_MODEL ?? 'gemini-2.5-flash'
export const GROQ_API_KEY = process.env.GROQ_API_KEY ?? ''
export const GROQ_VISION_MODEL =
  process.env.GROQ_VISION_MODEL ?? 'meta-llama/llama-4-scout-17b-16e-instruct'
export const GROQ_INTERVIEW_QUESTION_MODEL =
  process.env.GROQ_INTERVIEW_QUESTION_MODEL ?? 'openai/gpt-oss-20b'
export const GROQ_INTERVIEW_EVALUATION_MODEL =
  process.env.GROQ_INTERVIEW_EVALUATION_MODEL ?? 'openai/gpt-oss-20b'
export const OPENAI_INTERVIEW_CONTEXT_MAX_CHARS = Number(
  process.env.OPENAI_INTERVIEW_CONTEXT_MAX_CHARS ?? 12000,
)
export const AI_ANALYTICS_WINDOW_HOURS = parsePositiveIntEnv(
  process.env.AI_ANALYTICS_WINDOW_HOURS,
  24,
)
export const AI_ANALYTICS_GEMINI_TEXT_REQUEST_LIMIT = parsePositiveIntEnv(
  process.env.AI_ANALYTICS_GEMINI_TEXT_REQUEST_LIMIT,
  20,
)
export const AI_ANALYTICS_GEMINI_IMAGE_REQUEST_LIMIT = parsePositiveIntEnv(
  process.env.AI_ANALYTICS_GEMINI_IMAGE_REQUEST_LIMIT,
  20,
)
export const AI_ANALYTICS_GROQ_TEXT_REQUEST_LIMIT = parsePositiveIntEnv(
  process.env.AI_ANALYTICS_GROQ_TEXT_REQUEST_LIMIT,
  1000,
)
export const AI_ANALYTICS_GROQ_IMAGE_REQUEST_LIMIT = parsePositiveIntEnv(
  process.env.AI_ANALYTICS_GROQ_IMAGE_REQUEST_LIMIT,
  1000,
)
