# ADR 0002 — Extension pattern: govern-lifecycle-on-top, don't rebuild the platform

## Status
Accepted (retroactively — this documents a pattern already proven by
`extensions/ecm-nuxeo-studio`, so later extensions follow it deliberately
instead of reinventing an approach each time)

## Context
`extensions/ecm-nuxeo-studio` needed controlled-document management
(policies, procedures, contracts) with a governed lifecycle, approvals,
and a dashboard. Nuxeo already provides document storage, versioning,
permissions, and a REST Automation API. Two approaches were available:

1. Build a bespoke document-management module from scratch (own storage,
   own API, own permission model).
2. Extend the existing platform's content model with a new document type,
   schema, and scripted lifecycle, reusing its storage, versioning,
   permissions, and API surface.

## Decision
Option 2, generalized as the pattern for any Roznama extension built on
top of an existing platform component (Onfinity or Nuxeo): define the
domain's **schema + document/entity type + lifecycle state machine +
scripted transition guards + a query-driven dashboard**, and let the
underlying platform keep doing storage, versioning, and permission
enforcement. No new API surface is created unless the platform genuinely
has no equivalent mechanism.

## Rationale
- Matches `docs/00-master-charter.md` §1 and §7: prefer existing platform
  capability over new infrastructure; avoid duplicating what already
  works.
- Concretely proven: the DocuCentral MVP shipped with **no Java code, no
  new API endpoint, and no new datastore** — just XML/JS contributions —
  and still delivers a 5-state governed lifecycle with guard rails, an
  auto-generated reference number, and a governance dashboard (see
  `extensions/ecm-nuxeo-studio/docs/DOCUCENTRAL.md`).
- The lifecycle-state-machine + scripted-transition-guard shape is
  reusable: `docs/brand-domain-model.md` already flags Workflow/Approval/
  KPI as "pattern proven in ECM extension" for reuse elsewhere (e.g. a
  future Purchase Request or Contract approval flow on the Onfinity side).

## Consequences
- Before starting a new business extension (Sales, Procurement,
  Inventory, Contracts, …), check whether the need is "a governed
  lifecycle on an entity" — if so, default to this pattern rather than a
  bespoke service, regardless of which underlying platform (Onfinity or
  Nuxeo) hosts the entity.
- This pattern assumes the underlying platform's permission model is
  expressive enough for the guard rails needed (Nuxeo's contributed
  permissions were sufficient for DocuCentral's `DCReview`/`DCApprove`).
  Where Onfinity's model isn't expressive enough for a given extension,
  that's a documented exception, not a silent deviation — record it in
  the relevant `docs/0X-*.md` finding.
- Does not apply to genuinely new capability with no platform analogue
  (e.g. the AI orchestrator, or BI aggregation across modules) — those
  extensions design their own service layer as normal.
