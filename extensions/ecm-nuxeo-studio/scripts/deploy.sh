#!/usr/bin/env bash
# deploy.sh — Build and deploy the DocuCentral bundle to a local Nuxeo server.
#
# Usage:
#   ./scripts/deploy.sh              build + copy JAR + copy UI assets + dev hot reload
#   ./scripts/deploy.sh --copy-only  build + copy, no reload
#   ./scripts/deploy.sh --restart    build + copy + restart Nuxeo
#   ./scripts/deploy.sh --skip-validate   skip the offline validation gate
#
# Hot reload uses Nuxeo's dev-mode bundle watcher ($NUXEO_HOME/nxserver/dev.bundles),
# which is the supported local mechanism when nuxeo.conf contains org.nuxeo.dev=true.

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

MODE="${1:-}"

echo "================================================================"
echo " DocuCentral — Deploy"
echo " Target: $NUXEO_URL"
echo "================================================================"

# ── Step 0: offline validation gate ──────────────────────────────────────────
if [[ "$MODE" != "--skip-validate" ]]; then
  echo ""
  echo "[0/4] Validating package..."
  if ! "$SCRIPT_DIR/validate.sh" > /tmp/docucentral-validate.log 2>&1; then
    echo "  Validation FAILED — deployment aborted."
    echo ""
    grep -E '\[FAIL\]|Result:' /tmp/docucentral-validate.log || cat /tmp/docucentral-validate.log
    exit 1
  fi
  echo "  $(grep 'Result:' /tmp/docucentral-validate.log | sed 's/^ *//')"
fi

# ── Step 1: Maven build ──────────────────────────────────────────────────────
echo ""
echo "[1/4] Building Maven project..."
cd "$PROJECT_DIR"
mvn clean package -DskipTests -q
JAR_FILE=$(find target -name "*.jar" -not -name "*-sources.jar" | head -1)

if [[ -z "$JAR_FILE" ]]; then
  echo "Error: No JAR found in target/. Did the build succeed?"
  exit 1
fi
JAR_ABS="$PROJECT_DIR/$JAR_FILE"
echo "  Built: $JAR_FILE"

# Verify the Nuxeo-Component header actually made it into the JAR.
if unzip -p "$JAR_ABS" META-INF/MANIFEST.MF 2>/dev/null | grep -q "Nuxeo-Component"; then
  echo "  Manifest OK: Nuxeo-Component header present."
else
  echo "  Error: built JAR has no Nuxeo-Component header — Nuxeo would ignore it."
  exit 1
fi

# ── Step 2: Copy bundle ──────────────────────────────────────────────────────
echo ""
echo "[2/4] Copying bundle to Nuxeo..."
if [[ -d "$NUXEO_BUNDLES_DIR" ]]; then
  cp "$JAR_ABS" "$NUXEO_BUNDLES_DIR/"
  echo "  Copied to: $NUXEO_BUNDLES_DIR/"
else
  echo "  Warning: NUXEO_BUNDLES_DIR not found at $NUXEO_BUNDLES_DIR"
  echo "  Set NUXEO_HOME in config/nuxeo-local.properties"
fi

# ── Step 3: Copy Web UI assets ───────────────────────────────────────────────
echo ""
echo "[3/4] Copying Web UI assets..."
WEB_UI_DIR="$NUXEO_HOME/nxserver/nuxeo.war/ui"
if [[ -d "$WEB_UI_DIR" ]]; then
  cp "$PROJECT_DIR/src/main/resources/ui/docucentral-bundle.html" "$WEB_UI_DIR/"
  mkdir -p "$WEB_UI_DIR/docucentral"
  cp "$PROJECT_DIR"/src/main/resources/ui/docucentral/*.html "$WEB_UI_DIR/docucentral/"
  echo "  Copied elements to: $WEB_UI_DIR/docucentral/"

  # Merge the DocuCentral labels into the Web UI message catalog (backed up first).
  MESSAGES="$WEB_UI_DIR/i18n/messages.json"
  if [[ -f "$MESSAGES" ]]; then
    cp "$MESSAGES" "$MESSAGES.bak-$(date +%Y%m%d-%H%M%S)"
    python3 - "$MESSAGES" "$PROJECT_DIR/src/main/resources/i18n/messages.json" <<'PY'
import json, sys
target, source = sys.argv[1], sys.argv[2]
with open(target) as f:
    catalog = json.load(f)
with open(source) as f:
    catalog.update(json.load(f))
with open(target, "w") as f:
    json.dump(catalog, f, indent=2, ensure_ascii=False, sort_keys=True)
print("  Merged %d DocuCentral labels into the Web UI catalog." % len(json.load(open(source))))
PY
  else
    echo "  Note: $MESSAGES not found — copy src/main/resources/i18n/messages.json manually."
  fi
else
  echo "  Warning: Web UI folder not found at $WEB_UI_DIR — skipping UI assets."
fi

# ── Step 4: Reload ───────────────────────────────────────────────────────────
echo ""
echo "[4/4] Reloading..."

case "$MODE" in
  --copy-only)
    echo "  Copy-only mode: skipping reload. Restart Nuxeo to apply."
    ;;
  --restart)
    if [[ -x "$NUXEO_HOME/bin/nuxeoctl" ]]; then
      "$NUXEO_HOME/bin/nuxeoctl" restartbg
      echo "  Nuxeo restarting in background."
    else
      echo "  nuxeoctl not found at $NUXEO_HOME/bin/nuxeoctl — restart manually."
    fi
    ;;
  *)
    # Dev-mode hot reload: Nuxeo watches nxserver/dev.bundles when
    # org.nuxeo.dev=true and reloads the listed paths on change.
    DEV_BUNDLES="$NUXEO_HOME/nxserver/dev.bundles"
    if [[ "$HOT_RELOAD_ENABLED" != "true" ]]; then
      echo "  HOT_RELOAD_ENABLED=false in config — restart Nuxeo to apply."
    elif [[ -d "$(dirname "$DEV_BUNDLES")" ]]; then
      TARGET_JAR="$NUXEO_BUNDLES_DIR/$(basename "$JAR_ABS")"
      {
        echo "# Written by DocuCentral deploy.sh on $(date -Iseconds)"
        echo "bundle:$TARGET_JAR"
      } > "$DEV_BUNDLES"
      touch "$DEV_BUNDLES"
      echo "  Wrote $DEV_BUNDLES — Nuxeo dev mode reloads within a few seconds."
      echo "  Requires org.nuxeo.dev=true in nuxeo.conf."
    else
      echo "  $NUXEO_HOME/nxserver not found — cannot trigger dev hot reload."
      echo "  Use: $0 --restart"
    fi
    ;;
esac

echo ""
echo "Deploy complete. Verify with: ./scripts/docucentral-smoke-test.sh"
