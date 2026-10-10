#!/usr/bin/env bash
# Restaure une sauvegarde dans une base NOUVELLE (refuse d'écraser une base existante). Vérifie la somme SHA-256 avant toute opération.
# Prérequis : les rôles du cluster (ned_app, ned_api) existent déjà — ils sont globaux et ne font pas partie du dump.
# Usage : ./restore.sh <fichier.dump> <base_cible>
set -euo pipefail
dump=${1:?fichier requis}; target=${2:?base cible requise}
[ -f "$dump.sha256" ] || { echo "somme SHA-256 absente : $dump.sha256" >&2; exit 2; }
# La somme est comparée au fichier RÉELLEMENT restauré (sha256sum --check vérifierait le nom inscrit dans le .sha256, pas ce fichier).
expected=$(awk '{print $1; exit}' "$dump.sha256"); actual=$(sha256sum "$dump" | awk '{print $1}')
[ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo "ÉCHEC : somme SHA-256 invalide, sauvegarde altérée" >&2; exit 3; }
if psql -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname = '$target'" | grep -q 1; then
  echo "refus : la base '$target' existe déjà" >&2; exit 4
fi
createdb "$target"
pg_restore --exit-on-error --no-owner --dbname="$target" "$dump"
echo "restauré dans $target"
