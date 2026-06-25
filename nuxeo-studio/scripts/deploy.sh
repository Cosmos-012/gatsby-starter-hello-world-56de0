#!/usr/bin/env bash
# deploy.sh — Build and deploy the Nuxeo plugin to a local Nuxeo server
#
# Usage:
#   ./scripts/deploy.sh              (build + hot reload via REST API)
#   ./scripts/deploy.sh --copy-only  (build + copy JAR, no restart)
#   ./scripts/deploy.sh --restart    (build + copy JAR + restart Nuxeo)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_DIR/config/nuxeo-local.properties"

# Load config
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: config file not found at $CONFIG_FILE"
  exit 1
fi

# shellcheck disable=SC1090
source <(grep -v '^#' "$CONFIG_FILE" | grep -v '^$')

echo "================================================================"
echo " Nuxeo Studio Local - Deploy"
echo " Target: $NUXEO_URL"
echo "================================================================"
echo ""

# ── Step 1: Maven build ──────────────────────────────────────────────────────
echo "[1/3] Building Maven project..."
cd "$PROJECT_DIR"
mvn clean package -DskipTests -q
JAR_FILE=$(find target -name "*.jar" -not -name "*-sources.jar" | head -1)

if [[ -z "$JAR_FILE" ]]; then
  echo "Error: No JAR found in target/. Did the build succeed?"
  exit 1
fi
echo "  Built: $JAR_FILE"

# ── Step 2: Copy to Nuxeo bundles ────────────────────────────────────────────
if [[ "${1:-}" != "--hot-reload-only" ]]; then
  echo ""
  echo "[2/3] Copying bundle to Nuxeo..."

  if [[ -d "$NUXEO_BUNDLES_DIR" ]]; then
    cp "$JAR_FILE" "$NUXEO_BUNDLES_DIR/"
    echo "  Copied to: $NUXEO_BUNDLES_DIR/"
  else
    echo "  Warning: NUXEO_BUNDLES_DIR not found at $NUXEO_BUNDLES_DIR"
    echo "  Set NUXEO_HOME in config/nuxeo-local.properties"
    echo "  Skipping file copy — will attempt hot reload via API instead."
  fi
fi

# ── Step 3: Hot reload / restart ─────────────────────────────────────────────
echo ""
echo "[3/3] Triggering reload..."

case "${1:-}" in
  --copy-only)
    echo "  Copy-only mode: skipping reload."
    echo "  Restart Nuxeo manually to apply changes."
    ;;
  --restart)
    echo "  Restarting Nuxeo server..."
    if [[ -f "$NUXEO_HOME/bin/nuxeoctl" ]]; then
      "$NUXEO_HOME/bin/nuxeoctl" restartbg
      echo "  Nuxeo restarting in background."
    else
      echo "  nuxeoctl not found at $NUXEO_HOME/bin/nuxeoctl"
      echo "  Restart manually."
    fi
    ;;
  *)
    # Default: hot reload via REST API (requires org.nuxeo.dev=true in nuxeo.conf)
    RELOAD_URL="$NUXEO_URL/api/v1/automation/NuxeoCtl.HotReload"
    echo "  Hot reload via: $RELOAD_URL"
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST "$RELOAD_URL" \
      -H "Content-Type: application/json" \
      -u "$NUXEO_ADMIN_USER:$NUXEO_ADMIN_PASSWORD" \
      --max-time 30 \
      2>/dev/null)

    if [[ "$HTTP_STATUS" == "200" ]]; then
      echo "  Hot reload successful."
    elif [[ "$HTTP_STATUS" == "401" ]]; then
      echo "  Error 401: Check NUXEO_ADMIN_USER/PASSWORD in config."
    elif [[ "$HTTP_STATUS" == "000" ]]; then
      echo "  Cannot reach $NUXEO_URL — is Nuxeo running?"
    else
      echo "  Hot reload returned HTTP $HTTP_STATUS"
      echo "  Try: $0 --restart"
    fi
    ;;
esac

echo ""
echo "Deploy complete."
