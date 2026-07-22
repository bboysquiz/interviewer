import type { SqliteDatabase } from '../db.js'
import { toJson } from '../lib/json.js'

import {
  buildInterviewHistoryRecord,
  type EvaluationRow,
  type QuestionRow,
  type SessionRow,
} from './interviewRecords.js'

interface FoundationUsageRow {
  foundation_key: string
  user_id: string
  category_id: string | null
  note_id: string
  attachment_id: string | null
  source_type: string
  source_excerpt: string
  use_count: number
  first_used_at: string
  last_used_at: string
  created_at: string
  updated_at: string
}

interface RecentQuestionPromptRow {
  prompt: string
  source_type: string
  category_id: string | null
  note_ids_json: string
}

export const createInterviewRepository = (db: SqliteDatabase) => {
  const sessionsStatement = db.prepare(
    `
      SELECT
        id,
        user_id,
        status,
        source_type,
        title,
        category_id,
        note_ids_json,
        current_question_id,
        started_at,
        completed_at,
        created_at,
        updated_at
      FROM interview_sessions
      WHERE user_id = ?
      ORDER BY started_at DESC
      LIMIT 50
    `,
  )
  const sessionByIdStatement = db.prepare(
    `
      SELECT
        id,
        user_id,
        status,
        source_type,
        title,
        category_id,
        note_ids_json,
        current_question_id,
        started_at,
        completed_at,
        created_at,
        updated_at
      FROM interview_sessions
      WHERE user_id = ? AND id = ?
      LIMIT 1
    `,
  )
  const questionsBySessionStatement = db.prepare(
    `
      SELECT
        id,
        user_id,
        session_id,
        source_type,
        category_id,
        note_ids_json,
        prompt,
        grounding_context,
        model,
        status,
        asked_at,
        created_at,
        updated_at
      FROM interview_questions
      WHERE user_id = ? AND session_id = ?
      ORDER BY asked_at ASC
    `,
  )
  const questionByIdStatement = db.prepare(
    `
      SELECT
        id,
        user_id,
        session_id,
        source_type,
        category_id,
        note_ids_json,
        prompt,
        grounding_context,
        model,
        status,
        asked_at,
        created_at,
        updated_at
      FROM interview_questions
      WHERE user_id = ? AND id = ?
      LIMIT 1
    `,
  )
  const evaluationsBySessionStatement = db.prepare(
    `
      SELECT
        id,
        user_id,
        session_id,
        question_id,
        answer_text,
        answered_at,
        evaluated_at,
        model,
        knowledge_base_score,
        knowledge_base_max_score,
        knowledge_base_comment,
        knowledge_base_improvement_tip,
        knowledge_base_corrected_answer,
        knowledge_base_is_strong_answer,
        general_knowledge_score,
        general_knowledge_max_score,
        general_knowledge_comment,
        general_knowledge_improvement_tip,
        general_knowledge_corrected_answer,
        general_knowledge_is_strong_answer,
        overall_summary,
        created_at,
        updated_at
      FROM interview_answer_evaluations
      WHERE user_id = ? AND session_id = ?
      ORDER BY answered_at DESC
    `,
  )
  const insertSessionStatement = db.prepare(
    `
      INSERT INTO interview_sessions (
        id,
        user_id,
        status,
        source_type,
        title,
        category_id,
        note_ids_json,
        current_question_id,
        started_at,
        completed_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )
  const insertQuestionStatement = db.prepare(
    `
      INSERT INTO interview_questions (
        id,
        user_id,
        session_id,
        source_type,
        category_id,
        note_ids_json,
        prompt,
        grounding_context,
        model,
        status,
        asked_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )
  const insertEvaluationStatement = db.prepare(
    `
      INSERT INTO interview_answer_evaluations (
        id,
        user_id,
        session_id,
        question_id,
        answer_text,
        answered_at,
        evaluated_at,
        model,
        knowledge_base_score,
        knowledge_base_max_score,
        knowledge_base_comment,
        knowledge_base_improvement_tip,
        knowledge_base_corrected_answer,
        knowledge_base_is_strong_answer,
        general_knowledge_score,
        general_knowledge_max_score,
        general_knowledge_comment,
        general_knowledge_improvement_tip,
        general_knowledge_corrected_answer,
        general_knowledge_is_strong_answer,
        overall_summary,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  )
  const updateQuestionStatusStatement = db.prepare(
    `
      UPDATE interview_questions
      SET
        status = ?,
        updated_at = ?
      WHERE id = ?
    `,
  )
  const updateSessionStatusStatement = db.prepare(
    `
      UPDATE interview_sessions
      SET
        status = ?,
        current_question_id = ?,
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
    `,
  )
  const recentQuestionPromptsStatement = db.prepare(
    `
      SELECT
        prompt,
        source_type,
        category_id,
        note_ids_json
      FROM interview_questions
      WHERE user_id = ?
      ORDER BY asked_at DESC
      LIMIT 120
    `,
  )
  const upsertFoundationUsageStatement = db.prepare(
    `
      INSERT INTO interview_foundation_usage (
        foundation_key,
        user_id,
        category_id,
        note_id,
        attachment_id,
        source_type,
        source_excerpt,
        use_count,
        first_used_at,
        last_used_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(foundation_key) DO UPDATE SET
        user_id = excluded.user_id,
        category_id = excluded.category_id,
        note_id = excluded.note_id,
        attachment_id = excluded.attachment_id,
        source_type = excluded.source_type,
        source_excerpt = excluded.source_excerpt,
        use_count = interview_foundation_usage.use_count + 1,
        last_used_at = excluded.last_used_at,
        updated_at = excluded.updated_at
    `,
  )

  const getQuestionRows = (userId: string, sessionId: string): QuestionRow[] =>
    questionsBySessionStatement.all(userId, sessionId) as QuestionRow[]

  const getEvaluationRows = (userId: string, sessionId: string): EvaluationRow[] =>
    evaluationsBySessionStatement.all(userId, sessionId) as EvaluationRow[]

  const buildHistoryRecordFromSession = (sessionRow: SessionRow) =>
    buildInterviewHistoryRecord(
      sessionRow,
      getQuestionRows(sessionRow.user_id, sessionRow.id),
      getEvaluationRows(sessionRow.user_id, sessionRow.id),
    )

  const runInsertSession = (sessionRow: SessionRow): void => {
    insertSessionStatement.run(
      sessionRow.id,
      sessionRow.user_id,
      sessionRow.status,
      sessionRow.source_type,
      sessionRow.title,
      sessionRow.category_id,
      sessionRow.note_ids_json,
      sessionRow.current_question_id,
      sessionRow.started_at,
      sessionRow.completed_at,
      sessionRow.created_at,
      sessionRow.updated_at,
    )
  }

  const runInsertQuestion = (questionRow: QuestionRow): void => {
    insertQuestionStatement.run(
      questionRow.id,
      questionRow.user_id,
      questionRow.session_id,
      questionRow.source_type,
      questionRow.category_id,
      questionRow.note_ids_json,
      questionRow.prompt,
      questionRow.grounding_context,
      questionRow.model,
      questionRow.status,
      questionRow.asked_at,
      questionRow.created_at,
      questionRow.updated_at,
    )
  }

  const runInsertEvaluation = (evaluationRow: EvaluationRow): void => {
    insertEvaluationStatement.run(
      evaluationRow.id,
      evaluationRow.user_id,
      evaluationRow.session_id,
      evaluationRow.question_id,
      evaluationRow.answer_text,
      evaluationRow.answered_at,
      evaluationRow.evaluated_at,
      evaluationRow.model,
      evaluationRow.knowledge_base_score,
      evaluationRow.knowledge_base_max_score,
      evaluationRow.knowledge_base_comment,
      evaluationRow.knowledge_base_improvement_tip,
      evaluationRow.knowledge_base_corrected_answer,
      evaluationRow.knowledge_base_is_strong_answer,
      evaluationRow.general_knowledge_score,
      evaluationRow.general_knowledge_max_score,
      evaluationRow.general_knowledge_comment,
      evaluationRow.general_knowledge_improvement_tip,
      evaluationRow.general_knowledge_corrected_answer,
      evaluationRow.general_knowledge_is_strong_answer,
      evaluationRow.overall_summary,
      evaluationRow.created_at,
      evaluationRow.updated_at,
    )
  }

  return {
    listHistoryRecords: (userId: string) =>
      (sessionsStatement.all(userId) as SessionRow[]).map(buildHistoryRecordFromSession),

    getHistoryRecord: (userId: string, sessionId: string) => {
      const sessionRow = sessionByIdStatement.get(userId, sessionId) as
        | SessionRow
        | undefined

      return sessionRow ? buildHistoryRecordFromSession(sessionRow) : null
    },

    getSessionRow: (userId: string, sessionId: string) =>
      sessionByIdStatement.get(userId, sessionId) as SessionRow | undefined,

    getQuestionRow: (userId: string, questionId: string) =>
      questionByIdStatement.get(userId, questionId) as QuestionRow | undefined,

    listQuestionIds: (userId: string, sessionId: string) =>
      getQuestionRows(userId, sessionId).map((question) => question.id),

    listRecentQuestionPrompts: (userId: string) =>
      recentQuestionPromptsStatement.all(userId) as RecentQuestionPromptRow[],

    getFoundationUsageByKeys: (userId: string, foundationKeys: string[]) => {
      if (foundationKeys.length === 0) {
        return new Map<string, FoundationUsageRow>()
      }

      const keyPrefix = `${userId}::`
      const scopedFoundationKeys = [
        ...new Set(
          foundationKeys.map((foundationKey) => `${keyPrefix}${foundationKey}`),
        ),
      ]
      const usageRows: FoundationUsageRow[] = []
      const batchSize = 500

      for (
        let startIndex = 0;
        startIndex < scopedFoundationKeys.length;
        startIndex += batchSize
      ) {
        const batch = scopedFoundationKeys.slice(
          startIndex,
          startIndex + batchSize,
        )
        const placeholders = batch.map(() => '?').join(', ')
        const statement = db.prepare(
          `
            SELECT
              foundation_key,
              user_id,
              category_id,
              note_id,
              attachment_id,
              source_type,
              source_excerpt,
              use_count,
              first_used_at,
              last_used_at,
              created_at,
              updated_at
            FROM interview_foundation_usage
            WHERE foundation_key IN (${placeholders})
          `,
        )

        usageRows.push(...(statement.all(...batch) as FoundationUsageRow[]))
      }

      return new Map(
        usageRows.map((row) => [
          row.foundation_key.startsWith(keyPrefix)
            ? row.foundation_key.slice(keyPrefix.length)
            : row.foundation_key,
          row,
        ]),
      )
    },

    insertGeneratedSession: (sessionRow: SessionRow, questionRow: QuestionRow) => {
      const transaction = db.transaction(() => {
        runInsertSession(sessionRow)
        runInsertQuestion(questionRow)
      })

      transaction()
    },

    insertManualHistory: (
      sessionRow: SessionRow,
      questionRow: QuestionRow,
      evaluationRow: EvaluationRow,
    ) => {
      const transaction = db.transaction(() => {
        runInsertSession(sessionRow)
        runInsertQuestion(questionRow)
        runInsertEvaluation(evaluationRow)
      })

      transaction()
    },

    saveEvaluation: (
      evaluationRow: EvaluationRow,
      updatedQuestionRow: QuestionRow,
      updatedSessionRow: SessionRow,
    ) => {
      const transaction = db.transaction(() => {
        runInsertEvaluation(evaluationRow)

        updateQuestionStatusStatement.run(
          updatedQuestionRow.status,
          updatedQuestionRow.updated_at,
          updatedQuestionRow.id,
        )

        updateSessionStatusStatement.run(
          updatedSessionRow.status,
          updatedSessionRow.current_question_id,
          updatedSessionRow.completed_at,
          updatedSessionRow.updated_at,
          updatedSessionRow.id,
        )
      })

      transaction()
    },

    markFoundationUsage: (
      userId: string,
      foundations: Array<{
        foundationKey: string
        categoryId: string | null
        noteId: string
        attachmentId: string | null
        sourceType: string
        sourceExcerpt: string
        usedAt: string
      }>,
    ) => {
      const transaction = db.transaction(() => {
        for (const foundation of foundations) {
          upsertFoundationUsageStatement.run(
            `${userId}::${foundation.foundationKey}`,
            userId,
            foundation.categoryId,
            foundation.noteId,
            foundation.attachmentId,
            foundation.sourceType,
            foundation.sourceExcerpt,
            foundation.usedAt,
            foundation.usedAt,
            foundation.usedAt,
            foundation.usedAt,
          )
        }
      })

      transaction()
    },

    toNoteIdsJson: (noteIds: string[]) => toJson(noteIds),
  }
}
