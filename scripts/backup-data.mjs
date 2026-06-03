import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import Database from 'better-sqlite3'

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const hasPersistentDataMount = fs.existsSync('/data')

const defaultDatabasePath = hasPersistentDataMount
  ? '/data/app.db'
  : path.join(repoRoot, 'server', 'data', 'app.db')
const defaultUploadsDir = hasPersistentDataMount
  ? '/data/uploads'
  : path.join(repoRoot, 'server', 'uploads')
const defaultBackupRoot = hasPersistentDataMount
  ? '/data/backups'
  : path.join(repoRoot, 'server', 'data', 'backups')

const databasePath = process.env.DATABASE_PATH?.trim() || defaultDatabasePath
const uploadsDir = process.env.UPLOADS_DIR?.trim() || defaultUploadsDir
const backupRoot = process.env.BACKUP_ROOT?.trim() || defaultBackupRoot

const toSafeTimestamp = (date) =>
  date
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '')

const backupName = `manual-${toSafeTimestamp(new Date())}`
const backupDir = path.join(backupRoot, backupName)
const backupDbPath = path.join(backupDir, 'app.db')
const backupUploadsDir = path.join(backupDir, 'uploads')
const manifestPath = path.join(backupDir, 'manifest.json')
const archivePath = `${backupDir}.tar.gz`

const assertInside = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child))

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside backup root: ${child}`)
  }
}

const ensureReadableFile = (filePath, label) => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} was not found: ${filePath}`)
  }

  const stat = fs.statSync(filePath)

  if (!stat.isFile()) {
    throw new Error(`${label} is not a file: ${filePath}`)
  }
}

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256')
  const stream = fs.readFileSync(filePath)
  hash.update(stream)
  return hash.digest('hex')
}

const copyDirectory = (sourceDir, targetDir) => {
  fs.mkdirSync(targetDir, { recursive: true })

  if (!fs.existsSync(sourceDir)) {
    return
  }

  for (const item of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, item.name)
    const targetPath = path.join(targetDir, item.name)

    if (item.isDirectory()) {
      copyDirectory(sourcePath, targetPath)
      continue
    }

    if (item.isFile()) {
      fs.copyFileSync(sourcePath, targetPath)
    }
  }
}

const collectFiles = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    return []
  }

  const files = []

  for (const item of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const itemPath = path.join(dirPath, item.name)

    if (item.isDirectory()) {
      files.push(...collectFiles(itemPath))
      continue
    }

    if (item.isFile()) {
      files.push(itemPath)
    }
  }

  return files
}

const getTableCount = (db, tableName) => {
  const table = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        LIMIT 1
      `,
    )
    .get(tableName)

  if (!table) {
    return null
  }

  return db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count
}

const summarizeDatabase = (dbPath) => {
  const db = new Database(dbPath, { readonly: true })

  try {
    const integrity = db.prepare('PRAGMA integrity_check').all()
    const userRows = getTableCount(db, 'users') === null
      ? []
      : db
          .prepare(
            `
              SELECT id, username
              FROM users
              ORDER BY created_at ASC
            `,
          )
          .all()

    return {
      integrity,
      counts: {
        users: getTableCount(db, 'users'),
        categories: getTableCount(db, 'categories'),
        notes: getTableCount(db, 'notes'),
        attachments: getTableCount(db, 'attachments'),
        noteChunks: getTableCount(db, 'note_chunks'),
        interviewSessions: getTableCount(db, 'interview_sessions'),
        interviewQuestions: getTableCount(db, 'interview_questions'),
        interviewEvaluations: getTableCount(db, 'interview_answer_evaluations'),
        aiUsageEvents: getTableCount(db, 'ai_usage_events'),
      },
      users: userRows,
      attachmentStatuses:
        getTableCount(db, 'attachments') === null
          ? []
          : db
              .prepare(
                `
                  SELECT processing_status AS status, COUNT(*) AS count
                  FROM attachments
                  GROUP BY processing_status
                  ORDER BY count DESC
                `,
              )
              .all(),
      imageAnalysisEvents:
        getTableCount(db, 'ai_usage_events') === null
          ? []
          : db
              .prepare(
                `
                  SELECT status, COUNT(*) AS count
                  FROM ai_usage_events
                  WHERE task = 'image_analysis'
                  GROUP BY status
                  ORDER BY count DESC
                `,
              )
              .all(),
    }
  } finally {
    db.close()
  }
}

const createArchive = () => {
  const result = spawnSync(
    'tar',
    ['-czf', archivePath, '-C', backupRoot, backupName],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  )

  if (result.status !== 0) {
    return {
      created: false,
      reason: (result.stderr || result.stdout || 'tar failed').trim(),
    }
  }

  return {
    created: true,
    path: archivePath,
    bytes: fs.statSync(archivePath).size,
    sha256: sha256File(archivePath),
  }
}

assertInside(backupRoot, backupDir)
ensureReadableFile(databasePath, 'SQLite database')
fs.mkdirSync(backupDir, { recursive: true })

const sourceDb = new Database(databasePath, { readonly: true })

try {
  await sourceDb.backup(backupDbPath)
} finally {
  sourceDb.close()
}

copyDirectory(uploadsDir, backupUploadsDir)

const uploadFiles = collectFiles(backupUploadsDir)
const uploadBytes = uploadFiles.reduce(
  (total, filePath) => total + fs.statSync(filePath).size,
  0,
)
const databaseSummary = summarizeDatabase(backupDbPath)
const databaseStat = fs.statSync(backupDbPath)

const manifest = {
  backupName,
  createdAt: new Date().toISOString(),
  source: {
    databasePath,
    uploadsDir,
  },
  backup: {
    directory: backupDir,
    databasePath: backupDbPath,
    uploadsDir: backupUploadsDir,
  },
  database: {
    bytes: databaseStat.size,
    sha256: sha256File(backupDbPath),
    ...databaseSummary,
  },
  uploads: {
    fileCount: uploadFiles.length,
    bytes: uploadBytes,
  },
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const archive = createArchive()
const finalManifest = {
  ...manifest,
  archive,
}

fs.writeFileSync(manifestPath, `${JSON.stringify(finalManifest, null, 2)}\n`)

console.log(JSON.stringify(finalManifest, null, 2))
