-- Uptime Pulse: Sites + Checks tables
-- Run this in Supabase SQL Editor

-- Table: sites
CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: checks
CREATE TABLE IF NOT EXISTS checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  status_code INTEGER,
  response_time_ms INTEGER,
  is_up BOOLEAN NOT NULL,
  error TEXT,
  checked_at TIMESTAMPTZ DEFAULT now()
);

-- Index for dashboard queries (recent checks per site)
CREATE INDEX IF NOT EXISTS idx_checks_site_id_checked_at ON checks(site_id, checked_at DESC);

-- RLS
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE checks ENABLE ROW LEVEL SECURITY;

-- Sites: anyone can read active sites (anon key), only service role can write
CREATE POLICY "Anyone can read active sites" ON sites
  FOR SELECT USING (is_active = true);

-- Checks: anyone can read, only service role can insert
CREATE POLICY "Anyone can read checks" ON checks
  FOR SELECT USING (true);

-- Enable realtime on checks table for live dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE checks;
