#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${APP_DIR}"

mkdir -p server/data server/uploads

if [[ ! -f ".env" ]]; then
  echo "Missing root .env with APP_DOMAIN."
  exit 1
fi

if [[ ! -f "server/.env" ]]; then
  echo "Missing server/.env with runtime secrets."
  exit 1
fi

docker compose up -d --build --remove-orphans
