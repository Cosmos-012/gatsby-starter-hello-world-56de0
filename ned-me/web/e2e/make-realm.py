#!/usr/bin/env python3
"""Royaume de TEST : le royaume de production (deploy/keycloak/realm-ned.json) + un utilisateur de démonstration.
Le royaume livré ne contient aucun utilisateur ni mot de passe connu. Usage : make-realm.py > realm.json"""
import json, pathlib, sys
realm = json.loads((pathlib.Path(__file__).resolve().parents[2] / 'deploy/keycloak/realm-ned.json').read_text())
realm['users'] = json.loads('''[
  {
    "username": "demo",
    "enabled": true,
    "email": "demo@example.org",
    "emailVerified": true,
    "firstName": "Demo",
    "lastName": "User",
    "attributes": {
      "tenant_id": [
        "aaaaaaaa-0000-0000-0000-000000000001"
      ]
    },
    "credentials": [
      {
        "type": "password",
        "value": "demo-pass-1",
        "temporary": false
      }
    ],
    "realmRoles": [
      "viewer"
    ]
  }
]''')
json.dump(realm, sys.stdout)
