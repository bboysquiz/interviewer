# Backend

Локальный backend для personal knowledge base приложения.

## Stack

- `Express`
- `better-sqlite3`
- `multer`
- `OpenAI API`

## Что делает backend

- хранит категории, заметки, вложения и историю интервью
- сохраняет изображения в `server/uploads`
- держит SQLite базу в `server/data`
- пересобирает `note_chunks` для поиска
- вызывает OpenAI для:
  - анализа изображений
  - генерации interview questions
  - оценки ответов

## Запуск

Из корня репозитория:

```bash
npm install
cp server/.env.example server/.env
npm run dev:server
```

Health-check:

```bash
http://localhost:3000/api/health
```

## Docs

- [`../docs/ENVIRONMENT.md`](../docs/ENVIRONMENT.md)
- [`./AI_SERVICE.md`](./AI_SERVICE.md)
- [`./DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md)
- [`./schema.sql`](./schema.sql)
