#!/usr/bin/env bash
# Import websankul_staging.sql into the ws-mysql Docker container.
# Run from repo root:  ./scripts/mysql-import.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DUMP="${ROOT}/../websankul-staging/database/websankul_staging.sql"
PASSWORD="${MYSQL_ROOT_PASSWORD:-websankul_dev}"

if [[ ! -f "$DUMP" ]]; then
  echo "Dump not found: $DUMP" >&2
  exit 1
fi

cd "$ROOT"

echo "Starting ws-mysql (if not running)..."
docker compose up -d ws-mysql

echo "Waiting for MySQL to accept connections..."
for i in $(seq 1 60); do
  if docker compose exec -T ws-mysql mysqladmin ping -h localhost -uroot -p"${PASSWORD}" &>/dev/null; then
    break
  fi
  if [[ "$i" -eq 60 ]]; then
    echo "MySQL did not become ready in time. Check: docker compose logs ws-mysql" >&2
    exit 1
  fi
  sleep 2
done

echo "Recreating database websankul_staging..."
docker compose exec -T ws-mysql mysql -uroot -p"${PASSWORD}" <<'SQL'
DROP DATABASE IF EXISTS websankul_staging;
CREATE DATABASE websankul_staging CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
SQL

echo "Importing dump (this may take a few minutes)..."
docker compose exec -T ws-mysql mysql -uroot -p"${PASSWORD}" websankul_staging < "$DUMP"

echo "Import complete. Run: yarn db:verify"
