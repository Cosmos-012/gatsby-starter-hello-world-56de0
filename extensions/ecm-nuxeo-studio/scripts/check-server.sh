#!/usr/bin/env bash
# check-server.sh — Verify local Nuxeo server is running and accessible
#
# Usage:
#   ./scripts/check-server.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_DIR/config/nuxeo-local.properties"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: config file not found at $CONFIG_FILE"
  echo "First run: cp config/nuxeo-local.properties.template config/nuxeo-local.properties"
  echo "then edit it to match your local Nuxeo setup."
  exit 1
fi

# shellcheck disable=SC1090
source <(grep -v '^#' "$CONFIG_FILE" | grep -v '^$')

echo "Checking Nuxeo server at $NUXEO_URL ..."
echo ""

# Ping endpoint
HTTP_STATUS=$(curl -s -o /tmp/nuxeo-ping.json -w "%{http_code}" \
  "$NUXEO_URL/api/v1/automation/login" \
  -H "Content-Type: application/json" \
  -u "$NUXEO_ADMIN_USER:$NUXEO_ADMIN_PASSWORD" \
  --max-time 10 2>/dev/null) || HTTP_STATUS="000"

case "$HTTP_STATUS" in
  200)
    echo "  [OK] Server is running and credentials are valid."
    VERSION=$(curl -s "$NUXEO_URL/api/v1/server/info" \
      -u "$NUXEO_ADMIN_USER:$NUXEO_ADMIN_PASSWORD" 2>/dev/null \
      | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('distributionName','?'), d.get('distributionVersion','?'))" 2>/dev/null || echo "unknown")
    echo "  Version: $VERSION"
    ;;
  401)
    echo "  [FAIL] Server responded with 401 Unauthorized."
    echo "  Check NUXEO_ADMIN_USER and NUXEO_ADMIN_PASSWORD in config/nuxeo-local.properties"
    exit 1
    ;;
  000)
    echo "  [FAIL] Cannot connect to $NUXEO_URL"
    echo "  Is Nuxeo running? Start it with: \$NUXEO_HOME/bin/nuxeoctl start"
    exit 1
    ;;
  *)
    echo "  [WARN] Unexpected HTTP $HTTP_STATUS"
    cat /tmp/nuxeo-ping.json 2>/dev/null || true
    exit 1
    ;;
esac

# Check hot reload
echo ""
echo "Checking hot reload (org.nuxeo.dev mode)..."

if [[ "$HOT_RELOAD_ENABLED" == "true" ]]; then
  echo "  Hot reload is configured (HOT_RELOAD_ENABLED=true in config)."
  echo "  Ensure nuxeo.conf contains: org.nuxeo.dev=true"
else
  echo "  Hot reload is disabled. Full restart needed for changes."
fi

echo ""
echo "Checking DocuCentral package..."
for type in DCControlledDocument DCLibrary; do
  TYPE_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "$NUXEO_URL/api/v1/config/types/$type" \
    -u "$NUXEO_ADMIN_USER:$NUXEO_ADMIN_PASSWORD" --max-time 10 2>/dev/null) || TYPE_STATUS="000"
  if [[ "$TYPE_STATUS" == "200" ]]; then
    echo "  [OK] document type $type is registered."
  else
    echo "  [--] document type $type not found (HTTP $TYPE_STATUS) — run ./scripts/deploy.sh"
  fi
done

echo ""
echo "Server check complete."
