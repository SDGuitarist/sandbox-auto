-- Uptime Pulse v2: Incidents, Notifications, Status Updates
-- Run this in Supabase SQL Editor AFTER 001_create_tables.sql

-- Incidents: tracks site outages
CREATE TABLE IF NOT EXISTS incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'detected',
  severity TEXT NOT NULL DEFAULT 'minor',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  duration_ms INTEGER,
  consecutive_failures INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Only one open incident per site at a time (dedup protection)
CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_open_per_site
  ON incidents(site_id) WHERE status != 'resolved';

-- Notifications: log of all alerts sent
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Status updates: public-facing incident timeline
CREATE TABLE IF NOT EXISTS status_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id UUID REFERENCES incidents(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE status_updates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read incidents" ON incidents FOR SELECT USING (true);
CREATE POLICY "Anyone can read status_updates" ON status_updates FOR SELECT USING (true);

-- Realtime for live status page
ALTER PUBLICATION supabase_realtime ADD TABLE incidents;
ALTER PUBLICATION supabase_realtime ADD TABLE status_updates;
