#!/usr/bin/env bash
# Sul server: aggiorna il codice e riavvia i container. Uso: ./deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
docker image prune -f
