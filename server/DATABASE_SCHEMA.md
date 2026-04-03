# Database Schema

Source of truth: [`schema.sql`](./schema.sql)

Ниже описана актуальная схема SQLite для MVP. Основные таблицы:

- `categories`
- `notes`
- `attachments`
- `note_chunks`
- `interview_sessions`

Поддерживающие таблицы:

- `interview_questions`
- `interview_answer_evaluations`

## Relationships

- `categories.id -> notes.category_id`
- `categories.id -> attachments.category_id`
- `categories.id -> note_chunks.category_id`
- `categories.id -> interview_sessions.category_id`
- `notes.id -> attachments.note_id`
- `notes.id -> note_chunks.note_id`
- `attachments.id -> note_chunks.attachment_id`
- `interview_sessions.id -> interview_questions.session_id`
- `interview_sessions.id -> interview_answer_evaluations.session_id`
- `interview_questions.id -> interview_answer_evaluations.question_id`

## 1. categories

Назначение: верхнеуровневые темы вроде `JavaScript`, `Vue`, `Git`.

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | `TEXT` | PK |
| `slug` | `TEXT` | unique slug |
| `name` | `TEXT` | название категории |
| `description` | `TEXT` | описание |
| `color` | `TEXT` | цвет для UI |
| `icon` | `TEXT` | короткая метка |
| `sort_order` | `INTEGER` | порядок вывода |
| `created_at` | `TEXT` | ISO timestamp |
| `updated_at` | `TEXT` | ISO timestamp |

Индексы:

- `PRIMARY KEY (id)`
- `UNIQUE (slug)`
- `idx_categories_sort_order (sort_order, name)`

## 2. notes

Назначение: текстовые заметки внутри категории.

Важно: на frontend API поле называется `rawText`, но в SQLite хранится как `content`.

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | `TEXT` | PK |
| `category_id` | `TEXT` | FK на категорию |
| `title` | `TEXT` | заголовок заметки |
| `content` | `TEXT` | основной текст заметки |
| `content_format` | `TEXT` | `markdown` / `plain_text` |
| `summary` | `TEXT` | summary |
| `tags_json` | `TEXT` | JSON-массив тегов |
| `status` | `TEXT` | `active` / `archived` |
| `last_reviewed_at` | `TEXT` | дата последнего повтора |
| `created_at` | `TEXT` | ISO timestamp |
| `updated_at` | `TEXT` | ISO timestamp |

Индексы:

- `PRIMARY KEY (id)`
- `idx_notes_category_id (category_id)`
- `idx_notes_updated_at (updated_at DESC)`

## 3. attachments

Назначение: изображения, OCR-результат, image summary и служебный статус AI-пайплайна.

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | `TEXT` | PK |
| `note_id` | `TEXT` | FK на заметку |
| `category_id` | `TEXT` | FK на категорию |
| `type` | `TEXT` | сейчас `image` |
| `original_file_name` | `TEXT` | имя файла у пользователя |
| `stored_file_name` | `TEXT` | имя файла на диске |
| `storage_path` | `TEXT` | путь к файлу |
| `mime_type` | `TEXT` | MIME type |
| `size_bytes` | `INTEGER` | размер файла |
| `width` | `INTEGER` | ширина |
| `height` | `INTEGER` | высота |
| `extracted_text` | `TEXT` | извлечённый текст |
| `image_description` | `TEXT` | краткое описание изображения |
| `key_terms_json` | `TEXT` | JSON-массив ключевых терминов |
| `processing_status` | `TEXT` | `pending` / `processing` / `ready` / `failed` |
| `processed_at` | `TEXT` | когда анализ завершился |
| `processing_error` | `TEXT` | текст ошибки |
| `analysis_model` | `TEXT` | какая AI-модель использовалась |
| `analysis_request_id` | `TEXT` | request id OpenAI |
| `created_at` | `TEXT` | ISO timestamp |
| `updated_at` | `TEXT` | ISO timestamp |

Индексы:

- `PRIMARY KEY (id)`
- `idx_attachments_note_id (note_id)`
- `idx_attachments_category_id (category_id)`
- `idx_attachments_processing_status (processing_status, updated_at DESC)`

## 4. note_chunks

Назначение: единая поисковая таблица для lexical search и будущего semantic search.

В неё попадают chunks из:

- `notes.title`
- `notes.content`
- `attachments.extracted_text`
- `attachments.image_description`

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | `TEXT` | PK chunk'а |
| `note_id` | `TEXT` | FK на заметку |
| `category_id` | `TEXT` | FK на категорию |
| `attachment_id` | `TEXT` | FK на вложение, если chunk пришёл из изображения |
| `source` | `TEXT` | `note_title`, `note_content`, `attachment_extracted_text`, `attachment_description` |
| `chunk_index` | `INTEGER` | порядок chunk'а внутри источника |
| `content` | `TEXT` | оригинальный текст chunk'а |
| `summary` | `TEXT` | optional summary |
| `search_text` | `TEXT` | нормализованный текст для поиска |
| `start_offset` | `INTEGER` | начало во входном тексте |
| `end_offset` | `INTEGER` | конец во входном тексте |
| `embedding_status` | `TEXT` | подготовка под future semantic search |
| `embedding_model` | `TEXT` | модель embeddings |
| `embedding_updated_at` | `TEXT` | время последней векторизации |
| `embedding_checksum` | `TEXT` | checksum содержимого |
| `created_at` | `TEXT` | ISO timestamp |
| `updated_at` | `TEXT` | ISO timestamp |

Индексы:

- `PRIMARY KEY (id)`
- `idx_note_chunks_note_id (note_id)`
- `idx_note_chunks_attachment_id (attachment_id)`
- `idx_note_chunks_category_id (category_id)`
- `idx_note_chunks_source (source, category_id, note_id)`
- `idx_note_chunks_unique_source (note_id, COALESCE(attachment_id, ''), source, chunk_index)`
- `idx_note_chunks_embedding_status (embedding_status, updated_at DESC)`

FTS:

- `note_chunks_fts` — `FTS5` таблица по `search_text`
- `trg_note_chunks_ai`
- `trg_note_chunks_au`
- `trg_note_chunks_ad`

## 5. interview_sessions

Назначение: история interview mode на уровне сессии.

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | `TEXT` | PK |
| `status` | `TEXT` | `queued`, `active`, `completed`, `cancelled` |
| `source_type` | `TEXT` | `category`, `note`, `note_collection` |
| `title` | `TEXT` | заголовок сессии |
| `category_id` | `TEXT` | FK на категорию |
| `note_ids_json` | `TEXT` | JSON-массив note id |
| `current_question_id` | `TEXT` | активный вопрос |
| `started_at` | `TEXT` | старт |
| `completed_at` | `TEXT` | завершение |
| `created_at` | `TEXT` | ISO timestamp |
| `updated_at` | `TEXT` | ISO timestamp |

Индексы:

- `PRIMARY KEY (id)`
- `idx_interview_sessions_started_at (started_at DESC)`
- `idx_interview_sessions_category_id (category_id, started_at DESC)`

## Supporting Tables

### interview_questions

Хранит вопрос внутри конкретной сессии.

Основные поля:

- `id`
- `session_id`
- `source_type`
- `category_id`
- `note_ids_json`
- `prompt`
- `model`
- `status`
- `asked_at`
- `created_at`
- `updated_at`

Индекс:

- `idx_interview_questions_session_id (session_id)`

### interview_answer_evaluations

Хранит результат проверки ответа по двум критериям:

- `knowledge_base_*`
- `general_knowledge_*`

Основные поля:

- `id`
- `session_id`
- `question_id`
- `answer_text`
- `answered_at`
- `evaluated_at`
- `model`
- `knowledge_base_score`
- `knowledge_base_comment`
- `knowledge_base_improvement_tip`
- `knowledge_base_corrected_answer`
- `general_knowledge_score`
- `general_knowledge_comment`
- `general_knowledge_improvement_tip`
- `general_knowledge_corrected_answer`
- `overall_summary`
- `created_at`
- `updated_at`

Индекс:

- `idx_interview_answer_evaluations_session_id (session_id)`

## Search and Semantic Expansion

Текущий поиск строится так:

1. исходные данные лежат в `notes` и `attachments`
2. нормализованные куски лежат в `note_chunks`
3. быстрый текстовый поиск работает через `note_chunks_fts`

Схема уже подготовлена под embeddings:

- `note_chunks.id` — стабильный ключ
- `embedding_status` — какие chunks уже обработаны
- `embedding_model` — чем считались embeddings
- `embedding_checksum` — помогает понимать, что embedding устарел
- `embedding_updated_at` — когда chunk был векторизован

Это позволяет позже добавить hybrid search без перестройки основной БД.
