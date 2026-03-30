---
title: Uptime Pulse v2 — Incident Pipeline (Chain Reaction)
origin: conversation
feed_forward:
  risk: "Inter-service event ordering — if two cron runs overlap, both could create duplicate incidents for the same site. Dedup logic in Incident Manager is the single point of failure."
  verify_first: true
---

# Uptime Pulse v2 — Incident Pipeline

## What is changing?

Adding an incident detection and notification pipeline on top of the existing Uptime Pulse monitoring system. When a site goes DOWN, a chain of services triggers automatically:

```
Cron detects DOWN → Incident Manager creates/updates incident → Notification Service sends alert → Status Page updates
Cron detects UP   → Incident Manager resolves incident → Notification Service sends "resolved" → Status Page updates
```

## What must NOT change?

- Existing Uptime Pulse v1 (API server, cron, dashboard) stays functional
- Existing Supabase tables (sites, checks) unchanged
- GitHub Pages deploy workflow unchanged
- SSRF protection, timing-safe auth, and other security fixes preserved

## How will we know it worked?

1. Add a site that returns 500 → cron detects it → incident auto-created with severity
2. Incident shows on public status page in real-time
3. Notification sent (logged to notifications table, optionally webhook)
4. Site comes back up → incident auto-resolved → "resolved" notification → status page updates
5. Admin dashboard shows incident timeline with durations
6. Two rapid cron runs don't create duplicate incidents for the same site

## Most likely way this plan is wrong?

- Dedup logic: if cron fires while Incident Manager is still processing the previous run, we get race conditions
- Supabase Realtime may have latency that makes the status page feel stale
- The notification webhook might fail silently if the target is unreachable
- The shared spec is the biggest it's ever been — 8 agents might find gaps we didn't anticipate

---

## SHARED INTERFACE SPEC — ALL AGENTS MUST READ THIS

### New Database Tables (Supabase)

```sql
-- Incidents: tracks site outages
CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'detected',  -- detected | confirmed | resolved
  severity TEXT NOT NULL DEFAULT 'minor',   -- minor | major | critical
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  duration_ms INTEGER,
  consecutive_failures INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Only one open incident per site at a time
CREATE UNIQUE INDEX idx_incidents_open_per_site
  ON incidents(site_id) WHERE status != 'resolved';

-- Notifications: log of all alerts sent
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,          -- 'webhook' | 'log'
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | sent | failed
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Status updates: public-facing incident timeline
CREATE TABLE status_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  type TEXT NOT NULL,             -- 'detected' | 'confirmed' | 'resolved'
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read incidents" ON incidents FOR SELECT USING (true);
CREATE POLICY "Anyone can read status_updates" ON status_updates FOR SELECT USING (true);
-- notifications: service role only (no public read)

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE status_updates;
```

### Inter-Service Event Chain

This is the critical contract. Each service's output is the next service's input.

```
┌─────────────┐    CheckResult[]     ┌───────────────────┐
│ Cron Worker  │ ──────────────────→  │ Incident Manager  │
│ (existing)   │   POST /api/         │ (new endpoint)    │
└─────────────┘   incidents/process   └────────┬──────────┘
                                               │
                                    IncidentEvent (insert/update)
                                               │
                                               ▼
                                    ┌───────────────────┐
                                    │ Notification Svc   │
                                    │ (Supabase trigger) │
                                    └────────┬──────────┘
                                             │
                                  StatusUpdate + Notification
                                             │
                                             ▼
                              ┌──────────────────────────────┐
                              │ Status Page + Admin Dashboard │
                              │ (Supabase Realtime)           │
                              └──────────────────────────────┘
```

### API Endpoints (additions to existing Express server)

| Method | Path | Body/Params | Response | Called By |
|--------|------|-------------|----------|-----------|
| POST | /api/incidents/process | `{ results: CheckResult[] }` | `{ incidents: IncidentEvent[] }` | Cron worker (internal) |
| GET | /api/incidents | ?status=detected,confirmed | `{ incidents: Incident[] }` | Admin dashboard |
| GET | /api/incidents/:id | — | `{ incident, updates, notifications }` | Admin dashboard |
| POST | /api/incidents/:id/resolve | — | `{ incident }` | Admin (manual resolve) |
| GET | /api/status | — | `{ sites: StatusSummary[] }` | Public status page |
| POST | /api/notifications/send | `{ incident_id, type }` | `{ notification }` | Incident Manager (internal) |

### TypeScript Types (shared contract)

```typescript
// Existing (unchanged)
interface CheckResult {
  site_id: string;
  status_code: number | null;
  response_time_ms: number | null;
  is_up: boolean;
  error: string | null;
}

// New types
interface Incident {
  id: string;
  site_id: string;
  status: 'detected' | 'confirmed' | 'resolved';
  severity: 'minor' | 'major' | 'critical';
  started_at: string;
  confirmed_at: string | null;
  resolved_at: string | null;
  duration_ms: number | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

interface IncidentEvent {
  action: 'created' | 'confirmed' | 'resolved' | 'updated';
  incident: Incident;
  site_name: string;
  site_url: string;
}

interface Notification {
  id: string;
  incident_id: string;
  channel: 'webhook' | 'log';
  payload: object;
  status: 'pending' | 'sent' | 'failed';
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

interface StatusUpdate {
  id: string;
  incident_id: string;
  type: 'detected' | 'confirmed' | 'resolved';
  message: string;
  created_at: string;
}

interface StatusSummary {
  site_id: string;
  site_name: string;
  site_url: string;
  current_status: 'operational' | 'degraded' | 'down';
  active_incident: Incident | null;
  recent_updates: StatusUpdate[];
  uptime_pct_24h: number;
}
```

### Incident Manager Logic (CRITICAL — dedup + state machine)

```
ON process(results):
  FOR EACH result:
    IF result.is_up == false:
      existing = SELECT FROM incidents WHERE site_id = result.site_id AND status != 'resolved'
      IF existing:
        existing.consecutive_failures += 1
        IF existing.consecutive_failures >= 3 AND existing.status == 'detected':
          existing.status = 'confirmed'
          existing.confirmed_at = now()
          existing.severity = calculate_severity(existing.consecutive_failures)
          → create status_update('confirmed', ...)
          → call notification service
        ELSE:
          UPDATE existing (increment failures)
      ELSE:
        INSERT new incident (status='detected', consecutive_failures=1)
        → create status_update('detected', ...)
        → call notification service (if severity warrants)

    IF result.is_up == true:
      existing = SELECT FROM incidents WHERE site_id = result.site_id AND status != 'resolved'
      IF existing:
        existing.status = 'resolved'
        existing.resolved_at = now()
        existing.duration_ms = resolved_at - started_at
        → create status_update('resolved', ...)
        → call notification service
```

**Severity calculation:**
- 1-2 consecutive failures → minor
- 3-5 consecutive failures → major
- 6+ consecutive failures → critical

**Dedup protection:** The unique partial index `idx_incidents_open_per_site` prevents two incidents for the same site at the database level. If two cron runs race, the second INSERT will fail with a unique constraint violation — catch it and treat as "already exists."

### Notification Service Logic

```
ON send(incident_id, type):
  incident = SELECT FROM incidents WHERE id = incident_id (JOIN sites)
  payload = {
    type: type,               // 'detected' | 'confirmed' | 'resolved'
    site_name: site.name,
    site_url: site.url,
    severity: incident.severity,
    message: generate_message(type, incident),
    timestamp: now()
  }
  INSERT INTO notifications (incident_id, channel='log', payload, status='sent', sent_at=now())
  INSERT INTO status_updates (incident_id, type, message)
  IF WEBHOOK_URL env var is set:
    try fetch(WEBHOOK_URL, { method: 'POST', body: payload })
    UPDATE notification status = 'sent' or 'failed'
```

For the sandbox, notifications are logged to the database only. Webhook is optional (if WEBHOOK_URL env var is set).

### Frontend Structure

**Public Status Page** (`status/`):
```
status/
  index.html    — public status page
  status.js     — logic
  status.css    — styles
```

**Admin Dashboard** (enhance existing `pulse/`):
- Add incidents tab/section to existing dashboard
- Show incident timeline, active incidents, MTTR stats

### CSS Class Names — Status Page

| Class | Element | Purpose |
|-------|---------|---------|
| `.status-header` | div | Top banner with overall status |
| `.status-operational` | div | Green banner — all systems operational |
| `.status-degraded` | div | Yellow banner — some issues |
| `.status-down` | div | Red banner — major outage |
| `.site-status-row` | div | Row per monitored site |
| `.site-status-row.operational` | div | Green dot |
| `.site-status-row.degraded` | div | Yellow dot |
| `.site-status-row.down` | div | Red dot |
| `.status-dot` | span | Colored circle indicator |
| `.incident-card` | div | Card showing an incident |
| `.incident-card.minor` | div | Blue left border |
| `.incident-card.major` | div | Yellow left border |
| `.incident-card.critical` | div | Red left border |
| `.incident-timeline` | div | Container for incident updates |
| `.timeline-entry` | div | Single update in timeline |
| `.timeline-dot` | span | Dot on timeline |

### Element IDs — Status Page

| ID | Purpose |
|----|---------|
| `#overall-status` | Banner showing overall status |
| `#sites-status-list` | Container for site status rows |
| `#incidents-list` | Container for active incident cards |
| `#incident-history` | Container for resolved incidents |

### CSS Variables — Status Page (extend existing palette)

```css
:root {
  /* existing vars unchanged */
  --operational: #2ecc71;
  --degraded: #f39c12;
  --outage: #e74c3c;
}
```

### Element IDs — Admin Dashboard (additions to existing pulse/)

| ID | Purpose |
|----|---------|
| `#incidents-section` | New section in admin dashboard |
| `#active-incidents` | List of active incidents |
| `#incident-timeline` | Timeline for selected incident |
| `#mttr-stat` | Mean time to resolve stat card |
| `#open-incidents-stat` | Count of open incidents |

### Environment Variables (additions)

| Var | Service | Purpose |
|-----|---------|---------|
| `WEBHOOK_URL` | API Server | Optional webhook for notifications |

### Cron Worker Changes

After the existing `POST /api/cron/run` inserts check results, it also calls:
```
POST /api/incidents/process
Body: { results: CheckResult[] }
Header: x-cron-secret: CRON_SECRET
```

This is an internal call from the cron handler to the incident processor, both on the same Express server.

---

## Implementation Order

1. **Database migration** — new tables (incidents, notifications, status_updates)
2. **Incident Manager** — `/api/incidents/process` endpoint with dedup + state machine
3. **Notification Service** — `/api/notifications/send` endpoint
4. **Cron integration** — wire cron to call incident processor after checks
5. **Incident query endpoints** — GET /api/incidents, GET /api/incidents/:id, GET /api/status
6. **Public Status Page** — status/index.html, status.js, status.css
7. **Admin Dashboard updates** — incidents section in pulse/
8. **Integration test script** — shell script that exercises the full chain

## Swarm Agent Assignment

| Agent | Files | Dependencies |
|-------|-------|-------------|
| 1. Migration | supabase/migrations/002_incidents.sql | None |
| 2. Incident Manager | pulse-api/incidents.js | Spec only |
| 3. Notification Service | pulse-api/notifications.js | Spec only |
| 4. Cron Integration | pulse-api/server.js (modify) | Agents 2,3 |
| 5. Incident Endpoints | pulse-api/server.js (modify) | Agent 2 |
| 6. Status Page CSS | status/status.css | Spec only |
| 7. Status Page HTML+JS | status/index.html, status/status.js | Spec only |
| 8. Admin Dashboard Updates | pulse/app.js, pulse/index.html (modify) | Spec only |

Agents 2, 3, 6, 7, 8 can run in parallel (they only need the spec).
Agents 4, 5 depend on 2 and 3 (they modify server.js to import those modules).
Agent 1 runs first (migration needed before anything else).

## Feed-Forward

- **Hardest decision:** Whether the Incident Manager should be a separate service or an endpoint on the same Express server. Chose same server to reduce deploy complexity, but this means a slow incident processing run could block API requests.
- **Rejected alternatives:** Supabase Edge Functions for the incident pipeline (would decouple from Express but adds a second deploy target and harder debugging). Separate Railway service for incident processing (more realistic but doubles infra for a sandbox).
- **Least confident:** Inter-service event ordering — if two cron runs overlap, both could create duplicate incidents for the same site. The unique partial index is the safety net, but the catch-and-retry logic around constraint violations hasn't been tested under load. This is the single most likely failure point.
