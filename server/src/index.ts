import fs from 'node:fs'
import path from 'node:path'
import cors from 'cors'
import express from 'express'

import {
  CLIENT_ORIGIN,
  SERVER_PORT,
  SERVER_ROOT,
  UPLOADS_DIR,
} from './config.js'
import { createDatabase } from './db.js'
import { createAttachmentsRouter } from './routes/attachments.js'
import { createCategoriesRouter } from './routes/categories.js'
import { createInterviewRouter } from './routes/interview.js'
import { createNotesRouter } from './routes/notes.js'
import { createSearchRouter } from './routes/search.js'

const db = createDatabase()
const app = express()
const repoRoot = path.resolve(SERVER_ROOT, '..')
const clientDistDir = path.join(repoRoot, 'dist')
const clientIndexPath = path.join(clientDistDir, 'index.html')
const hasClientBuild = fs.existsSync(clientIndexPath)

app.use(
  cors({
    origin: CLIENT_ORIGIN,
  }),
)
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(UPLOADS_DIR))

app.get('/api/health', (_request, response) => {
  response.json({
    ok: true,
    database: 'sqlite',
    uploadsDir: UPLOADS_DIR,
  })
})

app.use('/api/categories', createCategoriesRouter(db))
app.use('/api/notes', createNotesRouter(db))
app.use('/api/attachments', createAttachmentsRouter(db))
app.use('/api/search', createSearchRouter(db))
app.use('/api/interview', createInterviewRouter(db))

if (hasClientBuild) {
  app.use(express.static(clientDistDir))

  app.use((request, response, next) => {
    if (request.method !== 'GET') {
      next()
      return
    }

    if (
      request.path.startsWith('/api') ||
      request.path.startsWith('/uploads')
    ) {
      next()
      return
    }

    response.sendFile(clientIndexPath)
  })
}

app.use(
  (
    error: Error & { status?: number },
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    response.status(error.status ?? 500).json({
      message: error.message || 'Unexpected server error.',
    })
  },
)

app.listen(SERVER_PORT, () => {
  console.log(`Backend listening on http://localhost:${SERVER_PORT}`)
})
