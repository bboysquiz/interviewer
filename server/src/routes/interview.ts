import type { Response } from 'express'
import { Router } from 'express'

import type { SqliteDatabase } from '../db.js'
import { parseStringArray } from '../lib/json.js'
import {
  coerceNullableString,
  coerceString,
  coerceStringArray,
  createId,
  nowIso,
} from '../lib/text.js'
import type {
  AiInterviewSourceType,
  CheckInterviewAnswerRequestDto,
  EvaluateInterviewAnswerRequestDto,
  GenerateInterviewQuestionRequestDto,
} from '../services/ai/dto.js'
import { AiServiceError } from '../services/ai/errors.js'
import {
  evaluateInterviewAnswer,
  generateInterviewQuestion,
} from '../services/ai/openAiService.js'
import { createAnalyticsRepository } from '../services/analyticsRepository.js'
import {
  buildKnowledgeBaseContextFromFragments,
  normalizeKnowledgeBaseFragments,
  toStrictAnswerCheckResponse,
  uniqueNonEmpty,
} from '../services/interviewAnswerCheck.js'
import {
  applyFoundationUsageToSources,
  buildKnowledgeBaseContextFromSources,
  pickInterviewSourcesByIndexes,
  resolveInterviewKnowledgeBaseContext,
  selectQuestionGenerationSources,
  selectRelevantInterviewSources,
} from '../services/interviewContext.js'
import {
  buildEvaluation,
  buildQuestion,
  buildSessionWithQuestions,
  type EvaluationRow,
  type QuestionRow,
  type SessionRow,
} from '../services/interviewRecords.js'
import { createInterviewRepository } from '../services/interviewRepository.js'

const isInterviewSourceType = (
  value: string,
): value is AiInterviewSourceType =>
  value === 'category' || value === 'note' || value === 'note_collection'

const readInterviewSourceType = (
  value: unknown,
): AiInterviewSourceType | null => {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return isInterviewSourceType(normalized) ? normalized : null
}

const sendAiError = (
  response: Response,
  error: unknown,
  fallbackMessage: string,
): void => {
  if (error instanceof AiServiceError) {
    response.status(error.status).json({
      message: error.message,
      code: error.code,
      ...(error.details !== undefined ? { details: error.details } : {}),
    })
    return
  }

  response.status(500).json({
    message: error instanceof Error ? error.message : fallbackMessage,
  })
}

const collectScopedPreviousQuestions = (
  repository: ReturnType<typeof createInterviewRepository>,
  sourceType: AiInterviewSourceType,
  categoryId: string | null,
  noteIds: string[],
): string[] => {
  const requestedNoteIds = new Set(noteIds)

  return uniqueNonEmpty(
    repository
      .listRecentQuestionPrompts()
      .filter((row) => {
        if (sourceType === 'category') {
          return row.category_id === categoryId
        }

        if (sourceType === 'note') {
          const rowNoteIds = new Set(parseStringArray(row.note_ids_json))
          return noteIds.some((noteId) => rowNoteIds.has(noteId))
        }

        return row.category_id === categoryId
          || parseStringArray(row.note_ids_json).some((noteId) =>
            requestedNoteIds.has(noteId),
          )
      })
      .map((row) => row.prompt),
  ).slice(0, 20)
}

const parseProviderFromModel = (model: string): string => {
  const normalized = model.trim()
  const separatorIndex = normalized.indexOf(':')

  if (separatorIndex <= 0) {
    return 'unknown'
  }

  return normalized.slice(0, separatorIndex)
}

export const createInterviewRouter = (db: SqliteDatabase): Router => {
  const router = Router()
  const repository = createInterviewRepository(db)
  const analyticsRepository = createAnalyticsRepository(db)

  router.get('/history', (_request, response) => {
    response.json(repository.listHistoryRecords())
  })

  router.get('/history/:sessionId', (request, response) => {
    const sessionId = coerceString(request.params.sessionId)

    if (!sessionId) {
      response.status(400).json({
        message: 'Interview session id is required.',
      })
      return
    }

    const record = repository.getHistoryRecord(sessionId)

    if (!record) {
      response.status(404).json({
        message: `Interview session "${sessionId}" was not found.`,
      })
      return
    }

    response.json(record)
  })

  router.post('/history', (request, response) => {
    const body = request.body as Record<string, unknown>
    const sessionInput = (body.session ?? {}) as Record<string, unknown>
    const questionInput = (body.question ?? {}) as Record<string, unknown>
    const evaluationInput = (body.evaluation ?? {}) as Record<string, unknown>
    const knowledgeBaseInput =
      (evaluationInput.knowledgeBase ?? {}) as Record<string, unknown>
    const generalKnowledgeInput =
      (evaluationInput.generalKnowledge ?? {}) as Record<string, unknown>

    const sessionTitle = coerceString(sessionInput.title)
    const questionPrompt = coerceString(questionInput.prompt)
    const answerText = coerceString(evaluationInput.answerText)

    if (!sessionTitle || !questionPrompt || !answerText) {
      response.status(400).json({
        message:
          'Interview history payload requires session.title, question.prompt and evaluation.answerText.',
      })
      return
    }

    const sessionId = createId()
    const questionId = createId()
    const evaluationId = createId()
    const createdAt = nowIso()
    const sessionStartedAt =
      coerceNullableString(sessionInput.startedAt) ?? createdAt
    const answeredAt =
      coerceNullableString(evaluationInput.answeredAt) ?? createdAt
    const evaluatedAt =
      coerceNullableString(evaluationInput.evaluatedAt) ?? createdAt
    const sessionNoteIds = coerceStringArray(sessionInput.noteIds)
    const questionNoteIds = coerceStringArray(questionInput.noteIds)

    const sessionRow: SessionRow = {
      id: sessionId,
      status: coerceNullableString(sessionInput.status) ?? 'completed',
      source_type:
        coerceNullableString(sessionInput.sourceType) ?? 'note_collection',
      title: sessionTitle,
      category_id: coerceNullableString(sessionInput.categoryId),
      note_ids_json: repository.toNoteIdsJson(sessionNoteIds),
      current_question_id: questionId,
      started_at: sessionStartedAt,
      completed_at:
        coerceNullableString(sessionInput.completedAt) ?? evaluatedAt,
      created_at: createdAt,
      updated_at: createdAt,
    }

    const questionRow: QuestionRow = {
      id: questionId,
      session_id: sessionId,
      source_type:
        coerceNullableString(questionInput.sourceType) ?? sessionRow.source_type,
      category_id:
        coerceNullableString(questionInput.categoryId) ?? sessionRow.category_id,
      note_ids_json: repository.toNoteIdsJson(
        questionNoteIds.length ? questionNoteIds : sessionNoteIds,
      ),
      prompt: questionPrompt,
      model: coerceNullableString(questionInput.model) ?? 'manual-entry',
      status: coerceNullableString(questionInput.status) ?? 'evaluated',
      asked_at: coerceNullableString(questionInput.askedAt) ?? sessionStartedAt,
      created_at: createdAt,
      updated_at: createdAt,
    }

    const evaluationRow: EvaluationRow = {
      id: evaluationId,
      session_id: sessionId,
      question_id: questionId,
      answer_text: answerText,
      answered_at: answeredAt,
      evaluated_at: evaluatedAt,
      model: coerceNullableString(evaluationInput.model) ?? 'manual-entry',
      knowledge_base_score:
        typeof knowledgeBaseInput.score === 'number' ? knowledgeBaseInput.score : 0,
      knowledge_base_max_score:
        typeof knowledgeBaseInput.maxScore === 'number'
          ? knowledgeBaseInput.maxScore
          : 10,
      knowledge_base_comment: coerceString(knowledgeBaseInput.comment),
      knowledge_base_improvement_tip: coerceString(
        knowledgeBaseInput.improvementTip,
      ),
      knowledge_base_corrected_answer: coerceNullableString(
        knowledgeBaseInput.correctedAnswer,
      ),
      knowledge_base_is_strong_answer: Number(
        Boolean(knowledgeBaseInput.isStrongAnswer),
      ),
      general_knowledge_score:
        typeof generalKnowledgeInput.score === 'number'
          ? generalKnowledgeInput.score
          : 0,
      general_knowledge_max_score:
        typeof generalKnowledgeInput.maxScore === 'number'
          ? generalKnowledgeInput.maxScore
          : 10,
      general_knowledge_comment: coerceString(generalKnowledgeInput.comment),
      general_knowledge_improvement_tip: coerceString(
        generalKnowledgeInput.improvementTip,
      ),
      general_knowledge_corrected_answer: coerceNullableString(
        generalKnowledgeInput.correctedAnswer,
      ),
      general_knowledge_is_strong_answer: Number(
        Boolean(generalKnowledgeInput.isStrongAnswer),
      ),
      overall_summary: coerceNullableString(evaluationInput.overallSummary),
      created_at: createdAt,
      updated_at: createdAt,
    }

    repository.insertManualHistory(sessionRow, questionRow, evaluationRow)

    response.status(201).json({
      session: buildSessionWithQuestions(sessionRow, [questionRow]),
      question: buildQuestion(questionRow),
      evaluation: buildEvaluation(evaluationRow),
    })
  })

  router.post('/check-answer', async (request, response) => {
    const body = request.body as CheckInterviewAnswerRequestDto &
      Record<string, unknown>
    const question = coerceString(body.question, coerceString(body.questionPrompt))
    const answer = coerceString(body.answer, coerceString(body.answerText))
    const knowledgeBaseFragments = normalizeKnowledgeBaseFragments(
      body.knowledgeBaseFragments ?? body.knowledge_base_fragments,
    )
    const sessionTitle =
      coerceNullableString(body.sessionTitle ?? body.session_title) ??
      'Direct answer check'
    const categoryName = coerceNullableString(
      body.categoryName ?? body.category_name,
    )

    if (!question || !answer || knowledgeBaseFragments.length === 0) {
      response.status(400).json({
        message:
          'Answer check requires question, answer, and at least one knowledge base fragment.',
      })
      return
    }

    try {
      const evaluation = await evaluateInterviewAnswer({
        sessionTitle,
        questionPrompt: question,
        answerText: answer,
        categoryName,
        noteTitles: uniqueNonEmpty(
          knowledgeBaseFragments
            .map((fragment) => fragment.noteTitle ?? '')
            .filter(Boolean),
        ),
        knowledgeBaseContext:
          buildKnowledgeBaseContextFromFragments(knowledgeBaseFragments),
      })

      response.json(toStrictAnswerCheckResponse(evaluation))
    } catch (error) {
      sendAiError(response, error, 'AI answer check failed.')
    }
  })

  router.post('/questions', async (request, response) => {
    const body = request.body as GenerateInterviewQuestionRequestDto &
      Record<string, unknown>
    const sourceType = readInterviewSourceType(body.sourceType)
    const categoryId = coerceNullableString(body.categoryId)
    const noteIds = coerceStringArray(body.noteIds)
    const title = coerceNullableString(body.title)
    const focusPrompt = coerceNullableString(body.focusPrompt)
    const previousQuestions = coerceStringArray(body.previousQuestions)

    if (!sourceType) {
      response.status(400).json({
        message:
          'Interview question generation requires a valid sourceType: category, note, or note_collection.',
      })
      return
    }

    try {
      const context = resolveInterviewKnowledgeBaseContext(db, {
        sourceType,
        categoryId,
        noteIds,
        preferredTitle: title,
      })
      const foundationUsageMap = repository.getFoundationUsageByKeys(
        uniqueNonEmpty(context.sources.map((source) => source.foundationKey)),
      )
      const annotatedSources = applyFoundationUsageToSources(
        context.sources,
        new Map(
          [...foundationUsageMap.values()].map((row) => [
            row.foundation_key,
            {
              foundationKey: row.foundation_key,
              lastUsedAt: row.last_used_at,
              useCount: row.use_count,
            },
          ]),
        ),
      )
      const generationSources = selectQuestionGenerationSources(annotatedSources)
      const sourcePool = generationSources.length > 0 ? generationSources : annotatedSources
      const scopedPreviousQuestions = uniqueNonEmpty([
        ...collectScopedPreviousQuestions(
          repository,
          context.sourceType,
          context.categoryId,
          context.noteIds,
        ),
        ...previousQuestions,
      ]).slice(0, 20)
      const generated = await generateInterviewQuestion({
        sourceType: context.sourceType,
        sessionTitle: context.title,
        categoryName: context.categoryName,
        noteTitles: context.noteTitles,
        knowledgeBaseContext: buildKnowledgeBaseContextFromSources(
          context,
          sourcePool,
        ),
        groundingSources: sourcePool.map(
          (source) =>
            `${source.noteTitle} - ${source.sourceLabel}: ${source.excerpt}`,
        ),
        focusPrompt,
        previousQuestions: scopedPreviousQuestions,
      })
      const groundedSources = pickInterviewSourcesByIndexes(
        sourcePool,
        generated.sourceIndexes,
      )
      const relevantSources =
        groundedSources.length > 0
          ? groundedSources
          : selectRelevantInterviewSources(sourcePool, generated.question)
      const sessionId = createId()
      const questionId = createId()
      const timestamp = nowIso()

      const sessionRow: SessionRow = {
        id: sessionId,
        status: 'active',
        source_type: context.sourceType,
        title: context.title,
        category_id: context.categoryId,
        note_ids_json: repository.toNoteIdsJson(context.noteIds),
        current_question_id: questionId,
        started_at: timestamp,
        completed_at: null,
        created_at: timestamp,
        updated_at: timestamp,
      }

      const questionRow: QuestionRow = {
        id: questionId,
        session_id: sessionId,
        source_type: context.sourceType,
        category_id: context.categoryId,
        note_ids_json: repository.toNoteIdsJson(context.noteIds),
        prompt: generated.question,
        model: generated.model,
        status: 'pending',
        asked_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
      }

      repository.markFoundationUsage(
        uniqueNonEmpty(relevantSources.map((source) => source.foundationKey)).map(
          (foundationKey) => {
            const source = relevantSources.find(
              (item) => item.foundationKey === foundationKey,
            )!

            return {
              foundationKey,
              categoryId: source.categoryId,
              noteId: source.noteId,
              attachmentId: source.attachmentId,
              sourceType: source.sourceType,
              sourceExcerpt: source.excerpt,
              usedAt: timestamp,
            }
          },
        ),
      )

      repository.insertGeneratedSession(sessionRow, questionRow)
      analyticsRepository.recordAiUsageEvent({
        task: 'interview_question_generation',
        provider: parseProviderFromModel(generated.model),
        model: generated.model,
        requestId: generated.requestId,
        categoryId: context.categoryId,
        inputTokens: generated.usage?.inputTokens ?? null,
        outputTokens: generated.usage?.outputTokens ?? null,
        totalTokens: generated.usage?.totalTokens ?? null,
        occurredAt: timestamp,
      })

      response.status(201).json({
        session: buildSessionWithQuestions(sessionRow, [questionRow]),
        question: buildQuestion(questionRow),
        generated: {
          rationale: generated.rationale,
          expectedTopics: generated.expectedTopics,
          difficulty: generated.difficulty,
        },
        ai: {
          model: generated.model,
          requestId: generated.requestId,
          usage: generated.usage,
        },
        context: {
          title: context.title,
          sourceType: context.sourceType,
          categoryId: context.categoryId,
          categoryName: context.categoryName,
          noteIds: context.noteIds,
          noteTitles: context.noteTitles,
          noteCount: context.noteCount,
          chunkCount: context.chunkCount,
          sources: relevantSources.map((source) => ({
            ...source,
            lastQuestionedAt: timestamp,
          })),
        },
      })
    } catch (error) {
      sendAiError(
        response,
        error,
        'AI interview question generation failed.',
      )
    }
  })

  router.post('/evaluations', async (request, response) => {
    const body = request.body as EvaluateInterviewAnswerRequestDto &
      Record<string, unknown>
    const sessionId = coerceString(body.sessionId)
    const questionId = coerceString(body.questionId)
    const answerText = coerceString(body.answerText)

    if (!sessionId || !questionId || !answerText) {
      response.status(400).json({
        message:
          'Interview answer evaluation requires sessionId, questionId and answerText.',
      })
      return
    }

    const sessionRow = repository.getSessionRow(sessionId)
    const questionRow = repository.getQuestionRow(questionId)

    if (!sessionRow) {
      response.status(404).json({
        message: `Interview session "${sessionId}" was not found.`,
      })
      return
    }

    if (!questionRow) {
      response.status(404).json({
        message: `Interview question "${questionId}" was not found.`,
      })
      return
    }

    if (questionRow.session_id !== sessionRow.id) {
      response.status(400).json({
        message:
          'The provided question does not belong to the provided interview session.',
      })
      return
    }

    const sourceType = readInterviewSourceType(questionRow.source_type)

    if (!sourceType) {
      response.status(500).json({
        message:
          'The stored interview question has an unsupported source type.',
      })
      return
    }

    const questionNoteIds = parseStringArray(questionRow.note_ids_json)
    const sessionNoteIds = parseStringArray(sessionRow.note_ids_json)
    const noteIds = questionNoteIds.length ? questionNoteIds : sessionNoteIds
    const answeredAt = nowIso()

    try {
      const context = resolveInterviewKnowledgeBaseContext(db, {
        sourceType,
        categoryId: questionRow.category_id ?? sessionRow.category_id,
        noteIds,
        preferredTitle: sessionRow.title,
      })
      const foundationUsageMap = repository.getFoundationUsageByKeys(
        uniqueNonEmpty(context.sources.map((source) => source.foundationKey)),
      )
      const annotatedSources = applyFoundationUsageToSources(
        context.sources,
        new Map(
          [...foundationUsageMap.values()].map((row) => [
            row.foundation_key,
            {
              foundationKey: row.foundation_key,
              lastUsedAt: row.last_used_at,
              useCount: row.use_count,
            },
          ]),
        ),
      )
      const evaluated = await evaluateInterviewAnswer({
        sessionTitle: context.title,
        questionPrompt: questionRow.prompt,
        answerText,
        categoryName: context.categoryName,
        noteTitles: context.noteTitles,
        knowledgeBaseContext: context.contextText,
      })
      const relevantSources = selectRelevantInterviewSources(
        annotatedSources,
        questionRow.prompt,
      )
      const evaluatedAt = nowIso()
      const evaluationId = createId()

      const evaluationRow: EvaluationRow = {
        id: evaluationId,
        session_id: sessionRow.id,
        question_id: questionRow.id,
        answer_text: answerText,
        answered_at: answeredAt,
        evaluated_at: evaluatedAt,
        model: evaluated.model,
        knowledge_base_score: evaluated.knowledgeBase.score,
        knowledge_base_max_score: evaluated.knowledgeBase.maxScore,
        knowledge_base_comment: evaluated.knowledgeBase.comment,
        knowledge_base_improvement_tip: evaluated.knowledgeBase.improvementTip,
        knowledge_base_corrected_answer: evaluated.knowledgeBase.correctedAnswer,
        knowledge_base_is_strong_answer: Number(
          evaluated.knowledgeBase.isStrongAnswer,
        ),
        general_knowledge_score: evaluated.generalKnowledge.score,
        general_knowledge_max_score: evaluated.generalKnowledge.maxScore,
        general_knowledge_comment: evaluated.generalKnowledge.comment,
        general_knowledge_improvement_tip:
          evaluated.generalKnowledge.improvementTip,
        general_knowledge_corrected_answer:
          evaluated.generalKnowledge.correctedAnswer,
        general_knowledge_is_strong_answer: Number(
          evaluated.generalKnowledge.isStrongAnswer,
        ),
        overall_summary: evaluated.overallSummary,
        created_at: evaluatedAt,
        updated_at: evaluatedAt,
      }

      const updatedQuestionRow: QuestionRow = {
        ...questionRow,
        status: 'evaluated',
        updated_at: evaluatedAt,
      }

      const updatedSessionRow: SessionRow = {
        ...sessionRow,
        status: 'completed',
        current_question_id: questionRow.id,
        completed_at: evaluatedAt,
        updated_at: evaluatedAt,
      }

      repository.saveEvaluation(
        evaluationRow,
        updatedQuestionRow,
        updatedSessionRow,
      )
      analyticsRepository.recordAiUsageEvent({
        task: 'interview_answer_evaluation',
        provider: parseProviderFromModel(evaluated.model),
        model: evaluated.model,
        requestId: evaluated.requestId,
        categoryId: context.categoryId,
        inputTokens: evaluated.usage?.inputTokens ?? null,
        outputTokens: evaluated.usage?.outputTokens ?? null,
        totalTokens: evaluated.usage?.totalTokens ?? null,
        occurredAt: evaluatedAt,
      })

      const historyRecord = repository.getHistoryRecord(sessionRow.id)

      response.status(201).json({
        session:
          historyRecord?.session ??
          buildSessionWithQuestions(updatedSessionRow, [updatedQuestionRow]),
        question: buildQuestion(updatedQuestionRow),
        evaluation: buildEvaluation(evaluationRow),
        ai: {
          model: evaluated.model,
          requestId: evaluated.requestId,
          usage: evaluated.usage,
        },
        context: {
          title: context.title,
          sourceType: context.sourceType,
          categoryId: context.categoryId,
          categoryName: context.categoryName,
          noteIds: context.noteIds,
          noteTitles: context.noteTitles,
          noteCount: context.noteCount,
          chunkCount: context.chunkCount,
          sources: relevantSources,
        },
      })
    } catch (error) {
      sendAiError(
        response,
        error,
        'AI interview answer evaluation failed.',
      )
    }
  })

  return router
}
