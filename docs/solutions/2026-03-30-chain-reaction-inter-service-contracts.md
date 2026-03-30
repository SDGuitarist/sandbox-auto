---
tags: [swarm, shared-spec, inter-service, chain-reaction, state-machine, dedup]
module: sandbox-auto
problem: Shared spec breaks at cross-module boundaries when two services write to the same table
severity: P2 (double status_update writes)
lesson: Shared state across services needs explicit ownership assignment in the spec — "who writes what" must be a spec section
---

# Chain Reaction Build — Inter-Service Contract Lessons

## Problem

Built a 5-service incident pipeline (cron → incident manager → notification service → status page + admin dashboard) with 4 parallel swarm agents. The shared spec defined types, endpoints, CSS classes, and database schema. The alignment check found 2 bugs in 10 files — down from 7 in the first build but not zero.

## What Broke

### Bug 1: Field access mismatch (inc.sites.name vs inc.site_name)
The incident manager flattens the Supabase JOIN result (strips `sites` object, adds `site_name` as top-level field). The admin dashboard agent assumed the Supabase JOIN structure would be preserved (`inc.sites.name`). The spec defined the TypeScript types but didn't specify whether the API would return flat or nested objects.

### Bug 2: Double status_update writes
Both `incidents.js` and `notifications.js` inserted into the `status_updates` table for the same events. The spec said the Notification Service should create status updates, but the Incident Manager agent also added them as part of the state transition logic. Neither agent was wrong — the spec was ambiguous about ownership.

## Solution

### Spec needs a "Data Ownership" section
For every shared table, the spec must declare which service WRITES to it:

```markdown
### Data Ownership (who writes what)
| Table | Writer | Reader(s) |
|-------|--------|-----------|
| incidents | Incident Manager only | All services |
| notifications | Notification Service only | Admin dashboard |
| status_updates | Incident Manager only | Status page, Admin dashboard |
| checks | Cron Worker only | All services |
| sites | API Server only | All services |
```

### Spec needs explicit "API response shape" examples
Instead of just TypeScript types, show the actual JSON that the API returns:

```markdown
### GET /api/incidents response (flat, not nested)
{ "incidents": [{ "id": "...", "site_name": "Google", "site_url": "..." }] }
// Note: site_name is a top-level field, NOT incidents.sites.name
```

## Patterns

1. **Data ownership is the #1 gap in shared specs** — types and endpoints aren't enough. Every table needs one declared writer.
2. **Flat vs nested API responses must be specified** — Supabase JOINs return nested objects by default. If the API flattens them, the spec must say so.
3. **Cross-module writes are always a bug risk** — if two modules can write to the same table, they will eventually conflict. Assign one owner.
4. **The shared spec scales to 10 files but not perfectly** — 2 bugs in 10 files (0.2 per file) vs 0 bugs in 5 files. The failure mode is at module interaction boundaries, not within individual files.
5. **Database-level constraints catch what specs miss** — the unique partial index prevented duplicate incidents even when the application-level dedup had a race window.

## Risk Resolution

- **Flagged risk (plan Feed-Forward):** Inter-service event ordering — duplicate incidents from overlapping cron runs
- **What actually happened:** The database unique partial index prevented duplicates. The race window exists (consecutive_failures can double-increment) but is acceptable. The REAL bugs were at a different boundary — data ownership ambiguity between incident manager and notification service.
- **Lesson:** Feed-Forward correctly identified the riskiest SERVICE but not the riskiest INTERFACE. The cron→incident boundary was solid. The incident→notification boundary broke. For complex pipelines, Feed-Forward should flag every service-to-service boundary, not just the most obvious one.

## Feed-Forward

- **Hardest decision:** Whether to have incidents.js or notifications.js own status_update writes. Chose incidents.js because status updates are part of the state transition, not the notification.
- **Rejected alternatives:** Having a third "status update service" that both incident manager and notification service call. Over-engineering for a sandbox.
- **Least confident:** Whether the "data ownership" spec pattern scales to 20+ tables across 10+ services. At Pacific Flow mesh scale, ownership conflicts will be more subtle and harder to spot in a spec document. May need automated contract testing instead of a markdown document.
