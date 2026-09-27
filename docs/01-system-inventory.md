# 01 — System Inventory

**Status: BLOCKED.** This document is filled in from the output of
`scripts/phase0-discovery.ps1` (Windows) or `scripts/phase0-discovery.sh`
(Linux/Docker), run **on the machine that actually hosts Onfinity and
PostgreSQL**. This cloud workspace has no access to that machine, so
nothing below may be filled in from assumption.

## How to complete this document

1. Copy `scripts/phase0-discovery.ps1` (or `.sh`) to the Onfinity host.
2. Run it. It writes a timestamped Markdown report under
   `docs/discovery/*.local.md` (git-ignored by default, because it may
   capture host paths, service accounts, or config values).
3. **Review the report for secrets** (DB passwords, connection strings,
   API keys) before anything from it is copied into this file or
   committed. Redact or move secrets to a secure store first.
4. Paste the redacted findings into the sections below.

## Sections to complete

### Host environment
- OS name/version, CPU, RAM, disk free space
- Java version and `JAVA_HOME`
- .NET SDK/runtime version(s)
- Node.js / npm version
- Git version
- Docker version and daemon status
- PowerShell version
- Python version (if used by any tooling)
- Maven version
- IIS status (if applicable)

### Onfinity installation
- Install path
- Version confirmation (expected: Community 6.4.1.0)
- Windows service name(s) and status
- Listening port(s)
- Config file location(s) and key settings (redact secrets)
- Log file location(s)
- Source code availability (path, or "binary only")

### PostgreSQL
- Version
- Service name and status
- Listening port
- Database name(s) used by Onfinity
- Database user(s) and role/privilege summary (no passwords)
- Data directory path
- Backup/replication configuration, if any

### Networking
- Ports currently in use by Onfinity, PostgreSQL, and any related services
- Firewall rules relevant to those ports

### Existing backups
- What backup mechanism (if any) already exists
- Last known good backup location and date

## Sign-off

- [ ] Discovery script executed on the Onfinity host
- [ ] Output reviewed for secrets and redacted
- [ ] Findings transcribed above
- [ ] Backup verified to exist **before** any further phase proceeds
