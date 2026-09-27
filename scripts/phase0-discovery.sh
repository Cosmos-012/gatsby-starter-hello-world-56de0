#!/usr/bin/env bash
# Phase 0 environment discovery for the Roznama ERP program.
# Read-only: does not install, modify, start, or stop anything.
# Run this ON THE MACHINE (or container host) that hosts Onfinity and
# PostgreSQL, then review the generated report for secrets before
# committing it. Use phase0-discovery.ps1 instead on Windows.
#
# Usage: ./phase0-discovery.sh [output-dir]

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/../docs/discovery}"
mkdir -p "$OUT_DIR"

TS="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/$TS-system-inventory.local.md"

run() {
    local label="$1"; shift
    local out
    if out="$("$@" 2>&1)"; then
        printf -- "- %s: %s\n" "$label" "$(echo "$out" | head -n1)"
    else
        printf -- "- %s: not available\n" "$label"
    fi
}

{
    echo "# System Inventory — Phase 0 Discovery"
    echo
    echo "Generated: $(date '+%Y-%m-%d %H:%M:%S %z')"
    echo
    echo "**This file may contain host paths, service names, and configuration"
    echo "values. Review and redact before committing** — see"
    echo '`docs/01-system-inventory.md` for the sign-off checklist.'
    echo
    echo "## Host environment"
    echo
    echo "- OS: $(uname -a)"
    if command -v lscpu >/dev/null 2>&1; then
        echo "- CPU: $(lscpu | grep 'Model name' | sed 's/Model name:\s*//')"
    fi
    if command -v free >/dev/null 2>&1; then
        echo "- RAM: $(free -h | awk '/^Mem:/{print $2" total, "$7" available"}')"
    fi
    if command -v df >/dev/null 2>&1; then
        echo "- Disk (/): $(df -h / | awk 'NR==2{print $2" total, "$4" free"}')"
    fi
    run "Java" java -version
    run "Node.js" node -v
    run "npm" npm -v
    run "Git" git --version
    run "Docker" docker --version
    run "Docker daemon" docker info --format '{{.ServerVersion}}'
    run "Python" python3 --version
    run "Maven" mvn -v
    run "psql" psql --version
    echo
    echo "## PostgreSQL"
    echo
    if command -v pg_lsclusters >/dev/null 2>&1; then
        echo '```'
        pg_lsclusters 2>&1
        echo '```'
    else
        echo "- pg_lsclusters not available (not a Debian-style PostgreSQL install)"
    fi
    if command -v ss >/dev/null 2>&1; then
        if ss -ltn 2>/dev/null | grep -q ':5432 '; then
            echo "- Port 5432: LISTENING"
        else
            echo "- Port 5432: not in use"
        fi
    fi
    echo
    echo "## Onfinity installation"
    echo
    echo "Common install roots searched (edit this script if yours differs):"
    for root in /opt/onfinity /opt/Onfinity /usr/local/onfinity /srv/onfinity; do
        if [ -d "$root" ]; then
            echo "- FOUND: $root"
        else
            echo "- not present: $root"
        fi
    done
    echo
    echo "### Docker containers matching 'onfinity' or 'postgres'"
    if command -v docker >/dev/null 2>&1; then
        docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null \
            | grep -i -E 'onfinity|postgres' || echo "- none found"
    else
        echo "- docker not available"
    fi
    echo
    echo "## Listening ports (common ERP/DB/web range)"
    echo
    if command -v ss >/dev/null 2>&1; then
        for p in 80 443 5432 8080 8443 1433 3306 9990; do
            if ss -ltn 2>/dev/null | grep -q ":$p "; then
                echo "- Port $p: LISTENING"
            else
                echo "- Port $p: not in use"
            fi
        done
    fi
    echo
    echo "## Manual follow-up required"
    echo
    echo "- Confirm Onfinity version (expected: Community 6.4.1.0)"
    echo "- Locate and redact-review Onfinity config file(s) for DB connection string"
    echo "- Confirm the PostgreSQL database name and user Onfinity connects as"
    echo "- Note existing backup/restore procedure, if any"
} > "$REPORT"

echo "Report written to: $REPORT"
echo "Review it for secrets before committing or pasting into docs/01-system-inventory.md."
