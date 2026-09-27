#!/usr/bin/env bash
# fetch-module.sh — Download a Nuxeo Studio Community Cookbook module locally
#
# Discovers files by scraping GitHub HTML (no API token required).
#
# Usage:
#   ./scripts/fetch-module.sh <module-name>
#   ./scripts/fetch-module.sh workflow-status
#   ./scripts/fetch-module.sh --list
#   ./scripts/fetch-module.sh --all

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODULES_DIR="$PROJECT_DIR/modules"

COOKBOOK_REPO="nuxeo/nuxeo-studio-community-cookbook"
COOKBOOK_BRANCH="master"
GITHUB_BASE="https://github.com/$COOKBOOK_REPO/tree/$COOKBOOK_BRANCH"
RAW_BASE="https://raw.githubusercontent.com/$COOKBOOK_REPO/$COOKBOOK_BRANCH"

AVAILABLE_MODULES=(
  "Analytics-KPIs-Examples"
  "Home-Page-Configuration"
  "actions-versioned-documents"
  "automation-script-utils"
  "barcode-widget"
  "better-html-to-pdf"
  "bulk-workflow-reassignment"
  "carousel"
  "cascading-fields"
  "collapse"
  "color-search"
  "comment-indexing"
  "convert-date-to-timestamp"
  "copy-move"
  "create-from-template"
  "currency"
  "custom-views"
  "dashboard"
  "delete-all-trashed-documents"
  "designer-tips-tricks"
  "document-load-and-preview"
  "document-suggestion-result-formatters"
  "document-viewer-with-loading-message"
  "edit-facets"
  "email-templates-nuxeo"
  "eml-previewer"
  "generic-dashboard"
  "geodistance-search-and-google-map"
  "google-vision-ocr"
  "highlight"
  "inject-html"
  "interactive-pdf-search"
  "link-to-task-from-automation"
  "modeler-tips-tricks"
  "nev-with-custom-blob-field"
  "nuxeo-date-time-picker"
  "nuxeo-operation-button-no-icon"
  "nuxeo-operation-button-with-navigation"
  "nuxeo-operation-button-with-spinner"
  "nuxeo-user-preferences"
  "parent-container-search"
  "preview-tiff-attachments"
  "progress-bar"
  "project-metrics"
  "qr-code"
  "related-documents"
  "replace-rendition"
  "salesforce-ui"
  "saml-user-mapping"
  "select-all-bulk-action"
  "send-email-from-webui"
  "sensitive-data"
  "ssn"
  "toggleable-form"
  "user-group-management"
  "video-conversions"
  "video-thumbnail"
  "virtual-tree"
  "web-ui-user-header"
  "workflow-status"
)

list_modules() {
  echo "Nuxeo Studio Community Cookbook — Available modules (${#AVAILABLE_MODULES[@]} total):"
  echo ""
  local installed=0
  for m in "${AVAILABLE_MODULES[@]}"; do
    if [[ -d "$MODULES_DIR/$m" ]]; then
      printf "  \033[32m[installed]\033[0m %s\n" "$m"
      (( installed++ )) || true
    else
      printf "             %s\n" "$m"
    fi
  done
  echo ""
  echo "Installed: $installed / ${#AVAILABLE_MODULES[@]}"
  echo ""
  echo "Usage:  $0 <module-name>"
  echo "        $0 --all"
}

# Scrape a GitHub tree page and return two arrays (by writing to temp files):
#   /tmp/nx_files.txt  — repo-relative file paths
#   /tmp/nx_dirs.txt   — repo-relative directory paths
scrape_tree() {
  local repo_path="$1"
  local url="$GITHUB_BASE/$repo_path"

  local html
  html=$(curl -sf --max-time 20 "$url" 2>/dev/null) || { echo ""; return; }

  echo "$html" | \
    grep -oP "(?<=href=\"/$COOKBOOK_REPO/)blob/$COOKBOOK_BRANCH/[^\"?#]+" | \
    sed "s|blob/$COOKBOOK_BRANCH/||" >> /tmp/nx_files.txt

  echo "$html" | \
    grep -oP "(?<=href=\"/$COOKBOOK_REPO/)tree/$COOKBOOK_BRANCH/[^\"?#]+" | \
    sed "s|tree/$COOKBOOK_BRANCH/||" | \
    grep -v "^modules/nuxeo$" | \
    grep -v "^modules$" | \
    grep "^$repo_path/" >> /tmp/nx_dirs.txt || true
}

# Recursively collect all file paths for a module
collect_files() {
  local module_path="$1"

  > /tmp/nx_files.txt
  > /tmp/nx_dirs.txt
  > /tmp/nx_visited.txt

  local queue=("$module_path")

  while [[ ${#queue[@]} -gt 0 ]]; do
    local current="${queue[0]}"
    queue=("${queue[@]:1}")

    # Skip if already visited
    if grep -qxF "$current" /tmp/nx_visited.txt 2>/dev/null; then
      continue
    fi
    echo "$current" >> /tmp/nx_visited.txt

    scrape_tree "$current"

    # Add newly discovered directories to the queue
    while IFS= read -r dir; do
      if [[ -n "$dir" ]] && ! grep -qxF "$dir" /tmp/nx_visited.txt 2>/dev/null; then
        queue+=("$dir")
      fi
    done < /tmp/nx_dirs.txt
    > /tmp/nx_dirs.txt  # Clear for next iteration
  done

  # Return unique, sorted file list under module_path
  sort -u /tmp/nx_files.txt | grep "^$module_path/"
}

fetch_module() {
  local module="$1"
  local module_path="modules/nuxeo/$module"
  local dest_dir="$MODULES_DIR/$module"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "Fetching: $module"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Discover all files
  echo "  Discovering files..."
  local file_list
  file_list=$(collect_files "$module_path") || true

  if [[ -z "$file_list" ]]; then
    echo "  Warning: No files found for '$module'. Check network or module name."
    return 1
  fi

  local count=0
  local total
  total=$(echo "$file_list" | wc -l)

  mkdir -p "$dest_dir"

  while IFS= read -r repo_file; do
    [[ -z "$repo_file" ]] && continue

    # Compute relative path within module
    local rel_path="${repo_file#$module_path/}"
    local dest_file="$dest_dir/$rel_path"
    local url="$RAW_BASE/$repo_file"

    mkdir -p "$(dirname "$dest_file")"
    if curl -sf --max-time 30 "$url" -o "$dest_file" 2>/dev/null; then
      (( count++ )) || true
      echo "  [ok] $rel_path"
    else
      echo "  [fail] $rel_path"
    fi
  done <<< "$file_list"

  echo ""
  echo "Downloaded $count / $total files -> $dest_dir"
  echo ""
  echo "Next steps:"
  echo "  1. Read: $dest_dir/README.md"
  if [[ -d "$dest_dir/modeler" ]]; then
    echo "  2. Modeler XML → copy to src/main/resources/OSGI-INF/cookbook-contrib.xml"
    echo "     or use Studio Modeler (XML Extensions) to upload the file"
  fi
  if [[ -d "$dest_dir/designer" ]]; then
    echo "  3. Designer files → upload via Studio Designer Resources"
  fi
  echo "  4. Deploy: ./scripts/deploy.sh"
}

# ── main ──────────────────────────────────────────────────────────────────────

case "${1:-}" in
  ""|--list|-l)
    list_modules
    ;;
  --all)
    echo "Fetching all ${#AVAILABLE_MODULES[@]} modules..."
    for m in "${AVAILABLE_MODULES[@]}"; do
      fetch_module "$m" || echo "  Skipped: $m"
    done
    echo ""
    echo "All modules saved to: $MODULES_DIR"
    ;;
  -*)
    echo "Unknown option: $1"
    echo "Usage: $0 [--list|--all|<module-name>]"
    exit 1
    ;;
  *)
    module="$1"
    # Validate
    found=false
    for m in "${AVAILABLE_MODULES[@]}"; do
      [[ "$m" == "$module" ]] && { found=true; break; }
    done
    if [[ "$found" == "false" ]]; then
      echo "Error: Unknown module '$module'"
      echo "Run '$0 --list' to see available modules."
      exit 1
    fi
    fetch_module "$module"
    ;;
esac
