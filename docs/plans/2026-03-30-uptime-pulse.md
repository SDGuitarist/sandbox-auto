---
title: Uptime Pulse — Site Monitor Pipeline
origin: conversation
feed_forward:
  risk: "Multi-service deploy coordination — 4 deploys (Supabase, Railway API, Railway cron, GitHub Pages) must happen in correct order with correct env vars"
  verify_first: true
---

# Uptime Pulse — Site Monitor Pipeline

## What is changing?

Building a 5-component site monitoring app:
1. **API Server** (Express on Railway) — CRUD for sites, webhook receiver, serves check results
2. **Cron Worker** (Node script on Railway cron) — pings all registered sites every 5 minutes
3. **Database** (Supabase) — stores sites and check results
4. **Frontend Dashboard** (GitHub Pages) — shows status, uptime %, response time charts, real-time updates
5. **Shared Interface Spec** — contract document all agents reference

## What must NOT change?

- Existing apps (index.html TIL, health/ journal) stay untouched
- Existing GitHub Pages workflow works for frontend
- No real sensitive data — sandbox only
- Supabase free tier limits respected (no excessive polling)

## How will we know it worked?

1. Can add a site via API: `POST /api/sites { url, name }`
2. Cron runs and pings all registered sites, stores results in Supabase
3. Dashboard loads at `sdguitarist.github.io/sandbox-auto/pulse/`
4. Dashboard shows: site list with status badges, uptime % cards, response time chart
5. Real-time: adding a new check result updates the dashboard without refresh
6. Can delete a site via API: `DELETE /api/sites/:id`

## Most likely way this plan is wrong?

- Railway cron service setup may differ from what we expect — need to verify Railway's cron job configuration
- Supabase Realtime requires specific RLS + publication config that's easy to get wrong
- The cron worker and API server may need to be the same Railway service (simpler) rather than separate services
- CORS between GitHub Pages frontend and Railway API needs explicit configuration

---

## Shared Interface Spec

**This is the contract. All agents MUST read this section before building.**

### Database Schema (Supabase)

```sql
-- Table: sites
CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: checks
CREATE TABLE checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  status_code INTEGER,
  response_time_ms INTEGER,
  is_up BOOLEAN NOT NULL,
  error TEXT,
  checked_at TIMESTAMPTZ DEFAULT now()
);

-- Index for dashboard queries
CREATE INDEX idx_checks_site_id_checked_at ON checks(site_id, checked_at DESC);

-- Enable realtime on checks table
ALTER PUBLICATION supabase_realtime ADD TABLE checks;
```

### API Endpoints (Express on Railway)

| Method | Path | Body | Response | Purpose |
|--------|------|------|----------|---------|
| GET | /api/sites | — | `{ sites: Site[] }` | List all active sites |
| POST | /api/sites | `{ name, url }` | `{ site: Site }` | Add a site to monitor |
| DELETE | /api/sites/:id | — | `{ success: true }` | Remove a site |
| GET | /api/sites/:id/checks | ?limit=50 | `{ checks: Check[] }` | Get recent checks for a site |
| GET | /api/stats | — | `{ stats: SiteStats[] }` | Get uptime % and avg response time per site |
| POST | /api/cron/run | — | `{ results: CheckResult[] }` | Trigger a check run (called by cron) |
| GET | /health | — | `{ status: "ok" }` | Health check |

### TypeScript Types (shared between API and frontend)

```typescript
interface Site {
  id: string;
  name: string;
  url: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface Check {
  id: string;
  site_id: string;
  status_code: number | null;
  response_time_ms: number | null;
  is_up: boolean;
  error: string | null;
  checked_at: string;
}

interface SiteStats {
  site_id: string;
  name: string;
  url: string;
  uptime_pct: number;       // 0-100, last 24 hours
  avg_response_ms: number;  // last 24 hours
  last_check: Check | null;
  status: 'up' | 'down' | 'unknown';
}

interface CheckResult {
  site_id: string;
  status_code: number | null;
  response_time_ms: number | null;
  is_up: boolean;
  error: string | null;
}
```

### Frontend Structure (pulse/)

```
pulse/
  index.html      — app shell, loads JS/CSS
  app.js          — all logic
  styles.css      — all styles
```

### CSS Class Names (frontend contract)

| Class | Element | Purpose |
|-------|---------|---------|
| `.site-card` | div | Card for each monitored site |
| `.site-card.status-up` | div | Green left border when up |
| `.site-card.status-down` | div | Red left border when down |
| `.site-card.status-unknown` | div | Gray left border when unknown |
| `.status-badge` | span | Small colored pill showing UP/DOWN |
| `.status-badge.up` | span | Green badge |
| `.status-badge.down` | span | Red badge |
| `.stat-card` | div | Summary statistic card |
| `.stat-value` | span | Large number in stat card |
| `.stat-label` | span | Label below number |
| `.chart-container` | div | Wrapper for Chart.js canvas |
| `.add-site-form` | form | Form to add new site |
| `.site-list` | div | Container for all site cards |
| `.filters` | div | Filter/control bar |
| `.empty-state` | div | Shown when no sites registered |
| `.error-toast` | div | Error notification |
| `.loading` | div | Loading spinner |

### CSS Variables (same palette as health journal)

```css
:root {
  --bg: #1a1a2e;
  --card: #16213e;
  --border: #333;
  --text: #e0e0e0;
  --accent: #c9a96e;
  --accent-light: #e8d5b7;
  --up: #2ecc71;
  --down: #e74c3c;
  --warning: #f39c12;
  --radius: 8px;
}
```

### Element IDs (frontend contract)

| ID | Element | Purpose |
|----|---------|---------|
| `#sites-list` | div | Container for site cards |
| `#add-site-form` | form | Add site form |
| `#site-url` | input | URL input |
| `#site-name` | input | Name input |
| `#total-sites` | span | Stat: total sites count |
| `#sites-up` | span | Stat: sites currently up |
| `#avg-uptime` | span | Stat: average uptime % |
| `#avg-response` | span | Stat: average response time |
| `#response-chart` | canvas | Chart.js response time chart |
| `#uptime-chart` | canvas | Chart.js uptime chart |
| `#error-toast` | div | Error toast container |

### Environment Variables

**Railway API Server:**
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_KEY` — Service role key (bypasses RLS)
- `CRON_SECRET` — Shared secret for cron endpoint auth
- `ALLOWED_ORIGINS` — Comma-separated CORS origins
- `PORT` — Railway auto-injects

**Frontend (hardcoded in app.js for sandbox):**
- Supabase anon key (public, read-only via RLS)
- Railway API URL
- These are NOT secrets — anon key is designed to be public, RLS protects the data

### RLS Policies

```sql
-- Sites: anyone can read active sites (anon key), only service role can write
CREATE POLICY "Anyone can read active sites" ON sites
  FOR SELECT USING (is_active = true);

-- Checks: anyone can read, only service role can insert
CREATE POLICY "Anyone can read checks" ON checks
  FOR SELECT USING (true);
```

---

## Implementation Order

1. **Database** — Run migrations in Supabase SQL Editor
2. **API Server** — Express app with all endpoints + cron handler
3. **Frontend** — Dashboard with Chart.js, Supabase Realtime
4. **Deploy API** — Push to Railway, set env vars
5. **Deploy Frontend** — Push to GitHub Pages
6. **Test** — Add sites, trigger cron, verify dashboard

## Architecture Decision: Combined API + Cron

Instead of separate Railway services, the cron worker is a protected endpoint on the API server (`POST /api/cron/run` with `CRON_SECRET` header). Railway's cron job feature hits this endpoint on schedule. This is simpler than a separate service and avoids duplicating Supabase connection config.

## Feed-Forward

- **Hardest decision:** Combined API+cron vs separate services. Combined is simpler but means a cron failure could affect API availability if the check run is slow. Mitigated by running checks with Promise.allSettled and a 10-second timeout per site.
- **Rejected alternatives:** Supabase Edge Functions for cron (would simplify deploy but adds vendor lock-in and debugging is harder). Separate Railway service for worker (more realistic but doubles deploy complexity for a sandbox test).
- **Least confident:** Multi-service deploy coordination — Supabase migrations, Railway deploy with env vars, GitHub Pages frontend all need to happen in the right order with the right config. This is where automation is most likely to break.
