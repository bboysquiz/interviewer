# Environment Variables

Ниже перечислены все переменные окружения, которые нужны для локального запуска.

## Frontend

Файл: [`.env`](../.env)

Создаётся из [`.env.example`](../.env.example).

| Переменная | Обязательная | Значение по умолчанию | Назначение |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | да | `http://localhost:3000` | Base URL backend API для Vite-клиента |

## Backend

Файл: [`server/.env`](../server/.env)

Создаётся из [`server/.env.example`](../server/.env.example).

Backend автоматически загружает сначала корневой `.env`, затем `server/.env`. Значения из `server/.env` имеют приоритет.

| Переменная | Обязательная | Значение по умолчанию | Назначение |
| --- | --- | --- | --- |
| `PORT` | нет | `3000` | Порт Express backend |
| `CLIENT_ORIGIN` | нет | `http://localhost:5173` | Origin frontend для CORS |
| `DATABASE_PATH` | нет | `server/data/app.db` | Путь к SQLite базе |
| `UPLOADS_DIR` | нет | `server/uploads` | Папка для загруженных изображений |
| `OPENAI_API_KEY` | для AI | пусто | API key OpenAI |
| `OPENAI_IMAGE_ANALYSIS_MODEL` | нет | `gpt-4.1-mini` | Модель для анализа изображений |
| `OPENAI_INTERVIEW_QUESTION_MODEL` | нет | `gpt-4.1-mini` | Модель для генерации вопроса |
| `OPENAI_INTERVIEW_EVALUATION_MODEL` | нет | `gpt-4.1-mini` | Модель для проверки ответа |
| `OPENAI_INTERVIEW_CONTEXT_MAX_CHARS` | нет | `12000` | Максимальный размер grounded context для interview prompts |

## Минимальный набор для локального старта

Без AI:

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
```

С AI:

```bash
# server/.env
OPENAI_API_KEY=your_openai_key
OPENAI_IMAGE_ANALYSIS_MODEL=gpt-4.1-mini
OPENAI_INTERVIEW_QUESTION_MODEL=gpt-4.1-mini
OPENAI_INTERVIEW_EVALUATION_MODEL=gpt-4.1-mini
OPENAI_INTERVIEW_CONTEXT_MAX_CHARS=12000
```
