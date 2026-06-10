# Environment Variables

## Frontend

File: [`.env`](../.env), usually copied from [`.env.example`](../.env.example).

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | local only | empty in production | Backend API base URL for local Vite development. |

## Backend

File: [`server/.env`](../server/.env), usually copied from [`server/.env.example`](../server/.env.example).

The backend loads the root `.env` first, then `server/.env`. Values from `server/.env` have priority.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HOST` | no | `0.0.0.0` | Express bind host. |
| `PORT` | no | `3000` | Express port. |
| `CLIENT_ORIGIN` | yes for cross-origin dev | `http://localhost:5173` | Allowed frontend origin for CORS and cookies. |
| `AUTH_SESSION_COOKIE_NAME` | no | `programming_interviewer_session` | Auth session cookie name. |
| `AUTH_SESSION_TTL_DAYS` | no | `30` | Auth session lifetime. |
| `DATABASE_PATH` | no | `server/data/app.db` or `/data/app.db` | SQLite database path. |
| `UPLOADS_DIR` | no | `server/uploads` or `/data/uploads` | Uploaded screenshot storage path. |
| `AI_PRIMARY_PROVIDER` | no | `gemini` | Primary AI provider. |
| `AI_FALLBACK_PROVIDER` | no | `groq` | Fallback AI provider. |
| `GEMINI_API_KEY` | yes for Gemini | empty | Gemini API key. |
| `GEMINI_DOH_URL` | no | empty | Optional DNS-over-HTTPS resolver for Gemini requests. |
| `GEMINI_DNS_SERVERS` | no | empty | Optional comma-separated DNS server IPs for Gemini requests. |
| `GEMINI_VISION_MODEL` | no | `gemini-2.5-flash` | Gemini model for screenshot analysis. |
| `GEMINI_INTERVIEW_QUESTION_MODEL` | no | `gemini-3.1-flash-lite-preview` | Gemini model for question generation and note tasks. |
| `GEMINI_INTERVIEW_EVALUATION_MODEL` | no | `gemini-3.1-flash-lite-preview` | Gemini model for answer evaluation. |
| `GROQ_API_KEY` | yes for Groq | empty | Groq API key. |
| `GROQ_VISION_MODEL` | no | `meta-llama/llama-4-scout-17b-16e-instruct` | Groq model for screenshot analysis. |
| `GROQ_VISION_MODEL_FALLBACKS` | no | empty | Extra comma-separated Groq vision fallback models. |
| `GROQ_INTERVIEW_QUESTION_MODEL` | no | `llama-3.3-70b-versatile` | Groq model for question generation and note tasks. |
| `GROQ_INTERVIEW_QUESTION_MODEL_FALLBACKS` | no | `llama-3.1-8b-instant` | Groq text fallback models. |
| `GROQ_INTERVIEW_EVALUATION_MODEL` | no | `llama-3.3-70b-versatile` | Groq model for answer evaluation. |
| `GROQ_INTERVIEW_EVALUATION_MODEL_FALLBACKS` | no | `llama-3.1-8b-instant` | Groq evaluation fallback models. |
| `AI_INTERVIEW_CONTEXT_MAX_CHARS` | no | `12000` | Max grounded context size passed to interview prompts. |
| `AI_ANALYTICS_WINDOW_HOURS` | no | `24` | Analytics rolling window size. |
| `AI_ANALYTICS_GEMINI_TEXT_REQUEST_LIMIT` | no | `20` | App-level Gemini text request estimate for Analytics. |
| `AI_ANALYTICS_GEMINI_IMAGE_REQUEST_LIMIT` | no | `20` | App-level Gemini image request estimate for Analytics. |
| `AI_ANALYTICS_GROQ_TEXT_REQUEST_LIMIT` | no | `1000` | App-level Groq text request estimate for Analytics. |
| `AI_ANALYTICS_GROQ_IMAGE_REQUEST_LIMIT` | no | `1000` | App-level Groq image request estimate for Analytics. |

## Minimal Local Setup

```bash
# .env
VITE_API_BASE_URL=http://localhost:3000
```

```bash
# server/.env
PORT=3000
CLIENT_ORIGIN=http://localhost:5173
DATABASE_PATH=server/data/app.db
UPLOADS_DIR=server/uploads
AI_PRIMARY_PROVIDER=gemini
AI_FALLBACK_PROVIDER=groq
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key
AI_INTERVIEW_CONTEXT_MAX_CHARS=12000
```
