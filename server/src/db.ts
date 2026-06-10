import fs from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

import { DATABASE_PATH, SCHEMA_PATH, UPLOADS_DIR } from './config.js'
import {
  LEGACY_BOOTSTRAP_PASSWORD_HASH,
  LEGACY_BOOTSTRAP_USERNAME,
  normalizeUsername,
} from './lib/auth.js'
import { replaceNoteContentChunks } from './lib/chunks.js'
import {
  deriveRawTextFromContentBlocks,
  parseNoteContentBlocks,
  serializeNoteContentBlocks,
  type NoteContentBlock,
} from './lib/noteContent.js'
import { createId, nowIso, slugify } from './lib/text.js'

export type SqliteDatabase = Database.Database

const seedCategories = [
  {
    id: 'javascript',
    slug: 'javascript',
    name: 'JavaScript',
    description: 'Язык, event loop, async-паттерны и ключевые концепции.',
    color: '#f2d06b',
    icon: 'JS',
    sortOrder: 0,
  },
  {
    id: 'vue',
    slug: 'vue',
    name: 'Vue',
    description: 'Composition API, компоненты, reactivity и архитектурные заметки.',
    color: '#6cbf93',
    icon: 'VU',
    sortOrder: 1,
  },
  {
    id: 'git',
    slug: 'git',
    name: 'Git',
    description: 'Команды, ветвление, rebase и сценарии для собеседований.',
    color: '#df8f67',
    icon: 'GT',
    sortOrder: 2,
  },
  {
    id: 'css',
    slug: 'css',
    name: 'CSS',
    description: 'Layout, каскад, адаптивность и типовые UI-задачи.',
    color: '#6fa1d8',
    icon: 'CS',
    sortOrder: 3,
  },
  {
    id: 'html',
    slug: 'html',
    name: 'HTML',
    description: 'Семантика, доступность и структура интерфейсов.',
    color: '#cc785d',
    icon: 'HT',
    sortOrder: 4,
  },
]

const LEGACY_BOOTSTRAP_USER_ID = 'legacy-bboysquiz'
const ownershipTableNames = [
  'categories',
  'notes',
  'attachments',
  'note_chunks',
  'interview_sessions',
  'interview_questions',
  'interview_answer_evaluations',
  'interview_foundation_usage',
  'ai_usage_events',
] as const

const ensureStorage = (): void => {
  fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true })
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

const tableExists = (db: SqliteDatabase, tableName: string): boolean => {
  const row = db
    .prepare(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `,
    )
    .get(tableName) as { name: string } | undefined

  return Boolean(row)
}

const getColumnNames = (
  db: SqliteDatabase,
  tableName: string,
): string[] =>
  (db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>)
    .map((column) => column.name)

const needsMigrationBackup = (): boolean => {
  if (!fs.existsSync(DATABASE_PATH)) {
    return false
  }

  const db = new Database(DATABASE_PATH, { readonly: true })

  try {
    if (!tableExists(db, 'users')) {
      return true
    }

    const bootstrapUser = db
      .prepare(
        `
          SELECT id
          FROM users
          WHERE username = ?
          LIMIT 1
        `,
      )
      .get(normalizeUsername(LEGACY_BOOTSTRAP_USERNAME)) as
      | { id: string }
      | undefined

    if (!bootstrapUser) {
      return true
    }

    for (const tableName of ownershipTableNames) {
      if (!tableExists(db, tableName)) {
        continue
      }

      const columns = getColumnNames(db, tableName)

      if (!columns.includes('user_id')) {
        return true
      }

      const row = db
        .prepare(
          `
            SELECT COUNT(*) AS count
            FROM ${tableName}
            WHERE user_id IS NULL OR TRIM(user_id) = ''
          `,
        )
        .get() as { count: number }

      if (row.count > 0) {
        return true
      }
    }

    return false
  } finally {
    db.close()
  }
}

const backupDatabaseBeforeMigration = (): void => {
  if (!needsMigrationBackup()) {
    return
  }

  const backupDir = path.join(path.dirname(DATABASE_PATH), 'backups')
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '')

  fs.mkdirSync(backupDir, { recursive: true })

  for (const suffix of ['', '-wal', '-shm']) {
    const sourcePath = `${DATABASE_PATH}${suffix}`

    if (!fs.existsSync(sourcePath)) {
      continue
    }

    const backupPath = path.join(
      backupDir,
      `${path.basename(DATABASE_PATH)}${suffix}.${timestamp}.bak`,
    )

    fs.copyFileSync(sourcePath, backupPath)
  }
}

const ensureColumn = (
  db: SqliteDatabase,
  tableName: string,
  columnName: string,
  columnDefinition: string,
): void => {
  const columns = getColumnNames(db, tableName)

  if (!columns.includes(columnName)) {
    db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`,
    )
  }
}

const applySchema = (db: SqliteDatabase): void => {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')
  db.exec(schema)
}

const parseProviderFromModel = (model: string | null): string => {
  const normalized = (model ?? '').trim()

  if (!normalized) {
    return 'unknown'
  }

  const separatorIndex = normalized.indexOf(':')

  if (separatorIndex <= 0) {
    return 'unknown'
  }

  return normalized.slice(0, separatorIndex)
}

const toChannelFromTask = (
  task: 'image_analysis' | 'interview_question_generation' | 'interview_answer_evaluation',
): 'image' | 'text' => (task === 'image_analysis' ? 'image' : 'text')

const runPreSchemaMigrations = (db: SqliteDatabase): void => {
  if (tableExists(db, 'categories')) {
    ensureColumn(db, 'categories', 'user_id', 'TEXT')
  }

  if (tableExists(db, 'notes')) {
    ensureColumn(db, 'notes', 'user_id', 'TEXT')
    ensureColumn(db, 'notes', 'content_json', 'TEXT')
  }

  if (tableExists(db, 'attachments')) {
    ensureColumn(db, 'attachments', 'user_id', 'TEXT')
    ensureColumn(
      db,
      'attachments',
      'key_terms_json',
      "TEXT NOT NULL DEFAULT '[]'",
    )
    ensureColumn(db, 'attachments', 'analysis_model', 'TEXT')
    ensureColumn(db, 'attachments', 'analysis_request_id', 'TEXT')
  }

  if (!tableExists(db, 'note_chunks')) {
    if (tableExists(db, 'interview_sessions')) {
      ensureColumn(db, 'interview_sessions', 'user_id', 'TEXT')
    }

    if (tableExists(db, 'interview_questions')) {
      ensureColumn(db, 'interview_questions', 'user_id', 'TEXT')
    }

    if (tableExists(db, 'interview_answer_evaluations')) {
      ensureColumn(db, 'interview_answer_evaluations', 'user_id', 'TEXT')
    }

    if (tableExists(db, 'interview_foundation_usage')) {
      ensureColumn(db, 'interview_foundation_usage', 'user_id', 'TEXT')
    }

    if (tableExists(db, 'ai_usage_events')) {
      ensureColumn(db, 'ai_usage_events', 'user_id', 'TEXT')
    }

    return
  }

  ensureColumn(db, 'note_chunks', 'user_id', 'TEXT')
  ensureColumn(db, 'note_chunks', 'search_text', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(
    db,
    'note_chunks',
    'embedding_status',
    "TEXT NOT NULL DEFAULT 'pending'",
  )
  ensureColumn(db, 'note_chunks', 'embedding_model', 'TEXT')
  ensureColumn(db, 'note_chunks', 'embedding_updated_at', 'TEXT')
  ensureColumn(db, 'note_chunks', 'embedding_checksum', 'TEXT')

  if (tableExists(db, 'interview_sessions')) {
    ensureColumn(db, 'interview_sessions', 'user_id', 'TEXT')
  }

  if (tableExists(db, 'interview_questions')) {
    ensureColumn(db, 'interview_questions', 'user_id', 'TEXT')
  }

  if (tableExists(db, 'interview_answer_evaluations')) {
    ensureColumn(db, 'interview_answer_evaluations', 'user_id', 'TEXT')
  }

  if (tableExists(db, 'interview_foundation_usage')) {
    ensureColumn(db, 'interview_foundation_usage', 'user_id', 'TEXT')
  }

  if (tableExists(db, 'ai_usage_events')) {
    ensureColumn(db, 'ai_usage_events', 'user_id', 'TEXT')
  }
}

const ensureLegacyBootstrapUser = (db: SqliteDatabase): string => {
  const normalizedUsername = normalizeUsername(LEGACY_BOOTSTRAP_USERNAME)
  const existingUserByUsername = db
    .prepare(
      `
        SELECT id
        FROM users
        WHERE username = ?
        LIMIT 1
      `,
    )
    .get(normalizedUsername) as { id: string } | undefined

  if (existingUserByUsername) {
    return existingUserByUsername.id
  }

  const timestamp = nowIso()
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
  ).run(
    LEGACY_BOOTSTRAP_USER_ID,
    normalizedUsername,
    LEGACY_BOOTSTRAP_PASSWORD_HASH,
    timestamp,
    timestamp,
  )

  return LEGACY_BOOTSTRAP_USER_ID
}

const migrateUserOwnership = (db: SqliteDatabase, legacyUserId: string): void => {
  if (tableExists(db, 'categories')) {
    db.exec(`
      UPDATE categories
      SET user_id = '${legacyUserId}'
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `)
  }

  if (tableExists(db, 'notes')) {
    db.exec(`
      UPDATE notes
      SET user_id = COALESCE(
        user_id,
        (
          SELECT categories.user_id
          FROM categories
          WHERE categories.id = notes.category_id
          LIMIT 1
        ),
        '${legacyUserId}'
      )
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `)
  }

  if (tableExists(db, 'attachments')) {
    db.exec(`
      UPDATE attachments
      SET user_id = COALESCE(
        user_id,
        (
          SELECT notes.user_id
          FROM notes
          WHERE notes.id = attachments.note_id
          LIMIT 1
        ),
        '${legacyUserId}'
      )
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `)
  }

  if (tableExists(db, 'note_chunks')) {
    db.exec(`
      UPDATE note_chunks
      SET user_id = COALESCE(
        user_id,
        (
          SELECT notes.user_id
          FROM notes
          WHERE notes.id = note_chunks.note_id
          LIMIT 1
        ),
        '${legacyUserId}'
      )
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `)
  }

  if (tableExists(db, 'interview_sessions')) {
    db.exec(`
      UPDATE interview_sessions
      SET user_id = '${legacyUserId}'
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `)
  }

  if (tableExists(db, 'interview_questions')) {
    db.exec(`
      UPDATE interview_questions
      SET user_id = COALESCE(
        user_id,
        (
          SELECT interview_sessions.user_id
          FROM interview_sessions
          WHERE interview_sessions.id = interview_questions.session_id
          LIMIT 1
        ),
        '${legacyUserId}'
      )
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `)
  }

  if (tableExists(db, 'interview_answer_evaluations')) {
    db.exec(`
      UPDATE interview_answer_evaluations
      SET user_id = COALESCE(
        user_id,
        (
          SELECT interview_sessions.user_id
          FROM interview_sessions
          WHERE interview_sessions.id = interview_answer_evaluations.session_id
          LIMIT 1
        ),
        '${legacyUserId}'
      )
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `)
  }

  if (tableExists(db, 'interview_foundation_usage')) {
    const rows = db.prepare(
      `
        SELECT foundation_key, user_id
        FROM interview_foundation_usage
      `,
    ).all() as Array<{ foundation_key: string; user_id: string | null }>

    const updateFoundationUsage = db.prepare(
      `
        UPDATE interview_foundation_usage
        SET foundation_key = ?, user_id = ?
        WHERE foundation_key = ?
      `,
    )

    const transaction = db.transaction(() => {
      for (const row of rows) {
        const scopedFoundationKey = row.foundation_key.includes('::')
          ? row.foundation_key
          : `${legacyUserId}::${row.foundation_key}`
        const nextUserId =
          row.user_id && row.user_id.trim().length > 0
            ? row.user_id
            : legacyUserId

        if (
          scopedFoundationKey !== row.foundation_key
          || nextUserId !== row.user_id
        ) {
          updateFoundationUsage.run(
            scopedFoundationKey,
            nextUserId,
            row.foundation_key,
          )
        }
      }
    })

    transaction()
  }

  if (tableExists(db, 'ai_usage_events')) {
    db.exec(`
      UPDATE ai_usage_events
      SET user_id = COALESCE(
        user_id,
        (
          SELECT notes.user_id
          FROM notes
          WHERE notes.id = ai_usage_events.note_id
          LIMIT 1
        ),
        (
          SELECT categories.user_id
          FROM categories
          WHERE categories.id = ai_usage_events.category_id
          LIMIT 1
        ),
        '${legacyUserId}'
      )
      WHERE user_id IS NULL OR TRIM(user_id) = ''
    `)
  }
}

const runMigrations = (db: SqliteDatabase, legacyUserId: string): void => {
  if (tableExists(db, 'attachments')) {
    db.exec(`
      UPDATE attachments
      SET key_terms_json = '[]'
      WHERE key_terms_json = '' OR key_terms_json IS NULL
    `)
  }

  if (
    tableExists(db, 'notes') &&
    tableExists(db, 'categories') &&
    tableExists(db, 'attachments')
  ) {
    const categoryRows = db
      .prepare(
        `
          SELECT id, name
          FROM categories
        `,
      )
      .all() as Array<{ id: string; name: string }>
    const notesByCategoryStatement = db.prepare(
      `
        SELECT id, user_id, category_id, title, content, content_json, created_at
        FROM notes
        WHERE category_id = ?
        ORDER BY created_at ASC, updated_at ASC
      `,
    )
    const attachmentIdsByNoteStatement = db.prepare(
      `
        SELECT id
        FROM attachments
        WHERE note_id = ?
        ORDER BY created_at ASC
      `,
    )
    const moveAttachmentsStatement = db.prepare(
      `
        UPDATE attachments
        SET note_id = ?
        WHERE note_id = ?
      `,
    )
    const updateCanonicalNoteStatement = db.prepare(
      `
        UPDATE notes
        SET
          title = ?,
          content = ?,
          content_json = ?,
          updated_at = ?
        WHERE id = ?
      `,
    )
    const deleteNoteStatement = db.prepare('DELETE FROM notes WHERE id = ?')

    const consolidateNotesTransaction = db.transaction(() => {
      for (const category of categoryRows) {
        const categoryNotes = notesByCategoryStatement.all(category.id) as Array<{
          id: string
          user_id: string
          category_id: string
          title: string
          content: string
          content_json: string | null
          created_at: string
        }>

        if (categoryNotes.length <= 1) {
          continue
        }

        const canonicalNote = categoryNotes[0]
        const mergedBlocks: NoteContentBlock[] = []

        for (const note of categoryNotes) {
          const attachmentIds = (
            attachmentIdsByNoteStatement.all(note.id) as Array<{ id: string }>
          ).map((attachment) => attachment.id)
          const noteBlocks = parseNoteContentBlocks(
            note.content_json,
            note.content,
            attachmentIds,
          )
          const normalizedTitle = note.title.trim()

          if (
            normalizedTitle &&
            normalizedTitle !== category.name.trim() &&
            noteBlocks.length > 0
          ) {
            mergedBlocks.push({
              id: createId(),
              type: 'text',
              text: normalizedTitle,
            })
          }

          mergedBlocks.push(...noteBlocks)
        }

        const rawText = deriveRawTextFromContentBlocks(mergedBlocks)
        const serializedBlocks = serializeNoteContentBlocks(mergedBlocks)
        const updatedAt = nowIso()

        updateCanonicalNoteStatement.run(
          category.name,
          rawText,
          serializedBlocks,
          updatedAt,
          canonicalNote.id,
        )

        for (const note of categoryNotes.slice(1)) {
          moveAttachmentsStatement.run(canonicalNote.id, note.id)
          deleteNoteStatement.run(note.id)
        }
      }
    })

    consolidateNotesTransaction()
  }

  if (tableExists(db, 'notes') && tableExists(db, 'note_chunks')) {
    const attachmentIdsByNoteStatement = db.prepare(
      `
        SELECT id
        FROM attachments
        WHERE note_id = ?
        ORDER BY created_at ASC
      `,
    )
    const updateNoteContentStatement = db.prepare(
      `
        UPDATE notes
        SET
          content = ?,
          content_json = ?
        WHERE id = ?
      `,
    )
    const notes = db
      .prepare(
        `
          SELECT id, user_id, category_id, title, content, content_json
          FROM notes
        `,
      )
      .all() as Array<{
      id: string
      user_id: string
      category_id: string
      title: string
      content: string
      content_json: string | null
    }>

    const transaction = db.transaction(() => {
      for (const note of notes) {
        const attachmentIds = (
          attachmentIdsByNoteStatement.all(note.id) as Array<{ id: string }>
        ).map((attachment) => attachment.id)
        const contentBlocks = parseNoteContentBlocks(
          note.content_json,
          note.content,
          attachmentIds,
        )
        const rawText = deriveRawTextFromContentBlocks(contentBlocks)

        updateNoteContentStatement.run(
          rawText,
          serializeNoteContentBlocks(contentBlocks),
          note.id,
        )

        replaceNoteContentChunks(db, {
          userId: note.user_id,
          noteId: note.id,
          categoryId: note.category_id,
          title: note.title,
          content: rawText,
        })
      }
    })

    transaction()
  }

  db.exec(`
    UPDATE note_chunks
    SET search_text = content
    WHERE search_text = '' OR search_text IS NULL
  `)

  db.exec(`
    DELETE FROM note_chunks_fts;

    INSERT INTO note_chunks_fts (
      chunk_id,
      note_id,
      category_id,
      attachment_id,
      source,
      search_text
    )
    SELECT
      id,
      note_id,
      category_id,
      attachment_id,
      source,
      search_text
    FROM note_chunks
  `)

  if (tableExists(db, 'ai_usage_events')) {
    const insertUsageEventStatement = db.prepare(
      `
        INSERT OR IGNORE INTO ai_usage_events (
          id,
          user_id,
          task,
          provider,
          channel,
          model,
          request_id,
          category_id,
          note_id,
          status,
          input_tokens,
          output_tokens,
          total_tokens,
          occurred_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', NULL, NULL, NULL, ?, ?, ?)
      `,
    )
    const legacyAttachmentRows = tableExists(db, 'attachments')
      ? (db
          .prepare(
            `
              SELECT
                id,
                category_id,
                note_id,
                analysis_model,
                analysis_request_id,
                processed_at,
                updated_at
              FROM attachments
              WHERE processing_status = 'ready'
                AND analysis_model IS NOT NULL
                AND TRIM(analysis_model) != ''
            `,
          )
          .all() as Array<{
          id: string
          category_id: string | null
          note_id: string | null
          analysis_model: string
          analysis_request_id: string | null
          processed_at: string | null
          updated_at: string
        }>)
      : []
    const legacyQuestionRows = tableExists(db, 'interview_questions')
      ? (db
          .prepare(
            `
              SELECT
                id,
                category_id,
                model,
                asked_at
              FROM interview_questions
              WHERE model != 'manual-entry'
            `,
          )
          .all() as Array<{
          id: string
          category_id: string | null
          model: string
          asked_at: string
        }>)
      : []
    const legacyEvaluationRows = tableExists(db, 'interview_answer_evaluations')
      ? (db
          .prepare(
            `
              SELECT
                id,
                model,
                evaluated_at
              FROM interview_answer_evaluations
              WHERE model != 'manual-entry'
            `,
          )
          .all() as Array<{
          id: string
          model: string
          evaluated_at: string
        }>)
      : []

    const backfillUsageEventsTransaction = db.transaction(() => {
      for (const row of legacyAttachmentRows) {
        const provider = parseProviderFromModel(row.analysis_model)
        const occurredAt = row.processed_at ?? row.updated_at

        insertUsageEventStatement.run(
          `legacy-attachment-${row.id}`,
          legacyUserId,
          'image_analysis',
          provider,
          toChannelFromTask('image_analysis'),
          row.analysis_model,
          row.analysis_request_id,
          row.category_id,
          row.note_id,
          occurredAt,
          occurredAt,
          occurredAt,
        )
      }

      for (const row of legacyQuestionRows) {
        const provider = parseProviderFromModel(row.model)

        insertUsageEventStatement.run(
          `legacy-question-${row.id}`,
          legacyUserId,
          'interview_question_generation',
          provider,
          toChannelFromTask('interview_question_generation'),
          row.model,
          null,
          row.category_id,
          null,
          row.asked_at,
          row.asked_at,
          row.asked_at,
        )
      }

      for (const row of legacyEvaluationRows) {
        const provider = parseProviderFromModel(row.model)

        insertUsageEventStatement.run(
          `legacy-evaluation-${row.id}`,
          legacyUserId,
          'interview_answer_evaluation',
          provider,
          toChannelFromTask('interview_answer_evaluation'),
          row.model,
          null,
          null,
          null,
          row.evaluated_at,
          row.evaluated_at,
          row.evaluated_at,
        )
      }
    })

    backfillUsageEventsTransaction()
  }
}

const buildSeedCategorySlug = (
  db: SqliteDatabase,
  baseSlug: string,
  username: string,
  preserveBaseSlug: boolean,
): string => {
  const usernameSlug = slugify(username)
  const scopedBase =
    preserveBaseSlug || !usernameSlug ? baseSlug : `${baseSlug}-${usernameSlug}`
  let candidate = scopedBase
  let suffix = 2

  const existsStatement = db.prepare(
    `
      SELECT id
      FROM categories
      WHERE slug = ?
      LIMIT 1
    `,
  )

  while (existsStatement.get(candidate)) {
    candidate = `${scopedBase}-${suffix}`
    suffix += 1
  }

  return candidate
}

export const seedDefaultCategoriesForUser = (
  db: SqliteDatabase,
  userId: string,
  options: {
    preserveCanonicalIds?: boolean
    preserveBaseSlugs?: boolean
  } = {},
): void => {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM categories WHERE user_id = ?')
    .get(userId) as { count: number }

  if (row.count > 0) {
    return
  }

  const user = db
    .prepare(
      `
        SELECT username
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
    )
    .get(userId) as { username: string } | undefined

  const insertCategory = db.prepare(
    `
      INSERT INTO categories (
        id,
        user_id,
        slug,
        name,
        description,
        color,
        icon,
        sort_order,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )

  const transaction = db.transaction(() => {
    for (const category of seedCategories) {
      const timestamp = nowIso()
      insertCategory.run(
        options.preserveCanonicalIds ? category.id : createId(),
        userId,
        buildSeedCategorySlug(
          db,
          category.slug,
          user?.username ?? userId,
          options.preserveBaseSlugs ?? false,
        ),
        category.name,
        category.description,
        category.color,
        category.icon,
        category.sortOrder,
        timestamp,
        timestamp,
      )
    }
  })

  transaction()
}

export const createDatabase = (): SqliteDatabase => {
  ensureStorage()
  backupDatabaseBeforeMigration()

  const db = new Database(DATABASE_PATH)
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')

  runPreSchemaMigrations(db)
  applySchema(db)
  const legacyUserId = ensureLegacyBootstrapUser(db)
  migrateUserOwnership(db, legacyUserId)
  runMigrations(db, legacyUserId)
  seedDefaultCategoriesForUser(db, legacyUserId, {
    preserveCanonicalIds: true,
    preserveBaseSlugs: true,
  })

  return db
}
