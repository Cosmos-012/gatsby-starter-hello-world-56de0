# DocuCentral — Controlled Document Management on Nuxeo

A controlled-document MVP (policies, procedures, contracts) plus the local
development environment it is built in, using the
[Nuxeo Studio Community Cookbook](https://github.com/nuxeo/nuxeo-studio-community-cookbook)
with your local Nuxeo Platform server.

| Document | What it covers |
|---|---|
| [`nuxeo-studio/docs/DOCUCENTRAL.md`](nuxeo-studio/docs/DOCUCENTRAL.md) | MVP scope, content model, lifecycle, roles, runbook, KPIs, roadmap |
| [`nuxeo-studio/docs/AUDIT.md`](nuxeo-studio/docs/AUDIT.md) | Pre-MVP audit findings and what was fixed |
| This file | Cookbook tooling and module reference |

## DocuCentral in one minute

```bash
cd nuxeo-studio
./scripts/check-server.sh          # is Nuxeo up at localhost:8080?
./scripts/validate.sh              # offline package check (no server needed)
./scripts/deploy.sh                # build + deploy + hot reload
./scripts/docucentral-seed.sh      # groups, department libraries, demo docs
./scripts/docucentral-smoke-test.sh  # end-to-end lifecycle verification
```

DocuCentral adds a `DCControlledDocument` type with governance metadata, a
five-state lifecycle (draft → review → approved → published → obsolete) with
server-side guard rails, contributed `DCReview` / `DCApprove` permissions, a
governance dashboard, and a nightly overdue-review sweep. It ships as XML and
Web UI resources inside the existing Maven bundle — no Java, so it builds
offline and hot-reloads in dev mode.

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Java | 11+ | Required for Maven build |
| Maven | 3.6+ | For building the Nuxeo plugin |
| cURL | any | Used by fetch scripts |
| Nuxeo Server | LTS 2021+ / 2023 | Running locally |

## Project Structure

```
nuxeo-studio/
├── config/
│   └── nuxeo-local.properties        # Local server connection settings
├── docs/
│   ├── DOCUCENTRAL.md                # MVP specification and runbook
│   └── AUDIT.md                      # Pre-MVP audit findings
├── modules/                          # Downloaded cookbook modules
├── scripts/
│   ├── fetch-module.sh               # Download any cookbook module
│   ├── import-studio-xml.sh          # Merge a module's XML into the bundle
│   ├── validate.sh                   # Offline package validation (CI gate)
│   ├── deploy.sh                     # Validate + build + deploy + hot reload
│   ├── check-server.sh               # Server reachability + package presence
│   ├── docucentral-seed.sh           # Seed groups, libraries, demo documents
│   └── docucentral-smoke-test.sh     # End-to-end lifecycle verification
├── src/main/resources/
│   ├── META-INF/MANIFEST.MF          # Declares every Nuxeo component
│   ├── OSGI-INF/
│   │   ├── cookbook-contrib.xml      # Imported cookbook contributions
│   │   ├── docucentral-core-contrib.xml        # Model, vocabularies, lifecycle
│   │   ├── docucentral-automation-contrib.xml  # Operations, events, queries
│   │   └── docucentral-ui-contrib.xml          # Web UI registration
│   ├── schemas/docucentral.xsd       # dcx: governance metadata
│   ├── directories/*.csv             # Department / class / confidentiality
│   ├── i18n/messages.json            # Web UI labels
│   └── ui/                           # Polymer elements
└── pom.xml                           # Maven project (no Java, builds offline)
```

---

## Quick Start

### 1. Configure Local Server

Edit `nuxeo-studio/config/nuxeo-local.properties`:

```properties
NUXEO_URL=http://localhost:8080/nuxeo
NUXEO_ADMIN_USER=Administrator
NUXEO_ADMIN_PASSWORD=Administrator
NUXEO_HOME=/opt/nuxeo/server          # path to your Nuxeo install
```

### 2. Enable Hot Reload on Your Nuxeo Server

Add to `$NUXEO_HOME/bin/nuxeo.conf`:

```
org.nuxeo.dev=true
```

Then restart Nuxeo once to apply.

### 3. Verify the Server

```bash
cd nuxeo-studio
./scripts/check-server.sh
```

### 3b. Validate Before Deploying

`validate.sh` needs no server and is the fastest way to catch a broken
contribution:

```bash
./scripts/validate.sh
```

It checks XML well-formedness, JSON and vocabulary CSV integrity, that every
component named in `MANIFEST.MF` exists on disk, that `<require>` targets
resolve, and that every Web UI import declares a `dom-module`. `deploy.sh`
runs it automatically and aborts on failure.

### 4. Browse and Fetch a Cookbook Module

```bash
# List all 60 available modules
./scripts/fetch-module.sh --list

# Download a specific module
./scripts/fetch-module.sh workflow-status
./scripts/fetch-module.sh user-group-management
./scripts/fetch-module.sh send-email-from-webui

# Download all modules at once
./scripts/fetch-module.sh --all
```

### 5. Install a Module on Your Local Nuxeo

Each module has two parts — **Modeler** (backend XML) and **Designer** (frontend HTML):

#### Option A — Via Nuxeo Studio (cloud)

1. Open your Studio project at `connect.nuxeo.com`
2. **Modeler**: Go to `Advanced Settings → XML Extensions` → paste the `.xml` content
3. **Designer**: Go to `Resources` → upload the HTML files from `designer/ui/`
4. Click **Hot Reload** in Studio

#### Option B — Direct Maven Deploy (no Studio account needed)

1. Copy modeler XML content into `src/main/resources/OSGI-INF/cookbook-contrib.xml`
2. Build and deploy:
   ```bash
   ./scripts/deploy.sh
   ```
3. Designer HTML files go to: `$NUXEO_HOME/nxserver/nuxeo.war/ui/`

#### Option C — Merge a Module Into the Bundle

XML extensions cannot be registered at runtime over REST, so this script merges
a module's modeler XML into the bundle and registers it in the manifest:

```bash
./scripts/import-studio-xml.sh --dry-run workflow-status   # preview
./scripts/import-studio-xml.sh workflow-status             # write + register
./scripts/deploy.sh
```

---

## Available Cookbook Modules (60 total)

### Analytics & Reporting
- `Analytics-KPIs-Examples` — Custom KPI widgets
- `workflow-status` — Monitor active workflow instances
- `generic-dashboard` — Configurable analytics dashboard
- `project-metrics` — Project progress tracking

### Document & Layout
- `document-viewer-with-loading-message` — Enhanced viewer
- `carousel` — Image/document carousel
- `progress-bar` — Visual progress indicator
- `toggleable-form` — Collapsible form sections
- `collapse` — Collapsible content sections
- `highlight` — Text highlighting
- `qr-code` — QR code display widget

### Search & Navigation
- `cascading-fields` — Dynamic dependent dropdowns
- `virtual-tree` — Virtual folder navigation
- `parent-container-search` — Search by parent container
- `interactive-pdf-search` — Search within PDFs
- `color-search` — Search by dominant color

### User & Security
- `user-group-management` — Group administration UI
- `bulk-workflow-reassignment` — Reassign tasks in bulk
- `saml-user-mapping` — SAML attribute mapping
- `sensitive-data` — Mask sensitive field values
- `ssn` — SSN field masking
- `nuxeo-user-preferences` — User preference storage

### Automation & Business Logic
- `automation-script-utils` — Reusable automation helpers
- `send-email-from-webui` — Trigger emails from UI
- `email-templates-nuxeo` — HTML email templates
- `create-from-template` — Create docs from templates
- `actions-versioned-documents` — Versioning actions
- `delete-all-trashed-documents` — Bulk trash cleanup
- `copy-move` — Copy/move document actions
- `link-to-task-from-automation` — Link tasks in scripts

### Digital Asset Management
- `video-thumbnail` — Custom video thumbnails
- `video-conversions` — Video format conversion
- `replace-rendition` — Replace document renditions
- `eml-previewer` — Preview .eml email files
- `preview-tiff-attachments` — TIFF file preview
- `nev-with-custom-blob-field` — Custom blob viewer

### AI / ML
- `google-vision-ocr` — OCR via Google Vision API
- `sensitive-data` — AI-based sensitive data detection

### UI Components
- `barcode-widget` — Barcode display
- `currency` — Currency input/display
- `nuxeo-date-time-picker` — Date/time picker
- `nuxeo-operation-button-no-icon` — Operation button
- `nuxeo-operation-button-with-navigation` — Button with nav
- `nuxeo-operation-button-with-spinner` — Button with spinner
- `inject-html` — Inject HTML fragments
- `web-ui-user-header` — Custom user header

### Integrations
- `salesforce-ui` — Salesforce metadata display
- `geodistance-search-and-google-map` — Geo search + map

---

## Hot Reload Workflow

```
Edit cookbook-contrib.xml
        ↓
./scripts/deploy.sh
        ↓
Nuxeo hot-reloads automatically
        ↓
Refresh browser
```

---

## Nuxeo Server Tips

### Start/Stop
```bash
$NUXEO_HOME/bin/nuxeoctl start
$NUXEO_HOME/bin/nuxeoctl stop
$NUXEO_HOME/bin/nuxeoctl status
```

### View Logs
```bash
tail -f $NUXEO_HOME/log/server.log
```

### Connect REST API
```bash
# List all document types
curl -u Administrator:Administrator \
  http://localhost:8080/nuxeo/api/v1/config/types

# Run automation operation
curl -X POST -u Administrator:Administrator \
  -H "Content-Type: application/json" \
  http://localhost:8080/nuxeo/api/v1/automation/Document.Query \
  -d '{"params":{"query":"SELECT * FROM Document WHERE ecm:isProxy = 0 LIMIT 10"}}'
```

---

## Resources

- [Cookbook Repository](https://github.com/nuxeo/nuxeo-studio-community-cookbook)
- [Nuxeo Documentation](https://doc.nuxeo.com/)
- [Studio Modeler Guide](https://doc.nuxeo.com/studio/nuxeo-studio/)
- [Web UI Developer Guide](https://doc.nuxeo.com/nxdoc/web-ui/)
- [Nuxeo REST API](https://doc.nuxeo.com/nxdoc/rest-api/)
- [Nuxeo CLI](https://doc.nuxeo.com/nxdoc/nuxeo-cli/)
