# DocuCentral — Controlled Document Management MVP

Built on the existing `nuxeo-studio` local project and the Nuxeo Studio
Community Cookbook. Nothing was rebuilt from scratch: the cookbook fetch /
deploy tooling, the Maven bundle and the `automation-script-utils` helper are
reused as the foundation.

---

## 1. Scope

DocuCentral MVP delivers a governed lifecycle for controlled documents
(policies, procedures, contracts, specifications) with auditable approvals.

| In scope (MVP) | Out of scope (later phases) |
|---|---|
| Controlled-document type with governance metadata | Graph workflow with parallel reviewer tasks |
| 5-state lifecycle with guard rails | E-signature integration |
| Auto-generated document reference | Retention enforcement / legal hold |
| Governance dashboard (my queue, in review, overdue) | Full-text OCR pipeline |
| Department libraries and vocabularies | Cross-system sync (ERP, CLM) |
| Nightly overdue-review sweep with audit entries | Email notification templates |

---

## 2. Architecture

```
nuxeo-studio/                             one Maven bundle, no Java code
├── src/main/resources/
│   ├── META-INF/MANIFEST.MF              declares 4 Nuxeo components
│   ├── OSGI-INF/
│   │   ├── cookbook-contrib.xml          cookbook imports (pre-existing)
│   │   ├── docucentral-core-contrib.xml  schema, doctypes, vocabularies,
│   │   │                                 lifecycle, permissions
│   │   ├── docucentral-automation-contrib.xml
│   │   │                                 scripted operations, event handlers,
│   │   │                                 scheduler, page providers
│   │   └── docucentral-ui-contrib.xml    Web UI resource registration
│   ├── schemas/docucentral.xsd           dcx: metadata schema
│   ├── directories/*.csv                 department / class / confidentiality
│   ├── i18n/messages.json                Web UI labels
│   └── ui/                               Polymer elements (layouts, actions,
│                                         dashboard, slot registrations)
└── scripts/                              fetch / validate / deploy / seed / test
```

The bundle carries **no Java**, so it builds fully offline and hot-reloads in
Nuxeo dev mode.

---

## 3. Content model

### Document types

| Type | Extends | Purpose |
|---|---|---|
| `DCControlledDocument` | `File` | The governed document (versionable, commentable, publishable) |
| `DCLibrary` | `Folder` | Department-level container |

### Schema `docucentral` (prefix `dcx:`)

> `dc:` is Dublin Core in Nuxeo, hence the `dcx:` prefix.

| Field | Type | Maintained by |
|---|---|---|
| `dcx:reference` | string | automation (`aboutToCreate`) — `DC-<DEPT>-<YYYY>-<NNNN>` |
| `dcx:documentClass` | string | user — vocabulary `dc_docclass` |
| `dcx:department` | string | user — vocabulary `dc_department` |
| `dcx:confidentiality` | string | user — vocabulary `dc_confidentiality`, defaults to `INTERNAL` |
| `dcx:owner` | string | user, defaults to the creator |
| `dcx:reviewers` | string list | user |
| `dcx:approver` | string | user |
| `dcx:effectiveDate` | date | automation (on publish) |
| `dcx:nextReviewDate` | date | automation (publish + review cycle) |
| `dcx:retentionYears` | long | user |
| `dcx:submittedBy` / `submittedOn` | string / date | automation |
| `dcx:approvedBy` / `approvedOn` | string / date | automation |
| `dcx:rejectionReason` | string | automation (on reject) |

### Vocabularies

| Directory | Entries |
|---|---|
| `dc_department` | PROC, FIN, LEG, IT, OPS, HR, QHSE |
| `dc_docclass` | POLICY, PROCEDURE, WORKINST, CONTRACT, TENDER, SPEC, REPORT, FORM |
| `dc_confidentiality` | PUBLIC, INTERNAL, CONFIDENTIAL, RESTRICTED |

---

## 4. Lifecycle

```
          submit                approve                publish
  draft ──────────► review ──────────► approved ──────────► published
    ▲                 │                   │                     │
    └─── reject ──────┴─── back_to_draft ─┴──── back_to_draft ──┘
                                                                │
                                                      to_obsolete▼
                                                            obsolete
```

Each transition is enforced by a scripted operation that refuses out-of-state
calls (verified by the smoke test), so the REST API cannot be used to skip a
step.

| Operation | Effect |
|---|---|
| `javascript.docucentral_SubmitForReview` | Grants `DCReview` to the reviewers, stamps `submittedBy/On`, moves to `review` |
| `javascript.docucentral_Approve` | Stamps `approvedBy/On`, clears any rejection reason, moves to `approved` |
| `javascript.docucentral_Reject` | Requires a reason, moves back to `draft` |
| `javascript.docucentral_Publish` | Sets the effective date and next review date, moves to `published`, snapshots a major version |
| `javascript.docucentral_AssignReference` | `aboutToCreate` handler; assigns the reference and defaults |
| `javascript.docucentral_FlagOverdueReviews` | Nightly at 02:15; writes an audit entry per overdue document |

All transitions go through the cookbook helper
`javascript.utils_FollowTransitionIfPossible` (from `automation-script-utils`),
so a repeated call warns instead of throwing.

---

## 5. Roles and permissions

| Group | Permission | Can |
|---|---|---|
| `dc-authors` | Write on their library | Create, edit and submit drafts |
| `dc-reviewers` | `DCReview` (granted per document on submit) | Read and comment during review |
| `dc-approvers` | `DCApprove` | Approve, reject, publish |
| `dc-readers` | Read | Read published documents |

`DCReview` and `DCApprove` are contributed permissions, visible in the
Web UI permission picker. The action bar hides Approve/Publish from users
without `DCApprove`.

---

## 6. Deployment runbook

| # | Step | Command | Expected |
|---|---|---|---|
| 1 | Point at your server | `cp config/nuxeo-local.properties.template config/nuxeo-local.properties`, then edit it | `NUXEO_URL`, `NUXEO_HOME` set (the copy is git-ignored, safe to hold real credentials) |
| 2 | Enable dev mode | add `org.nuxeo.dev=true` to `nuxeo.conf`, restart once | hot reload available |
| 3 | Check connectivity | `./scripts/check-server.sh` | `[OK] Server is running` |
| 4 | Validate the package | `./scripts/validate.sh` | `23 passed, 0 failed` |
| 5 | Build and deploy | `./scripts/deploy.sh` | JAR copied, `dev.bundles` written |
| 6 | Seed the baseline | `./scripts/docucentral-seed.sh` | groups + libraries + demo docs |
| 7 | Verify end to end | `./scripts/docucentral-smoke-test.sh` | all checks pass |

`deploy.sh` runs `validate.sh` as a gate and refuses to deploy a JAR whose
manifest lacks the `Nuxeo-Component` header, so a silently-ignored bundle
cannot reach the server.

---

## 7. Verification

| Layer | Tool | Runs without a server |
|---|---|---|
| Package integrity (XML, JSON, CSV, manifest, UI wiring) | `scripts/validate.sh` | yes |
| Build output (JAR manifest header) | `deploy.sh` step 1 | yes |
| Server reachability + package presence | `scripts/check-server.sh` | no |
| Lifecycle behaviour end to end | `scripts/docucentral-smoke-test.sh` | no |

The smoke test creates a throwaway document, walks it through the whole
lifecycle, asserts reference generation, state transitions, audit stamps,
version snapshot and the guard rail against double-publishing, then deletes it.

---

## 8. KPIs

| KPI | Definition | Source | Target |
|---|---|---|---|
| Cycle time, draft to published | mean days between `submittedOn` and `effectiveDate` | audit / metadata | < 10 days |
| Review backlog | documents in `review` older than 5 days | `DOCUCENTRAL_BY_STATUS` | < 10 |
| Overdue reviews | published documents past `nextReviewDate` | `DOCUCENTRAL_OVERDUE_REVIEW` | 0 |
| First-pass approval rate | approvals without a rejection round | `docucentral_rejected` audit events | > 80% |
| Metadata completeness | published documents with owner, class and retention set | query | 100% |

The dashboard surfaces the first three directly.

---

## 9. Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Reference sequence collides under concurrent creation | Duplicate references | MVP counts existing references; move to a Nuxeo `UIDSequencer` before high-volume use |
| Approvals rely on permissions, not workflow tasks | No task inbox or delegation | Phase 2: Studio graph workflow with parallel reviewer tasks |
| Web UI elements deployed as files, not through Studio | Drift between environments | Assets are in the bundle and copied by `deploy.sh`; keep Studio out of the loop or import once |
| Vocabularies seeded from CSV at first start | Later CSV edits are not re-imported | Manage entries in the Admin UI after go-live, or reset the directory table |
| Lifecycle bypass via direct `Document.FollowLifecycleTransition` | Unaudited state change | Restrict automation access; the scripted operations are the sanctioned path |

---

## 10. Roadmap

| Phase | Scope | Indicative effort |
|---|---|---|
| **MVP (done)** | Content model, lifecycle, guard rails, dashboard, deploy + verify tooling | — |
| **Phase 2** | Studio graph workflow, task inbox, delegation, email notifications (reuse `send-email-from-webui`) | 3–4 weeks |
| **Phase 3** | Retention schedule enforcement, legal hold, disposition review | 3 weeks |
| **Phase 4** | OCR and classification (reuse `google-vision-ocr`), full-text search facets | 4 weeks |
| **Phase 5** | Integration with ERP / CLM, bulk migration of legacy documents | scoped per source system |

Each phase reuses an existing cookbook module where one fits, rather than
adding new custom code.
