#!/usr/bin/env bash
# docucentral-seed.sh — Provision the DocuCentral baseline on a local Nuxeo server:
# governance groups, the department library tree and a few demo documents.
#
# Idempotent: re-running it leaves an already-seeded server unchanged.
#
# Usage:
#   ./scripts/docucentral-seed.sh
#   ./scripts/docucentral-seed.sh --no-demo    groups + libraries only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$PROJECT_DIR/config/nuxeo-local.properties"

# shellcheck disable=SC1090
source <(grep -v '^#' "$CONFIG_FILE" | grep -v '^$')

API="$NUXEO_URL/api/v1"
AUTH=(-u "$NUXEO_ADMIN_USER:$NUXEO_ADMIN_PASSWORD")
JSON=(-H "Content-Type: application/json")
ROOT="/default-domain/workspaces"
LIBRARY_ROOT="$ROOT/docucentral"

# nx_post <path> <json-body> -> prints HTTP status
nx_post() {
  curl -s -o /tmp/docucentral-seed-response.json -w "%{http_code}" \
    -X POST "$API$1" "${AUTH[@]}" "${JSON[@]}" -d "$2" --max-time 30
}

nx_get() {
  curl -s -o /tmp/docucentral-seed-response.json -w "%{http_code}" \
    "$API$1" "${AUTH[@]}" --max-time 30
}

ensure_group() {
  local name="$1" label="$2"
  if [[ "$(nx_get "/group/$name")" == "200" ]]; then
    echo "  [skip] group $name already exists"
    return
  fi
  local status
  status=$(nx_post "/group" "{\"entity-type\":\"group\",\"groupname\":\"$name\",\"grouplabel\":\"$label\"}")
  if [[ "$status" == "201" || "$status" == "200" ]]; then
    echo "  [ok]   group $name"
  else
    echo "  [warn] group $name — HTTP $status"
    cat /tmp/docucentral-seed-response.json 2>/dev/null
    echo
  fi
}

# ensure_doc <parent-path> <name> <type> <title> [extra-properties-json]
ensure_doc() {
  local parent="$1" name="$2" type="$3" title="$4" extra="${5:-}"
  if [[ "$(nx_get "/path$parent/$name")" == "200" ]]; then
    echo "  [skip] $type $parent/$name already exists"
    return
  fi
  local props="\"dc:title\":\"$title\""
  [[ -n "$extra" ]] && props="$props,$extra"
  local status
  status=$(nx_post "/path$parent" \
    "{\"entity-type\":\"document\",\"name\":\"$name\",\"type\":\"$type\",\"properties\":{$props}}")
  if [[ "$status" == "201" ]]; then
    echo "  [ok]   $type $parent/$name"
  else
    echo "  [warn] $type $parent/$name — HTTP $status"
    cat /tmp/docucentral-seed-response.json 2>/dev/null
    echo
  fi
}

echo "================================================================"
echo " DocuCentral — seeding $NUXEO_URL"
echo "================================================================"

# ── Preflight ────────────────────────────────────────────────────────────────
if [[ "$(nx_get "/automation/login")" != "200" ]]; then
  echo "Cannot reach $NUXEO_URL with the configured credentials."
  echo "Run ./scripts/check-server.sh first."
  exit 1
fi

if [[ "$(nx_get "/config/types/DCControlledDocument")" != "200" ]]; then
  echo "Document type DCControlledDocument is not registered on the server."
  echo "Deploy the bundle first: ./scripts/deploy.sh"
  exit 1
fi

# ── 1. Governance groups ─────────────────────────────────────────────────────
echo ""
echo "[1/3] Governance groups"
ensure_group "dc-authors"   "DocuCentral Authors"
ensure_group "dc-reviewers" "DocuCentral Reviewers"
ensure_group "dc-approvers" "DocuCentral Approvers"
ensure_group "dc-readers"   "DocuCentral Readers"

# ── 2. Library tree ──────────────────────────────────────────────────────────
echo ""
echo "[2/3] Department libraries"
ensure_doc "$ROOT" "docucentral" "Workspace" "DocuCentral"
for entry in "PROC:Procurement" "FIN:Finance" "LEG:Legal" "IT:Information Technology" "OPS:Operations" "HR:Human Resources" "QHSE:QHSE"; do
  code="${entry%%:*}"
  label="${entry#*:}"
  ensure_doc "$LIBRARY_ROOT" "$(echo "$code" | tr '[:upper:]' '[:lower:]')" "DCLibrary" "$label" \
    "\"dcx:department\":\"$code\""
done

# ── 3. Demo documents ────────────────────────────────────────────────────────
if [[ "${1:-}" == "--no-demo" ]]; then
  echo ""
  echo "[3/3] Demo documents skipped (--no-demo)."
else
  echo ""
  echo "[3/3] Demo documents"
  ensure_doc "$LIBRARY_ROOT/proc" "supplier-code-of-conduct" "DCControlledDocument" \
    "Supplier Code of Conduct" \
    "\"dcx:department\":\"PROC\",\"dcx:documentClass\":\"POLICY\",\"dcx:confidentiality\":\"PUBLIC\",\"dcx:retentionYears\":7"
  ensure_doc "$LIBRARY_ROOT/proc" "sourcing-procedure" "DCControlledDocument" \
    "Strategic Sourcing Procedure" \
    "\"dcx:department\":\"PROC\",\"dcx:documentClass\":\"PROCEDURE\",\"dcx:confidentiality\":\"INTERNAL\",\"dcx:retentionYears\":5"
  ensure_doc "$LIBRARY_ROOT/it" "access-control-policy" "DCControlledDocument" \
    "Access Control Policy" \
    "\"dcx:department\":\"IT\",\"dcx:documentClass\":\"POLICY\",\"dcx:confidentiality\":\"CONFIDENTIAL\",\"dcx:retentionYears\":7"
fi

echo ""
echo "Seeding complete. Open: $NUXEO_URL/ui/#!/browse$LIBRARY_ROOT"
