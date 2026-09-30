#!/usr/bin/env bash
# scripts/redis-flush-all.sh
#
# FLUSHALL on the Redis configured in .env (REDIS_HOST/REDIS_PORT/REDIS_PASSWORD).
# Wipes EVERYTHING — route/cache-aside caches AND BullMQ queues (bull:*),
# customer_session:*, entitlement_fp:*, video-resolve:*, guest sessions,
# token revocations. Takes an RDB snapshot first so it can be restored.
#
# Usage: bash scripts/redis-flush-all.sh [-y]   (-y skips the confirmation)
set -euo pipefail

cd "$(dirname "$0")/.."
env_val() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d "\"'"; }

HOST="$(env_val REDIS_HOST)"; HOST="${HOST:-localhost}"
PORT="$(env_val REDIS_PORT)"; PORT="${PORT:-6379}"
export REDISCLI_AUTH="$(env_val REDIS_PASSWORD)"
R=(redis-cli -h "$HOST" -p "$PORT")

echo "Redis ${HOST}:${PORT} — keys: $("${R[@]}" dbsize)"
"${R[@]}" --scan | awk -F: '{print $1":"$2}' | sort | uniq -c | sort -rn | head -15

BACKUP_DIR="backups/redis"; mkdir -p "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/pre-flush-$(date +%Y%m%d-%H%M%S).rdb"
"${R[@]}" --rdb "$BACKUP" >/dev/null
echo "Backup: $BACKUP ($(du -h "$BACKUP" | cut -f1))"

if [[ "${1:-}" != "-y" ]]; then
  read -r -p "Type FLUSHALL to wipe ${HOST}:${PORT}: " ans
  [[ "$ans" == "FLUSHALL" ]] || { echo "Aborted."; exit 1; }
fi

"${R[@]}" flushall
echo "Done — keys now: $("${R[@]}" dbsize)"
