import { Router } from 'express'

import type { SqliteDatabase } from '../db.js'
import { createAnalyticsRepository } from '../services/analyticsRepository.js'

export const createAnalyticsRouter = (db: SqliteDatabase): Router => {
  const router = Router()
  const repository = createAnalyticsRepository(db)

  router.get('/ai', (request, response) => {
    response.json(repository.getAiAnalyticsSnapshot(request.authUser!.id))
  })

  return router
}
