# Deployment

## Recommended free setup

Для этого проекта лучший бесплатный вариант без переработки базы и файлов — `GitHub + Oracle Cloud Always Free VM + GitHub Actions`.

Почему именно так:

- проект хранит SQLite-базу на диске;
- скриншоты лежат в `server/uploads`;
- большинству бесплатных PaaS не хватает постоянного файлового хранилища.

В этой конфигурации:

- GitHub хранит код;
- GitHub Actions собирает проект на каждый push в `main`;
- workflow заливает код на VM по SSH;
- на VM `docker compose` пересобирает контейнеры;
- `Caddy` бесплатно поднимает HTTPS для твоего домена.

## Что уже настроено в репозитории

- `Dockerfile` — production image приложения;
- `docker-compose.yml` — приложение + `Caddy`;
- `deploy/Caddyfile` — HTTPS reverse proxy;
- `deploy/remote-deploy.sh` — удалённый деплой на VM;
- `.github/workflows/ci-cd.yml` — CI/CD на push в `main`.

## Что нужно сделать один раз

### 1. Создать GitHub-репозиторий

Создай пустой репозиторий на GitHub и запомни его SSH или HTTPS URL.

### 2. Поднять бесплатную VM

Рекомендуемый вариант: `Oracle Cloud Always Free` Ubuntu VM.

На VM понадобятся:

- `git`
- `docker`
- `docker compose`
- открытые порты `80` и `443`

### 3. Привязать домен

Для HTTPS тебе нужен домен. Самый простой бесплатный вариант — поддомен `DuckDNS`.

Примеры:

- `my-interviewer.duckdns.org`

Запиши A-record или настрой DuckDNS так, чтобы домен смотрел на публичный IP VM.

### 4. Подготовить `.env` на сервере

В каталоге приложения на VM должны лежать 2 файла.

Корневой `.env`:

```env
APP_DOMAIN=my-interviewer.duckdns.org
```

`server/.env`:

```env
PORT=3000
CLIENT_ORIGIN=https://my-interviewer.duckdns.org

AI_PRIMARY_PROVIDER=gemini
AI_FALLBACK_PROVIDER=groq

GEMINI_API_KEY=your_gemini_key
GEMINI_DOH_URL=https://dns.comss.one/dns-query
GEMINI_DNS_SERVERS=
GEMINI_VISION_MODEL=gemini-2.5-flash
GEMINI_INTERVIEW_QUESTION_MODEL=gemini-3.1-flash-lite-preview
GEMINI_INTERVIEW_EVALUATION_MODEL=gemini-3.1-flash-lite-preview

GROQ_API_KEY=your_groq_key
GROQ_VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
GROQ_INTERVIEW_QUESTION_MODEL=openai/gpt-oss-20b
GROQ_INTERVIEW_EVALUATION_MODEL=openai/gpt-oss-20b

OPENAI_INTERVIEW_CONTEXT_MAX_CHARS=12000
```

### 5. Добавить GitHub Secrets

В репозитории GitHub открой `Settings -> Secrets and variables -> Actions` и создай:

- `DEPLOY_HOST` — IP или домен VM
- `DEPLOY_PORT` — обычно `22`
- `DEPLOY_USER` — пользователь на VM
- `DEPLOY_PATH` — путь к приложению, например `/opt/programming-interviewer`
- `DEPLOY_SSH_KEY` — приватный SSH-ключ, которым Actions будет заходить на VM

## Первый запуск на сервере

После того как каталог приложения появился на сервере:

```bash
cd /opt/programming-interviewer
chmod +x deploy/remote-deploy.sh
./deploy/remote-deploy.sh
```

Это создаст папки для БД и скриншотов и поднимет контейнеры.

## Как работает автодеплой

1. Ты пушишь изменения в `main`.
2. GitHub Actions запускает `npm ci` и `npm run build`.
3. Если сборка успешна, workflow синхронизирует код на VM.
4. На VM выполняется `docker compose up -d --build --remove-orphans`.
5. `Caddy` продолжает держать HTTPS, а приложение обновляется автоматически.

## Полезные команды на сервере

Логи:

```bash
docker compose logs -f
```

Перезапуск:

```bash
docker compose up -d --build
```

Остановка:

```bash
docker compose down
```

## Ограничения

- Я не могу за тебя создать GitHub-репозиторий, VM, домен и secrets.
- Если домен не указывает на VM, `Caddy` не сможет получить HTTPS-сертификат.
- Если захочешь полностью без домена, приложение можно запустить и без `Caddy`, но голосовой ввод и доступ к микрофону в браузере будут работать хуже из-за отсутствия HTTPS.
