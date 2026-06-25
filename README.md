# Nuxeo Studio Local Setup — Community Cookbook

Local development environment for using the
[Nuxeo Studio Community Cookbook](https://github.com/nuxeo/nuxeo-studio-community-cookbook)
with your local Nuxeo Platform server.

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
│   └── nuxeo-local.properties    # Local server connection settings
├── modules/                       # Downloaded cookbook modules (git-ignored)
│   ├── workflow-status/
│   ├── user-group-management/
│   └── ...
├── scripts/
│   ├── fetch-module.sh           # Download any cookbook module
│   ├── deploy.sh                 # Build + hot-reload to local Nuxeo
│   ├── check-server.sh           # Verify Nuxeo server is reachable
│   └── import-studio-xml.sh     # Import XML via REST API
├── src/
│   └── main/resources/
│       ├── META-INF/MANIFEST.MF
│       └── OSGI-INF/
│           └── cookbook-contrib.xml   # Your XML contributions
└── pom.xml                       # Maven project
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

#### Option C — REST API Import

```bash
./scripts/import-studio-xml.sh workflow-status
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
