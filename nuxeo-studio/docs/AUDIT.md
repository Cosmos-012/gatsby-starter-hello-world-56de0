# Pre-MVP Audit — nuxeo-studio project

Audit of the existing local Nuxeo Studio setup, carried out before the
DocuCentral MVP was built on top of it. Findings that blocked or would have
silently broken the MVP were fixed in the same change; the rest are recorded
with a recommendation.

## Environment baseline

| Item | Result |
|---|---|
| Java | OpenJDK 21.0.10 |
| Maven | 3.9.11 |
| Node / npm | 22.22.2 / 10.9.7 |
| Docker daemon | not running in this container |
| `http://localhost:8080` | no listener — no Nuxeo server available here |
| `packages.nuxeo.com` | HTTP 403 through the environment proxy |

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| A1 | **High** | `maven-bundle-plugin` was configured with `<extensions>true</extensions>` but the project uses `<packaging>jar</packaging>`, so the plugin never ran and the built JAR had no `Nuxeo-Component` header. Nuxeo would have loaded the bundle and ignored every contribution in it. | Fixed — `maven-jar-plugin` now packages the checked-in `MANIFEST.MF`; `deploy.sh` fails the build if the header is missing. |
| A2 | **High** | `import-studio-xml.sh` posted module XML to `ExtendedXml.Import`, an automation operation that does not exist in stock Nuxeo. Every import silently returned an error. | Fixed — the script now merges module XML into the bundle, wraps it in a `<component>`, validates it and registers it in the manifest. |
| A3 | **High** | `deploy.sh` triggered hot reload via `NuxeoCtl.HotReload`, also not a stock operation. | Fixed — uses the dev-mode bundle watcher (`nxserver/dev.bundles`), which is the supported local mechanism when `org.nuxeo.dev=true`. |
| A4 | **Medium** | `check-server.sh` runs under `set -e`; when the server is down, curl exits 7 and killed the script *before* the case statement, so it printed a header and nothing else. A down server looked like a hung script. | Fixed — the failure is captured and reported as `[FAIL] Cannot connect`. |
| A5 | **Medium** | The build depended on three Nuxeo artifacts at `provided` scope although the project contains no Java source. This made the build fail entirely on any machine without access to `packages.nuxeo.com`. | Fixed — dependencies removed; the build is now fully offline. A comment records what to re-add if Java classes are introduced. |
| A6 | **Medium** | `deploy.sh` copied only the JAR. Web UI elements and i18n labels had to be copied by hand, so a deployed bundle rendered without its UI. | Fixed — UI assets are copied and the label catalog is merged (with a timestamped backup of the existing file). |
| A7 | **Low** | No validation existed between editing a contribution and restarting Nuxeo; a malformed XML file was only discovered in the server log. | Fixed — `scripts/validate.sh` checks XML, JSON, CSV, manifest/component consistency and Web UI wiring offline, and gates `deploy.sh`. |
| A8 | **Low** | `fetch-module.sh` writes to fixed paths under `/tmp` (`/tmp/nx_files.txt` and friends), so two concurrent runs corrupt each other's file lists. | Open — low impact for single-user local development. Recommendation: switch to `mktemp -d` per invocation. |
| A9 | **Low** | `config/nuxeo-local.properties` carries default admin credentials and a placeholder Connect token, and is tracked in git. | Open — acceptable for a local default install. Recommendation before any shared or non-local use: move the file to `.gitignore`, ship a `.template`, and source real values from the environment or a secret store. |

## Backup taken before changes

| Artifact | Contents |
|---|---|
| `repo-<timestamp>.bundle` | `git bundle --all` — every branch and its history |
| `worktree-<timestamp>.tar.gz` | working tree excluding `.git`, `node_modules`, `target` |
| `MANIFEST.sha256` | SHA-256 of both artifacts |

Stored in the session scratchpad. They cover the pre-change state; the
repository history itself is the durable record once pushed.

## Verification performed

| Check | Result |
|---|---|
| `scripts/validate.sh` | 23 passed, 0 failed |
| `mvn clean package` | builds offline; JAR carries all four components in `Nuxeo-Component` |
| `scripts/check-server.sh` | correctly reports `[FAIL] Cannot connect` — no Nuxeo on `localhost:8080` in this container |
| `scripts/docucentral-smoke-test.sh` | **not executed** — requires a running server; syntax-checked only |

The runtime behaviour of the contributions (lifecycle transitions, reference
generation, dashboard queries) has therefore been validated structurally but
not executed. Run the smoke test against a real Nuxeo instance before treating
the MVP as verified.
