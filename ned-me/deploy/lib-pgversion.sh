#!/usr/bin/env bash
# Garde de version : un pg_dump / pg_restore PLUS RÉCENT que le serveur écrit des instructions que ce serveur ne comprend pas
# (constaté : « SET transaction_timeout » d'un client 17+ refusé par un serveur 16). Mieux vaut refuser avec un message clair que
# découvrir, le jour de la restauration, qu'une sauvegarde n'est pas restaurable.
# Usage (après `source`) : check_pg_client_version <pg_dump|pg_restore> <base_de_connexion>
check_pg_client_version() {
  local srv cli
  srv=$(psql -X -d "$2" -Atc 'SHOW server_version_num') || return 1
  cli=$("$1" --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/')
  if [ "$cli" -gt $((srv / 10000)) ]; then
    echo "ÉCHEC : $1 version $cli plus récent que le serveur PostgreSQL $((srv / 10000)). Utilisez les outils client de la version $((srv / 10000))" \
         "(paquet postgresql-client-$((srv / 10000))) : une archive d'un client plus récent peut être irrestaurable sur ce serveur." >&2
    return 5
  fi
}
