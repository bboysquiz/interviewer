# OpenAI Image Analysis

This document describes the real server-side image analysis pipeline for attachments.

## Environment variables

```bash
OPENAI_API_KEY=your_api_key
OPENAI_IMAGE_ANALYSIS_MODEL=gpt-4.1-mini
```

## Pipeline

1. `POST /api/attachments` saves the uploaded image to `server/uploads` and creates an `attachments` row in SQLite.
2. If the upload did not already provide OCR data, the server schedules OpenAI analysis in the background.
3. `POST /api/attachments/:id/analyze` can be called explicitly to run or retry analysis.
4. The server sends the image to OpenAI Responses API and asks for strict JSON with:
   - `extracted_text`
   - `image_description`
   - `key_terms`
5. The server stores the result back into `attachments` and rebuilds `note_chunks`.

## Request

Endpoint:

```http
POST /api/attachments/:id/analyze
Content-Type: application/json
```

Body:

```json
{
  "force": false
}
```

`force: true` reruns analysis even if the attachment is already in `ready` state.

## Response

```json
{
  "attachment": {
    "id": "attachment-id",
    "noteId": "note-id",
    "categoryId": "category-id",
    "type": "image",
    "originalFileName": "screenshot.png",
    "storedFileName": "generated-file-name.png",
    "storagePath": "/uploads/generated-file-name.png",
    "mimeType": "image/png",
    "sizeBytes": 183024,
    "width": null,
    "height": null,
    "extractedText": "Promise callbacks run before the next macrotask.",
    "imageDescription": "A screenshot with JavaScript event loop notes and highlighted microtask ordering.",
    "keyTerms": ["event loop", "microtask", "promise", "macrotask"],
    "processingStatus": "ready",
    "processedAt": "2026-04-02T12:34:56.000Z",
    "processingError": null,
    "analysisModel": "gpt-4.1-mini",
    "analysisRequestId": "resp_123",
    "createdAt": "2026-04-02T12:34:00.000Z",
    "updatedAt": "2026-04-02T12:34:56.000Z"
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

## Failure response

```json
{
  "message": "OPENAI_API_KEY is not configured on the server."
}
```
