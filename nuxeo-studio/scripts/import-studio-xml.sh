#!/usr/bin/env bash
# import-studio-xml.sh — Import an XML extension into the local Nuxeo server
#                         via the REST API (no rebuild needed)
#
# Usage:
#   ./scripts/import-studio-xml.sh <module-name>
#   ./scripts/import-studio-xml.sh workflow-status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_DIR/config/nuxeo-local.properties"
MODULES_DIR="$PROJECT_DIR/modules"

# Load config
source <(grep -v '^#' "$CONFIG_FILE" | grep -v '^$')

MODULE="${1:-}"
if [[ -z "$MODULE" ]]; then
  echo "Usage: $0 <module-name>"
  echo "Run ./scripts/fetch-module.sh --list to see available modules."
  exit 1
fi

MODULE_DIR="$MODULES_DIR/$MODULE"
if [[ ! -d "$MODULE_DIR" ]]; then
  echo "Module not found locally. Fetching first..."
  "$SCRIPT_DIR/fetch-module.sh" "$MODULE"
fi

# Find modeler XML files
XML_FILES=($(find "$MODULE_DIR/modeler" -name "*.xml" 2>/dev/null || true))

if [[ ${#XML_FILES[@]} -eq 0 ]]; then
  echo "No modeler XML files found for module '$MODULE'."
  echo "Check $MODULE_DIR/modeler/"
  exit 1
fi

echo "Importing $MODULE XML contributions to $NUXEO_URL..."

for xml_file in "${XML_FILES[@]}"; do
  filename=$(basename "$xml_file")
  echo "  Uploading: $filename"

  HTTP_STATUS=$(curl -s -o /tmp/nuxeo-import-response.json -w "%{http_code}" \
    -X POST "$NUXEO_URL/api/v1/automation/ExtendedXml.Import" \
    -H "Content-Type: application/json" \
    -u "$NUXEO_ADMIN_USER:$NUXEO_ADMIN_PASSWORD" \
    --data-binary @"$xml_file" \
    --max-time 30)

  if [[ "$HTTP_STATUS" == "200" ]]; then
    echo "    [ok] $filename imported"
  else
    echo "    [warn] HTTP $HTTP_STATUS for $filename"
    cat /tmp/nuxeo-import-response.json 2>/dev/null || true
  fi
done

echo ""
echo "Done. Check Nuxeo Admin > Configuration for applied contributions."
