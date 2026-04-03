# Project Structure

Код разложен по простому pragmatic layering: `app / pages / features / entities / shared` на frontend и отдельный `server/` для backend.

## Root

- `src/` — Vue frontend
- `server/` — Express + SQLite backend
- `docs/` — короткие reference-доки
- `.env.example` — пример frontend env
- `server/.env.example` — пример backend env

## Frontend

- `src/app/` — app shell, global styles, корневые layout-компоненты
- `src/pages/` — page-level экраны роутера
- `src/features/` — пользовательские сценарии и UI-блоки
- `src/entities/` — доменная логика и вычисления вокруг сущностей
- `src/shared/` — переиспользуемые ui/lib helpers
- `src/router/` — Vue Router конфигурация
- `src/stores/` — Pinia stores
- `src/services/` — API paths, http client, frontend service layer
- `src/types/` — TypeScript модели и API DTO

## Backend

- `server/src/index.ts` — entrypoint Express app
- `server/src/config.ts` — env/config loading
- `server/src/db.ts` — SQLite init, schema bootstrapping, migrations/backfill
- `server/src/routes/` — HTTP routes
- `server/src/services/` — business logic, interview helpers, OpenAI integration
- `server/src/services/ai/` — shared AI service layer и DTO/errors
- `server/src/lib/` — low-level helpers для chunks/json/text
- `server/schema.sql` — source of truth для SQL schema
- `server/data/` — SQLite database files
- `server/uploads/` — загруженные изображения

## Main Frontend Flows

- `CategoriesPage` — CRUD категорий
- `CategoryNotesPage` — CRUD заметок внутри категории
- `NoteDetailPage` — просмотр, редактирование, загрузка изображений, AI-анализ вложений
- `SearchPage` — поиск по заметкам, OCR и описаниям изображений
- `InterviewPage` — генерация вопроса и проверка ответа
- `HistoryPage` / `HistoryDetailPage` — история интервью-сессий и слабые места

## Main Backend Areas

- `routes/categories.ts` — CRUD категорий
- `routes/notes.ts` — CRUD заметок + chunk regeneration
- `routes/attachments.ts` — upload, storage, AI image analysis
- `routes/search.ts` — FTS search по `note_chunks`
- `routes/interview.ts` — question generation, answer evaluation, history
