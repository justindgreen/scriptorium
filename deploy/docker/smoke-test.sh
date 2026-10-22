#!/usr/bin/env bash
# Install smoke test for the built image (docs/DEPLOYMENT.md): fresh Compose stack -> readiness ->
# setup wizard through the API -> seeded content -> backup inside the container -> restart ->
# verified restore into the running stack -> teardown. Exits non-zero on the first failed check.
#
#   docker build -f deploy/docker/Dockerfile -t scriptorium:local .
#   bash deploy/docker/smoke-test.sh
set -uo pipefail
cd "$(dirname "$0")/../.."

export APP_SECRET="${APP_SECRET:-smoke-secret-smoke-secret-smoke-secret-0000}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-smoke-db-password}"
export PORT="${SMOKE_PORT:-3200}"
export PUBLIC_URL="http://localhost:${PORT}"
export BACKUP_RETENTION=5
P=scriptorium-smoke
COMPOSE="docker compose -p $P -f deploy/docker/compose.yml"
BASE="http://localhost:${PORT}"
COOKIES="$(mktemp)"
FAILED=0

check() { # check <label> <haystack> <needle>
  if printf '%s' "$2" | grep -q -- "$3"; then echo "ok   $1"; else echo "FAIL $1: expected '$3' in: $(printf '%s' "$2" | cut -c1-200)"; FAILED=1; fi
}
wait_ready() { for _ in $(seq 1 90); do curl -sf "$BASE/readyz" >/dev/null 2>&1 && return 0; sleep 2; done; echo "FAIL readiness timeout"; FAILED=1; }
cleanup() { $COMPOSE down -v --remove-orphans >/dev/null 2>&1 || true; rm -f "$COOKIES"; }
trap cleanup EXIT

echo "### fresh stack"
cleanup
$COMPOSE up -d --no-build
wait_ready
check "readiness" "$(curl -s "$BASE/readyz")" '"database":"ok"'
check "setup pending on a fresh instance" "$(curl -s "$BASE/api/trpc/system.status")" '"setupComplete":false'

echo "### setup wizard through the API"
curl -s -c "$COOKIES" -H 'content-type: application/json' -X POST "$BASE/api/trpc/setup.createAdmin" \
  -d '{"instanceName":"Smoke Table","displayName":"Game Master","username":"gamemaster","password":"correct-horse-battery"}' >/dev/null
check "administrator signed in" "$(curl -s -b "$COOKIES" "$BASE/api/trpc/me.get")" '"role":"admin"'
check "SRD attribution present" "$(curl -s "$BASE/api/trpc/content.licenses")" 'System Reference Document 5.1'
check "SRD spells seeded" "$(curl -s -b "$COOKIES" "$BASE/api/trpc/content.entries.list?input=%7B%22kind%22%3A%22spell%22%2C%22limit%22%3A1%7D")" '"total":319'

echo "### backup inside the container"
check "backup created" "$(docker exec "$P-app-1" scriptorium backup 2>&1)" 'written to /data/backups/'

echo "### restart keeps data and sessions"
$COMPOSE restart app >/dev/null 2>&1
wait_ready
check "session valid after restart" "$(curl -s -b "$COOKIES" "$BASE/api/trpc/me.get")" '"username":"gamemaster"'

echo "### verified restore into the running stack"
check "backup verifies" "$(docker exec "$P-app-1" sh -c 'scriptorium verify-backup "/data/backups/$(ls /data/backups | tail -1)"' 2>&1)" 'backup verified'
check "restore completes" "$(docker exec "$P-app-1" sh -c 'scriptorium restore "/data/backups/$(ls /data/backups | tail -1)"' 2>&1)" 'restored backup from'
sleep 2
check "session valid after restore" "$(curl -s -b "$COOKIES" "$BASE/api/trpc/me.get")" '"username":"gamemaster"'
check "ready after restore" "$(curl -s "$BASE/readyz")" '"status":"ok"'
check "runs as the node user" "$(docker exec "$P-app-1" id -u)" '^1000$'

echo "### image"
docker images scriptorium:local --format 'image size: {{.Size}}'
if [ "$FAILED" -ne 0 ]; then echo "SMOKE FAILED"; $COMPOSE logs app --tail 40; exit 1; fi
echo "SMOKE PASSED"
