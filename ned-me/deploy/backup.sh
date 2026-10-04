#!/usr/bin/env bash
# Sauvegarde logique de la base NED (format custom, compressé) + somme SHA-256 ; rotation optionnelle.
# Connexion via les variables PG* habituelles (PGHOST, PGUSER, PGPASSWORD…).
# Usage : ./backup.sh <base> <dossier_sortie>      KEEP=14 pour conserver les 14 dernières sauvegardes
set -euo pipefail
db=${1:?base requise}; out=${2:?dossier requis}
mkdir -p "$out"
f="$out/$db-$(date -u +%Y%m%dT%H%M%SZ).dump"
# --no-owner : restaurable sous un autre propriétaire ; les droits (GRANT) et la RLS sont conservés.
pg_dump --format=custom --compress=6 --no-owner --file="$f.part" "$db"
pg_restore --list "$f.part" >/dev/null          # l'archive doit être lisible avant d'être publiée
mv "$f.part" "$f"
( cd "$out" && sha256sum "$(basename "$f")" > "$(basename "$f").sha256" )
if [ -n "${KEEP:-}" ]; then
  ls -1t "$out"/"$db"-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f -- "$old" "$old.sha256"; done
fi
echo "$f"
