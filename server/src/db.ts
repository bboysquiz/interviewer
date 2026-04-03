import fs from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'

import { DATABASE_PATH, SCHEMA_PATH, UPLOADS_DIR } from './config.js'
import { replaceNoteContentChunks } from './lib/chunks.js'
import {
  deriveRawTextFromContentBlocks,
  parseNoteContentBlocks,
  serializeNoteContentBlocks,
} from './lib/noteContent.js'
import { createId, nowIso } from './lib/text.js'

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

const ensureColumn = (
  db: SqliteDatabase,
  tableName: string,
  columnName: string,
  columnDefinition: string,
): void => {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>

  if (!columns.some((column) => column.name === columnName)) {
    db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`,
    )
  }
}

const applySchema = (db: SqliteDatabase): void => {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8')
  db.exec(schema)
}

const runPreSchemaMigrations = (db: SqliteDatabase): void => {
  if (tableExists(db, 'notes')) {
    ensureColumn(db, 'notes', 'content_json', 'TEXT')
  }

  if (tableExists(db, 'attachments')) {
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
    return
  }

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
}

const runMigrations = (db: SqliteDatabase): void => {
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
        SELECT id, category_id, title, content, content_json, created_at
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
        const mergedBlocks: Array<
          | { id: string; type: 'text'; text: string }
          | { id: string; type: 'image'; attachmentId: string }
        > = []

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
          SELECT id, category_id, title, content, content_json
          FROM notes
        `,
      )
      .all() as Array<{
      id: string
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
}

const seedDatabase = (db: SqliteDatabase): void => {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM categories')
    .get() as { count: number }

  if (row.count > 0) {
    return
  }

  const insertCategory = db.prepare(
    `
      INSERT INTO categories (
        id,
        slug,
        name,
        description,
        color,
        icon,
        sort_order,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )

  const transaction = db.transaction(() => {
    for (const category of seedCategories) {
      const timestamp = nowIso()
      insertCategory.run(
        category.id,
        category.slug,
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

  const db = new Database(DATABASE_PATH)
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')

  runPreSchemaMigrations(db)
  applySchema(db)
  runMigrations(db)
  seedDatabase(db)

  return db
}
