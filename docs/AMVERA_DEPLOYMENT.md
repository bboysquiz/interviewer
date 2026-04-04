# Amvera Deployment

Эта инструкция рассчитана на текущий репозиторий без переделки архитектуры.

Что уже готово:

- приложение собирается из `Dockerfile`;
- frontend и backend работают с одного домена;
- SQLite и скриншоты могут жить в постоянном хранилище `/data`;
- CI в GitHub проверяет сборку и Docker image;
- для Amvera добавлен `amvera.yaml`.

## Стоимость

По официальным материалам Amvera на `3 апреля 2026`:

- `Пробный` — `170 ₽ / 30 дней`
- `Начальный` — `290 ₽ / 30 дней`

Для этого проекта я бы выбирал `Начальный`.

## Что важно про платформу

- Amvera поддерживает деплой из `Dockerfile`.
- `docker-compose.yml` там не используется.
- Постоянное хранилище подключается через `persistenceMount`.
- GitHub можно подключить как внешний репозиторий.
- Можно включить бесплатный HTTPS-домен Amvera.

## 1. Создай проект

В Amvera:

1. Создай новое приложение.
2. В качестве источника выбери Git.
3. Подключи GitHub-репозиторий.
4. Укажи ветку `main`.

## 2. Что уже настроено в коде

В [amvera.yaml](/s:/ProgrammingInterviewer/amvera.yaml):

- `containerPort: 3000`
- `persistenceMount: /data`

А сервер автоматически использует:

- `/data/app.db`
- `/data/uploads`

если запущен в Amvera и пути не переопределены вручную.

## 3. Создай переменные и секреты в Amvera

В разделе переменных добавь:

- `PORT=3000`
- `CLIENT_ORIGIN=https://твой-домен.amvera.io`
- `AI_PRIMARY_PROVIDER=gemini`
- `AI_FALLBACK_PROVIDER=groq`
- `GEMINI_DOH_URL=https://dns.comss.one/dns-query`
- `OPENAI_INTERVIEW_CONTEXT_MAX_CHARS=12000`

Секреты:

- `GEMINI_API_KEY`
- `GROQ_API_KEY`

Опционально:

- `GEMINI_VISION_MODEL=gemini-2.5-flash`
- `GEMINI_INTERVIEW_QUESTION_MODEL=gemini-3.1-flash-lite-preview`
- `GEMINI_INTERVIEW_EVALUATION_MODEL=gemini-3.1-flash-lite-preview`
- `GROQ_VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct`
- `GROQ_INTERVIEW_QUESTION_MODEL=openai/gpt-oss-20b`
- `GROQ_INTERVIEW_EVALUATION_MODEL=openai/gpt-oss-20b`

## 4. Включи домен

В разделе доменов или настроек проекта включи бесплатный домен Amvera.

После этого используй его URL в `CLIENT_ORIGIN`.

## 5. Первый деплой

После подключения GitHub и сохранения переменных Amvera должна сама начать сборку и выкладку.

Если нужно, запусти redeploy вручную из интерфейса проекта.

## 6. Настрой автосинхронизацию GitHub -> Amvera

Чтобы больше не делать `git push amvera ...` вручную, в GitHub репозитории добавь secrets:

- `AMVERA_GIT_URL`
- `AMVERA_GIT_USERNAME`
- `AMVERA_GIT_PASSWORD`

Значения:

- `AMVERA_GIT_URL` = `https://git.msk0.amvera.ru/ТВОЙ_ЛОГИН/ТВОЙ_ПРОЕКТ`
- `AMVERA_GIT_USERNAME` = твой логин Amvera
- `AMVERA_GIT_PASSWORD` = твой пароль Amvera

После этого workflow из [ci-cd.yml](/s:/ProgrammingInterviewer/.github/workflows/ci-cd.yml) будет:

1. собирать проект в GitHub Actions;
2. после успешной сборки пушить текущий commit из `main` в `master` репозитория Amvera.

Тогда обычный процесс станет таким:

```bash
git push origin main
```

И больше ничего руками пушить в Amvera не придётся.

## 7. Как будет работать автодеплой

Твой сценарий `push в GitHub -> деплой` здесь работает так:

1. Ты пушишь в `main`.
2. GitHub Actions проверяет `npm run build` и `docker build`.
3. GitHub Actions автоматически пушит этот commit в git-репозиторий Amvera.
4. Amvera видит новый commit у себя и запускает сборку/деплой.

То есть `CI` делает GitHub, а `CD` запускается через git-репозиторий Amvera.

## 8. Что проверить после выката

- открывается главная страница;
- заметки и категории создаются;
- скриншоты загружаются;
- после redeploy данные не пропадают.

Если данные пропадают после redeploy, значит приложение пишет не в `/data`.
