# Deployment

## Recommended setup

Для текущего проекта рекомендованный вариант деплоя — `GitHub + Amvera`.

Почему:

- проект хранит SQLite на диске;
- скриншоты лежат в `server/uploads`;
- Amvera поддерживает `Dockerfile`, git-репозиторий и постоянное хранилище;
- не нужно поднимать отдельную VM.

Подробный пошаговый деплой:

- [AMVERA_DEPLOYMENT.md](./AMVERA_DEPLOYMENT.md)

## Что уже есть в репозитории

- `Dockerfile`
- `amvera.yml`
- `.github/workflows/ci-cd.yml`

## Что осталось сделать вручную

- создать проект в Amvera;
- привязать GitHub-репозиторий;
- создать переменные и секреты;
- включить бесплатный домен Amvera или привязать свой домен;
- дождаться первого деплоя.

## Legacy

Старая инструкция под самостоятельную VM сохранена здесь:

- [ORACLE_VM_SETUP.md](./ORACLE_VM_SETUP.md)
