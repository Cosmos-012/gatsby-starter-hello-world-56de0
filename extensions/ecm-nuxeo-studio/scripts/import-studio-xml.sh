#!/usr/bin/env bash
# import-studio-xml.sh — Merge a Community Cookbook module's modeler XML into
# the local DocuCentral bundle.
#
# Note: stock Nuxeo has no REST operation that registers an XML extension at
# runtime (the previous `ExtendedXml.Import` call in this script targeted an
# operation that does not exist). XML contributions must ship inside a bundle,
# so this script copies the module XML into OSGI-INF/, wraps it in a component
# if needed, registers it in MANIFEST.MF, and leaves you one `deploy.sh` away
# from a running change.
#
# Usage:
#   ./scripts/import-studio-xml.sh <module-name>
#   ./scripts/import-studio-xml.sh workflow-status
#   ./scripts/import-studio-xml.sh --dry-run workflow-status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODULES_DIR="$PROJECT_DIR/modules"
RES_DIR="$PROJECT_DIR/src/main/resources"
OSGI_DIR="$RES_DIR/OSGI-INF"
MANIFEST="$RES_DIR/META-INF/MANIFEST.MF"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  shift
fi

MODULE="${1:-}"
if [[ -z "$MODULE" ]]; then
  echo "Usage: $0 [--dry-run] <module-name>"
  echo "Run ./scripts/fetch-module.sh --list to see available modules."
  exit 1
fi

MODULE_DIR="$MODULES_DIR/$MODULE"
if [[ ! -d "$MODULE_DIR" ]]; then
  echo "Module not found locally. Fetching first..."
  "$SCRIPT_DIR/fetch-module.sh" "$MODULE"
fi

mapfile -t XML_FILES < <(find "$MODULE_DIR/modeler" -name "*.xml" 2>/dev/null | sort)
if [[ ${#XML_FILES[@]} -eq 0 ]]; then
  echo "No modeler XML files found under $MODULE_DIR/modeler/."
  exit 1
fi

SAFE_NAME=$(echo "$MODULE" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9' '-' | sed 's/-\+/-/g; s/^-//; s/-$//')
TARGET="$OSGI_DIR/cookbook-$SAFE_NAME-contrib.xml"
COMPONENT="com.project.nuxeo.cookbook.$SAFE_NAME"

echo "Module:    $MODULE"
echo "Component: $COMPONENT"
echo "Target:    ${TARGET#$PROJECT_DIR/}"
echo "Sources:   ${#XML_FILES[@]} modeler XML file(s)"
echo ""

# Cookbook modeler files are usually bare <extension> fragments; wrap them in a
# <component> so the result is a loadable Nuxeo contribution.
TMP=$(mktemp)
{
  echo '<?xml version="1.0"?>'
  echo "<!-- Imported from the Nuxeo Studio Community Cookbook module: $MODULE"
  echo "     Source: modules/$MODULE/modeler/  —  regenerate with scripts/import-studio-xml.sh -->"
  echo "<component name=\"$COMPONENT\">"
  echo ""
  for xml_file in "${XML_FILES[@]}"; do
    echo "  <!-- $(basename "$xml_file") -->"
    # Strip any XML declaration and an outer <component> wrapper if present.
    python3 - "$xml_file" <<'PY'
import re, sys
raw = open(sys.argv[1], encoding="utf-8").read()
raw = re.sub(r"<\?xml[^?]*\?>", "", raw).strip()
match = re.match(r"^<component\b[^>]*>(.*)</component>\s*$", raw, re.DOTALL)
if match:
    raw = match.group(1).strip()
print("\n".join("  " + line if line.strip() else line for line in raw.splitlines()))
PY
    echo ""
  done
  echo "</component>"
} > "$TMP"

if ! python3 -c "import sys,xml.dom.minidom; xml.dom.minidom.parse(sys.argv[1])" "$TMP" 2>/dev/null; then
  echo "The merged result is not well-formed XML — not writing it."
  echo "Inspect the draft at: $TMP"
  exit 1
fi
echo "Merged XML is well-formed."

if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "--- dry run, would write ---"
  cat "$TMP"
  rm -f "$TMP"
  exit 0
fi

mv "$TMP" "$TARGET"
echo "Wrote ${TARGET#$PROJECT_DIR/}"

# Register the component in the manifest if it is not already listed.
COMP_PATH="OSGI-INF/$(basename "$TARGET")"
if grep -q "$COMP_PATH" "$MANIFEST"; then
  echo "Already registered in MANIFEST.MF."
else
  python3 - "$MANIFEST" "$COMP_PATH" <<'PY'
import sys
manifest, comp = sys.argv[1], sys.argv[2]
lines = open(manifest).read().rstrip("\n").split("\n")
out, done = [], False
for i, line in enumerate(lines):
    is_last_component_line = (
        not done
        and (line.startswith("Nuxeo-Component:") or line.startswith(" "))
        and (i + 1 == len(lines) or not lines[i + 1].startswith(" "))
    )
    if is_last_component_line:
        out.append(line + ",")
        out.append(" " + comp)
        done = True
    else:
        out.append(line)
if not done:
    out.append("Nuxeo-Component: " + comp)
open(manifest, "w").write("\n".join(out) + "\n")
PY
  echo "Registered $COMP_PATH in MANIFEST.MF."
fi

DESIGNER_DIR="$MODULE_DIR/designer"
if [[ -d "$DESIGNER_DIR" ]]; then
  echo ""
  echo "This module also ships Web UI resources under modules/$MODULE/designer/."
  echo "Copy the HTML into src/main/resources/ui/ and add an import line to"
  echo "ui/docucentral-bundle.html if you want them loaded."
fi

echo ""
echo "Next: ./scripts/validate.sh && ./scripts/deploy.sh"
