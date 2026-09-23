#!/usr/bin/env bash
# validate.sh — Offline validation of the DocuCentral contribution package.
#
# Runs without a Nuxeo server: checks XML well-formedness, JSON/CSV integrity,
# manifest/component consistency and Web UI element wiring. Use it as the
# pre-deploy gate and in CI.
#
# Usage:
#   ./scripts/validate.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
RES_DIR="$PROJECT_DIR/src/main/resources"

PASS=0
FAIL=0

ok()   { printf "  [ok]   %s\n" "$1"; PASS=$((PASS + 1)); }
bad()  { printf "  [FAIL] %s\n" "$1"; FAIL=$((FAIL + 1)); }

echo "================================================================"
echo " DocuCentral — offline package validation"
echo " Package: $RES_DIR"
echo "================================================================"

# ── 1. XML well-formedness ───────────────────────────────────────────────────
echo ""
echo "[1/6] XML well-formedness"
while IFS= read -r xml; do
  if python3 -c "import sys,xml.dom.minidom; xml.dom.minidom.parse(sys.argv[1])" "$xml" 2>/dev/null; then
    ok "${xml#$RES_DIR/}"
  else
    bad "${xml#$RES_DIR/} — not well-formed"
  fi
done < <(find "$RES_DIR" -name "*.xml" -o -name "*.xsd" | sort)

# ── 2. JSON validity ─────────────────────────────────────────────────────────
echo ""
echo "[2/6] JSON validity"
while IFS= read -r json; do
  if python3 -c "import sys,json; json.load(open(sys.argv[1]))" "$json" 2>/dev/null; then
    ok "${json#$RES_DIR/}"
  else
    bad "${json#$RES_DIR/} — invalid JSON"
  fi
done < <(find "$RES_DIR" -name "*.json" | sort)

# ── 3. Vocabulary CSV shape ──────────────────────────────────────────────────
echo ""
echo "[3/6] Vocabulary CSV files"
while IFS= read -r csv; do
  header=$(head -1 "$csv")
  if [[ "$header" == '"id","label","obsolete","ordering"' ]]; then
    rows=$(($(wc -l < "$csv") - 1))
    ok "${csv#$RES_DIR/} ($rows entries)"
  else
    bad "${csv#$RES_DIR/} — unexpected header: $header"
  fi
done < <(find "$RES_DIR/directories" -name "*.csv" 2>/dev/null | sort)

# ── 4. MANIFEST components resolve to files ──────────────────────────────────
echo ""
echo "[4/6] MANIFEST Nuxeo-Component entries"
components=$(python3 - "$RES_DIR/META-INF/MANIFEST.MF" <<'PY'
import re, sys
text = open(sys.argv[1]).read()
# Unfold continuation lines (a leading space continues the previous header)
text = re.sub(r"\n ", "", text)
for line in text.splitlines():
    if line.startswith("Nuxeo-Component:"):
        for comp in line.split(":", 1)[1].split(","):
            comp = comp.strip()
            if comp:
                print(comp)
PY
)
if [[ -z "$components" ]]; then
  bad "no Nuxeo-Component header found"
else
  while IFS= read -r comp; do
    if [[ -f "$RES_DIR/$comp" ]]; then
      ok "$comp"
    else
      bad "$comp — declared in MANIFEST.MF but missing on disk"
    fi
  done <<< "$components"
fi

# ── 5. Component <require> targets exist ─────────────────────────────────────
echo ""
echo "[5/6] Component dependencies"
# Parse the XML properly — grepping would also match <require> inside comments.
deps=$(python3 - "$RES_DIR/OSGI-INF" <<'PYDEPS'
import sys, pathlib, xml.etree.ElementTree as ET

declared, required = set(), set()
for path in sorted(pathlib.Path(sys.argv[1]).glob("*.xml")):
    root = ET.parse(path).getroot()
    if root.tag == "component" and root.get("name"):
        declared.add(root.get("name"))
    for req in root.findall("require"):
        if req.text and req.text.strip():
            required.add(req.text.strip())

for name in sorted(declared):
    print("DECLARED\t" + name)
for name in sorted(required):
    print("REQUIRED\t" + name)
PYDEPS
)
declared=$(awk -F'\t' '$1=="DECLARED"{print $2}' <<< "$deps")
required=$(awk -F'\t' '$1=="REQUIRED"{print $2}' <<< "$deps")

while IFS= read -r req; do
  [[ -z "$req" ]] && continue
  if grep -qxF "$req" <<< "$declared"; then
    ok "require $req"
  else
    bad "require $req — no component declares this name"
  fi
done <<< "$required"

if [[ -n "$declared" ]]; then
  ok "$(grep -c . <<< "$declared") component(s) declared"
else
  bad "no <component name=...> declared under OSGI-INF/"
fi

# ── 6. Web UI bundle imports resolve ─────────────────────────────────────────
echo ""
echo "[6/6] Web UI bundle"
BUNDLE="$RES_DIR/ui/docucentral-bundle.html"
if [[ ! -f "$BUNDLE" ]]; then
  bad "ui/docucentral-bundle.html missing"
else
  while IFS= read -r href; do
    if [[ -f "$RES_DIR/ui/$href" ]]; then
      # every imported file must declare a dom-module
      if grep -q "<dom-module id=" "$RES_DIR/ui/$href"; then
        ok "ui/$href"
      else
        bad "ui/$href — no <dom-module id=...> declared"
      fi
    else
      bad "ui/$href — imported by the bundle but missing on disk"
    fi
  done < <(grep -oP '(?<=href=")[^"]+' "$BUNDLE")

  # the bundle itself must be registered with the WebResources service
  if grep -q "docucentral-bundle.html" "$RES_DIR/OSGI-INF/docucentral-ui-contrib.xml" 2>/dev/null; then
    ok "bundle registered with org.nuxeo.ecm.platform.WebResources"
  else
    bad "bundle is not registered with the WebResources service"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "================================================================"
printf " Result: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "================================================================"
[[ "$FAIL" -eq 0 ]] || exit 1
