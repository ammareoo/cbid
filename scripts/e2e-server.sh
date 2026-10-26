#!/usr/bin/env bash
# Starts the API + built frontend for end-to-end tests against the dedicated e2e database.
set -euo pipefail
PORT="${1:-4100}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE/backend"
export NODE_ENV=test PORT="$PORT" HOST=127.0.0.1 LOG_LEVEL=warn \
  DATABASE_URL="${E2E_DATABASE_URL:-postgres://cbid_app:app_dev_pw@localhost:5432/cbid_lms_e2e}" \
  DATABASE_OWNER_URL="${E2E_DATABASE_OWNER_URL:-postgres://cbid_owner:owner_dev_pw@localhost:5432/cbid_lms_e2e}" \
  APP_ORIGIN="http://localhost:$PORT" COOKIE_SECURE=false SERVE_STATIC_DIR="$HERE/frontend/dist" \
  UPLOAD_DIR="$(mktemp -d)" AUTH_RATE_LIMIT_PER_MINUTE=100 REDIS_URL=
exec npx tsx src/index.ts
