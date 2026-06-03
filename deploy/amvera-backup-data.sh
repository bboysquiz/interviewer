#!/usr/bin/env bash

set -euo pipefail

node --input-type=module - <<'NODE'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import Database from 'better-sqlite3'

const databasePath = process.env.DATABASE_PATH?.trim() || '/data/app.db'
const uploadsDir = process.env.UPLOADS_DIR?.trim() || '/data/uploads'
const backupRoot = process.env.BACKUP_ROOT?.trim() || '/data/backups'
const backupName = `pre-update-${new Date()
  .toISOString()
  .replace(/[:.]/g, '-')
  .replace('T', '_')
  .replace('Z', '')}`
const backupDir = path.join(backupRoot, backupName)
const backupDbPath = path.join(backupDir, 'app.db')
const backupUploadsDir = path.join(backupDir, 'uploads')
const manifestPath = path.join(backupDir, 'manifest.json')
const archivePath = `${backupDir}.tar.gz`

const fail = (message) => {
  throw new Error(message)
}

const sha256File = (filePath) => {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
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
    } else if (item.isFile()) {
      fs.copyFileSync(sourcePath, targetPath)
    }
  }
}

const collectFiles = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    return []
  }

  return fs.readdirSync(dirPath, { withFileTypes: true }).flatMap((item) => {
    const itemPath = path.join(dirPath, item.name)
    if (item.isDirectory()) {
      return collectFiles(itemPath)
    }
    return item.isFile() ? [itemPath] : []
  })
}

const tableExists = (db, tableName) =>
  Boolean(
    db
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name = ?
          LIMIT 1
        `,
      )
      .get(tableName),
  )

const countTable = (db, tableName) =>
  tableExists(db, tableName)
    ? db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count
    : null

const summarizeDatabase = (dbPath) => {
  const db = new Database(dbPath, { readonly: true })
  try {
    return {
      integrity: db.prepare('PRAGMA integrity_check').all(),
      counts: {
        users: countTable(db, 'users'),
        categories: countTable(db, 'categories'),
        notes: countTable(db, 'notes'),
        attachments: countTable(db, 'attachments'),
        noteChunks: countTable(db, 'note_chunks'),
        interviewSessions: countTable(db, 'interview_sessions'),
        interviewQuestions: countTable(db, 'interview_questions'),
        interviewEvaluations: countTable(db, 'interview_answer_evaluations'),
        aiUsageEvents: countTable(db, 'ai_usage_events'),
      },
      users: tableExists(db, 'users')
        ? db
            .prepare(
              `
                SELECT id, username
                FROM users
                ORDER BY created_at ASC
              `,
            )
            .all()
        : [],
      attachmentStatuses: tableExists(db, 'attachments')
        ? db
            .prepare(
              `
                SELECT processing_status AS status, COUNT(*) AS count
                FROM attachments
                GROUP BY processing_status
                ORDER BY count DESC
              `,
            )
            .all()
        : [],
      imageAnalysisEvents: tableExists(db, 'ai_usage_events')
        ? db
            .prepare(
              `
                SELECT status, COUNT(*) AS count
                FROM ai_usage_events
                WHERE task = 'image_analysis'
                GROUP BY status
                ORDER BY count DESC
              `,
            )
            .all()
        : [],
    }
  } finally {
    db.close()
  }
}

if (!fs.existsSync(databasePath)) {
  fail(`SQLite database not found: ${databasePath}`)
}

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
const dbStat = fs.statSync(backupDbPath)
const dbSummary = summarizeDatabase(backupDbPath)

const manifest = {
  backupName,
  createdAt: new Date().toISOString(),
  source: { databasePath, uploadsDir },
  backup: {
    directory: backupDir,
    databasePath: backupDbPath,
    uploadsDir: backupUploadsDir,
  },
  database: {
    bytes: dbStat.size,
    sha256: sha256File(backupDbPath),
    ...dbSummary,
  },
  uploads: {
    fileCount: uploadFiles.length,
    bytes: uploadBytes,
  },
}

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const tar = spawnSync(
  'tar',
  ['-czf', archivePath, '-C', backupRoot, backupName],
  { encoding: 'utf8' },
)
const archive =
  tar.status === 0
    ? {
        created: true,
        path: archivePath,
        bytes: fs.statSync(archivePath).size,
        sha256: sha256File(archivePath),
      }
    : {
        created: false,
        reason: (tar.stderr || tar.stdout || 'tar failed').trim(),
      }
const result = { ...manifest, archive }

fs.writeFileSync(manifestPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result, null, 2))
NODE
