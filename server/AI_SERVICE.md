# AI Endpoints

Backend использует общий AI service layer в [`server/src/services/ai/`](./src/services/ai/):

- `analyzeImageForKnowledgeBase`
- `generateInterviewQuestion`
- `evaluateInterviewAnswer`

Все вызовы идут через реальный `OpenAI API`. Фейковой AI-логики в endpoint'ах нет.

## Environment

```bash
OPENAI_API_KEY=
OPENAI_IMAGE_ANALYSIS_MODEL=gpt-4.1-mini
OPENAI_INTERVIEW_QUESTION_MODEL=gpt-4.1-mini
OPENAI_INTERVIEW_EVALUATION_MODEL=gpt-4.1-mini
OPENAI_INTERVIEW_CONTEXT_MAX_CHARS=12000
```

Если `OPENAI_API_KEY` не задан, AI endpoint'ы возвращают structured config error.

## 1. POST /api/attachments/:id/analyze

Назначение: вручную запустить или перезапустить AI-анализ изображения.

Request:

```json
{
  "force": false
}
```

Response:

```json
{
  "attachment": {
    "id": "attachment-id",
    "noteId": "note-id",
    "categoryId": "javascript",
    "extractedText": "Promise callbacks run before the next macrotask.",
    "imageDescription": "A screenshot with JavaScript event loop notes.",
    "keyTerms": ["event loop", "microtask", "promise"],
    "processingStatus": "ready",
    "analysisModel": "gpt-4.1-mini",
    "analysisRequestId": "resp_123"
  },
  "analysis": {
    "status": "completed",
    "model": "gpt-4.1-mini",
    "requestId": "resp_123",
    "usage": {
      "inputTokens": 1234,
      "outputTokens": 87,
      "totalTokens": 1321
    }
  }
}
```

После успешного анализа backend обновляет `attachments` и пересобирает `note_chunks`.

## 2. POST /api/interview/questions

Назначение: собрать grounded context из базы знаний и вернуть один interview question.

Request:

```json
{
  "sourceType": "note",
  "categoryId": "javascript",
  "noteIds": ["note-id"],
  "title": "JavaScript practice",
  "focusPrompt": "Ask about event loop internals"
}
```

Response:

```json
{
  "session": {
    "id": "session-id",
    "status": "active",
    "sourceType": "note",
    "title": "JavaScript practice",
    "categoryId": "javascript",
    "noteIds": ["note-id"],
    "questionIds": ["question-id"],
    "currentQuestionId": "question-id"
  },
  "question": {
    "id": "question-id",
    "sessionId": "session-id",
    "prompt": "What is the difference between the microtask queue and the macrotask queue in the event loop?",
    "model": "gpt-4.1-mini",
    "status": "pending"
  },
  "generated": {
    "rationale": "The note emphasizes event loop behavior and Promise scheduling.",
    "expectedTopics": ["microtasks", "macrotasks", "render timing"],
    "difficulty": "medium"
  },
  "ai": {
    "model": "gpt-4.1-mini",
    "requestId": "resp_456",
    "usage": {
      "inputTokens": 950,
      "outputTokens": 110,
      "totalTokens": 1060
    }
  },
  "context": {
    "title": "JavaScript practice",
    "sourceType": "note",
    "categoryId": "javascript",
    "noteIds": ["note-id"],
    "noteTitles": ["Event loop overview"],
    "noteCount": 1,
    "chunkCount": 4,
    "sources": [
      {
        "noteId": "note-id",
        "noteTitle": "Event loop overview",
        "sourceType": "note_content",
        "sourceLabel": "Note text",
        "excerpt": "Promise callbacks run in the microtask queue before the next render."
      }
    ]
  }
}
```

## 3. POST /api/interview/evaluations

Назначение: проверить ответ пользователя по двум критериям:

- точность относительно knowledge base приложения
- точность относительно общих знаний модели

Request:

```json
{
  "sessionId": "session-id",
  "questionId": "question-id",
  "answerText": "Microtasks run after the current macrotask and before rendering."
}
```

Response:

```json
{
  "session": {
    "id": "session-id",
    "status": "completed",
    "currentQuestionId": "question-id"
  },
  "question": {
    "id": "question-id",
    "status": "evaluated",
    "prompt": "What is the difference between the microtask queue and the macrotask queue in the event loop?"
  },
  "evaluation": {
    "id": "evaluation-id",
    "answerText": "Microtasks run after the current macrotask and before rendering.",
    "model": "gpt-4.1-mini",
    "knowledgeBase": {
      "criterion": "knowledge_base",
      "score": 9,
      "maxScore": 10,
      "comment": "Strong answer grounded in the saved note.",
      "improvementTip": "Mention Promise callbacks explicitly for full coverage.",
      "correctedAnswer": null,
      "isStrongAnswer": true
    },
    "generalKnowledge": {
      "criterion": "general_knowledge",
      "score": 8,
      "maxScore": 10,
      "comment": "Mostly correct, but missing that all queued microtasks run before the next render tick.",
      "improvementTip": "Clarify that the engine drains the microtask queue before continuing.",
      "correctedAnswer": "Microtasks are drained after the current task completes and before the browser continues to rendering or the next macrotask.",
      "isStrongAnswer": false
    },
    "overallSummary": "Good conceptual answer with room for a more precise explanation."
  },
  "ai": {
    "model": "gpt-4.1-mini",
    "requestId": "resp_789"
  }
}
```

## 4. POST /api/interview/check-answer

Назначение: прямой strict-JSON endpoint для проверки ответа вне обычной interview session.

Request:

```json
{
  "question": "What is the difference between the microtask queue and the macrotask queue?",
  "answer": "Microtasks run after the current task and before the next render or macrotask.",
  "knowledgeBaseFragments": [
    {
      "text": "Promise callbacks run in the microtask queue before the next render.",
      "noteTitle": "Event loop overview",
      "sourceLabel": "Note text"
    }
  ],
  "sessionTitle": "Direct answer check",
  "categoryName": "JavaScript"
}
```

Strict JSON response:

```json
{
  "score_kb_accuracy": 9,
  "score_general_accuracy": 8,
  "feedback_kb": "Strong answer grounded in the provided knowledge base fragments.",
  "feedback_general": "Mostly correct. You could be more explicit that the engine drains the full microtask queue before moving on.",
  "improved_answer": "Microtasks are processed after the current task finishes and before rendering or the next macrotask, with Promise callbacks queued as microtasks.",
  "verdict": "strong"
}
```

## Error Format

AI endpoint'ы возвращают structured JSON errors:

```json
{
  "message": "OPENAI_API_KEY is not configured on the server.",
  "code": "ai_config_error"
}
```

Основные `code`:

- `ai_config_error`
- `ai_validation_error`
- `ai_not_found`
- `ai_upstream_error`
- `ai_invalid_response`
