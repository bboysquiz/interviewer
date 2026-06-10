# Backend

Backend for the Programming Interviewer knowledge base and interview trainer.

## Stack

- `Node.js`
- `TypeScript`
- `Express`
- `SQLite`
- `better-sqlite3`
- `multer`
- `Gemini API`
- `Groq API`

## Responsibilities

- Stores users, categories, notes, attachments, interview history, and AI analytics.
- Saves uploaded screenshots in `server/uploads` locally or `/data/uploads` in production.
- Uses SQLite in `server/data` locally or `/data/app.db` in production.
- Builds searchable note chunks for plain text and analyzed screenshot text.
- Calls the configured AI provider chain for image analysis, question generation, answer evaluation, note organization, and study topic suggestions.

## Start

```bash
npm install
cp server/.env.example server/.env
npm run dev:server
```

Health check:

```text
http://localhost:3000/api/health
```

## Docs

- [`../docs/ENVIRONMENT.md`](../docs/ENVIRONMENT.md)
- [`./DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)
- [`./schema.sql`](./schema.sql)
