# Oracle VM Quickstart

Эта инструкция рассчитана на текущую конфигурацию проекта:

- код хранится на GitHub;
- GitHub Actions деплоит на сервер по SSH;
- на сервере проект поднимается через `docker compose`;
- HTTPS раздаёт `Caddy`.

## 1. Создай бесплатную VM в Oracle Cloud

Открой Oracle Cloud Console:

- `Compute`
- `Instances`
- `Create instance`

Рекомендуемые параметры:

- Name: `programming-interviewer`
- Image: `Ubuntu 24.04` или `Ubuntu 22.04`
- Shape: `VM.Standard.A1.Flex`
- OCPU: `2`
- Memory: `12 GB`
- Network: `Create new virtual cloud network`
- Subnet: `Create public subnet`
- Public IPv4: включить

Если `A1` недоступен по capacity, попробуй:

- другую availability domain;
- или повторить позже.

## 2. Сгенерируй SSH-ключ для входа

На Windows PowerShell:

```powershell
ssh-keygen -t ed25519 -C "oracle-vm" -f "$env:USERPROFILE\\.ssh\\oracle_vm_ed25519"
```

В Oracle при создании инстанса выбери:

- `Add SSH keys`
- `Upload public key files (.pub)`

и загрузи файл:

```text
C:\Users\ТВОЙ_ПОЛЬЗОВАТЕЛЬ\.ssh\oracle_vm_ed25519.pub
```

## 3. Открой нужные порты

После создания VM открой:

- `Networking`
- `Virtual cloud networks`
- VCN инстанса
- `Security Lists`
- security list для public subnet

Добавь ingress rules:

- TCP `22`
- TCP `80`
- TCP `443`

Для `22` безопаснее указать source не `0.0.0.0/0`, а свой текущий IP.

## 4. Подключись к серверу

Узнай публичный IP инстанса и подключись.

Для Ubuntu image:

```powershell
ssh -i "$env:USERPROFILE\\.ssh\\oracle_vm_ed25519" ubuntu@YOUR_VM_IP
```

Если выберешь Oracle Linux вместо Ubuntu, пользователь обычно `opc`.

## 5. Установи Docker и Compose

На сервере выполни:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```

Потом выйди из SSH и зайди снова.

Проверь:

```bash
docker --version
docker compose version
```

## 6. Подготовь каталог приложения

На сервере:

```bash
sudo mkdir -p /opt/programming-interviewer
sudo chown -R $USER:$USER /opt/programming-interviewer
cd /opt/programming-interviewer
mkdir -p server/data server/uploads
```

## 7. Заведи домен

Текущий деплой рассчитан на домен, потому что `Caddy` автоматически выдаёт HTTPS.

Самый простой бесплатный вариант:

- `DuckDNS`

Нужен домен вида:

```text
my-interviewer.duckdns.org
```

Он должен указывать на публичный IP Oracle VM.

## 8. Создай env-файлы на сервере

В `/opt/programming-interviewer/.env`:

```env
APP_DOMAIN=my-interviewer.duckdns.org
```

В `/opt/programming-interviewer/server/.env`:

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

## 9. Подготовь SSH-доступ для GitHub Actions

Создай отдельный ключ для деплоя на своей машине:

```powershell
ssh-keygen -t ed25519 -C "github-actions-deploy" -f "$env:USERPROFILE\\.ssh\\github_actions_deploy"
```

Добавь публичный ключ на сервер:

```powershell
type $env:USERPROFILE\.ssh\github_actions_deploy.pub
```

Скопируй вывод и на сервере добавь его в:

```bash
mkdir -p ~/.ssh
nano ~/.ssh/authorized_keys
```

Вставь ключ в новую строку, сохрани файл и выставь права:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

## 10. Добавь secrets в GitHub

В GitHub репозитории:

- `Settings`
- `Secrets and variables`
- `Actions`

Создай:

- `DEPLOY_HOST` = публичный IP VM
- `DEPLOY_PORT` = `22`
- `DEPLOY_USER` = `ubuntu`
- `DEPLOY_PATH` = `/opt/programming-interviewer`
- `DEPLOY_SSH_KEY` = содержимое файла `github_actions_deploy`

Приватный ключ можно вывести так:

```powershell
Get-Content "$env:USERPROFILE\\.ssh\\github_actions_deploy" -Raw
```

## 11. Первый деплой

После того как secrets добавлены, просто запушь новый commit в `main`.

Workflow:

- соберёт проект;
- подключится к VM;
- синхронизирует файлы;
- выполнит `deploy/remote-deploy.sh`;
- поднимет контейнеры.

## 12. Проверка

На сервере:

```bash
cd /opt/programming-interviewer
docker compose ps
docker compose logs -f
```

Если всё хорошо, приложение откроется по адресу:

```text
https://my-interviewer.duckdns.org
```
