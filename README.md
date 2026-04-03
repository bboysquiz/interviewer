# Programming Interviewer

Личное fullstack-приложение для подготовки к техническим собеседованиям:

- темы и заметки в стиле iPhone Notes;
- текст и скриншоты в одном полотне;
- OCR и поиск по содержимому скриншотов;
- генерация вопросов и проверка ответов;
- история тренировок.

## Стек

- Frontend: `Vue 3 + Vite + Pinia + Vue Router`
- Backend: `Express + SQLite`
- Хранение файлов: `server/uploads`
- AI: `Gemini` с fallback на `Groq`

## Локальный запуск

1. Установить зависимости:

```bash
npm install
```

2. Создать env-файлы:

```bash
cp .env.example .env
cp server/.env.example server/.env
```

3. При необходимости добавить ключи в `server/.env`.

4. Запустить проект:

```bash
npm run dev
```

5. Открыть:

- frontend: `http://localhost:5173`
- backend health: `http://localhost:3000/api/health`

## Production

В репозитории уже подготовлены:

- `Dockerfile`
- `docker-compose.yml`
- `.github/workflows/ci-cd.yml`
- `deploy/Caddyfile`
- `deploy/remote-deploy.sh`

Рекомендуемый бесплатный прод-стек:

- `GitHub`
- `Oracle Cloud Always Free VM`
- `GitHub Actions`
- `Caddy` для HTTPS

Подробная инструкция: [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

## Скрипты

- `npm run dev` — frontend + backend
- `npm run dev:client` — только Vite
- `npm run dev:server` — только backend
- `npm run build` — production build frontend и backend
- `npm run start` — запуск production backend, который раздаёт и собранный frontend

## Структура env

- [`.env.example`](./.env.example)
- [`server/.env.example`](./server/.env.example)
- [`docs/ENVIRONMENT.md`](./docs/ENVIRONMENT.md)
