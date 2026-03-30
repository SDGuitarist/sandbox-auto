const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const dns = require("dns").promises;
const createIncidentManager = require("./incidents");
const createNotificationService = require("./notifications");

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS;

if (!SUPABASE_URL) console.warn("WARNING: SUPABASE_URL is not set");
if (!SUPABASE_SERVICE_KEY)
  console.warn("WARNING: SUPABASE_SERVICE_KEY is not set");

// ---------------------------------------------------------------------------
// Supabase client (service role — bypasses RLS)
// ---------------------------------------------------------------------------
const supabase =
  SUPABASE_URL && SUPABASE_SERVICE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    : null;

// ---------------------------------------------------------------------------
// Incident & Notification services
// ---------------------------------------------------------------------------
const incidentManager = supabase ? createIncidentManager(supabase) : null;
const notificationService = supabase ? createNotificationService(supabase) : null;

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

// CORS — use ALLOWED_ORIGINS if set, otherwise allow all
const corsOrigins = ALLOWED_ORIGINS
  ? ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : "*";
app.use(cors({ origin: corsOrigins }));

// JSON body parsing
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// ---------------------------------------------------------------------------
// SSRF Protection — block private/reserved IP ranges
// ---------------------------------------------------------------------------
const BLOCKED_HOSTS = new Set([
  "localhost", "metadata.google.internal", "metadata.aws.internal",
]);

function isPrivateIP(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4) return ip === "::1" || ip.startsWith("fc00:") || ip.startsWith("fe80:");
  return (
    parts[0] === 127 ||
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254) ||
    parts[0] === 0
  );
}

async function validateUrlForFetch(urlStr) {
  let parsed;
  try { parsed = new URL(urlStr); } catch { return "Invalid URL format"; }
  if (!["http:", "https:"].includes(parsed.protocol)) return "URL must use http or https";
  if (BLOCKED_HOSTS.has(parsed.hostname)) return "Blocked hostname";
  if (urlStr.length > 2048) return "URL too long";
  try {
    const { address } = await dns.lookup(parsed.hostname);
    if (isPrivateIP(address)) return "URL resolves to a private IP address";
  } catch { return "Cannot resolve hostname"; }
  return null;
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// GET /api/sites — list all active sites
// ---------------------------------------------------------------------------
app.get("/api/sites", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("sites")
      .select("*")
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase error:", error); return res.status(500).json({ error: "Internal server error" });
    }
    return res.json({ sites: data });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch sites" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/sites — add a site to monitor
// ---------------------------------------------------------------------------
app.post("/api/sites", async (req, res) => {
  try {
    const { name, url } = req.body;

    // Validate inputs
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "name is required and must be a non-empty string" });
    }
    if (!url || typeof url !== "string" || url.trim().length === 0) {
      return res.status(400).json({ error: "url is required and must be a non-empty string" });
    }
    if (name.trim().length > 100) {
      return res.status(400).json({ error: "name must be 100 characters or less" });
    }
    const urlError = await validateUrlForFetch(url.trim());
    if (urlError) {
      return res.status(400).json({ error: urlError });
    }

    const { data, error } = await supabase
      .from("sites")
      .insert({ name: name.trim(), url: url.trim() })
      .select()
      .single();

    if (error) {
      console.error("Supabase error:", error); return res.status(500).json({ error: "Internal server error" });
    }
    return res.status(201).json({ site: data });
  } catch (err) {
    return res.status(500).json({ error: "Failed to create site" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/sites/:id — soft delete (set is_active = false)
// ---------------------------------------------------------------------------
app.delete("/api/sites/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from("sites")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) {
      console.error("Supabase error:", error); return res.status(500).json({ error: "Internal server error" });
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete site" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/sites/:id/checks — recent checks for a site
// ---------------------------------------------------------------------------
app.get("/api/sites/:id/checks", async (req, res) => {
  try {
    const { id } = req.params;
    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 200) limit = 200;

    const { data, error } = await supabase
      .from("checks")
      .select("*")
      .eq("site_id", id)
      .order("checked_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Supabase error:", error); return res.status(500).json({ error: "Internal server error" });
    }
    return res.json({ checks: data });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch checks" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats — uptime %, avg response time, status per active site
// ---------------------------------------------------------------------------
app.get("/api/stats", async (_req, res) => {
  try {
    // Fetch all active sites
    const { data: sites, error: sitesErr } = await supabase
      .from("sites")
      .select("*")
      .eq("is_active", true);

    if (sitesErr) {
      return res.status(500).json({ error: sitesErr.message });
    }

    const twentyFourHoursAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString();

    const stats = await Promise.all(
      sites.map(async (site) => {
        // Checks in the last 24 hours
        const { data: recentChecks, error: checksErr } = await supabase
          .from("checks")
          .select("*")
          .eq("site_id", site.id)
          .gte("checked_at", twentyFourHoursAgo)
          .order("checked_at", { ascending: false });

        if (checksErr) {
          return {
            site_id: site.id,
            name: site.name,
            url: site.url,
            uptime_pct: 0,
            avg_response_ms: 0,
            last_check: null,
            status: "unknown",
          };
        }

        const total = recentChecks.length;
        const upCount = recentChecks.filter((c) => c.is_up).length;
        const uptime_pct = total > 0 ? Math.round((upCount / total) * 10000) / 100 : 0;

        const responseTimes = recentChecks
          .map((c) => c.response_time_ms)
          .filter((t) => t != null);
        const avg_response_ms =
          responseTimes.length > 0
            ? Math.round(
                responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
              )
            : 0;

        const last_check = recentChecks.length > 0 ? recentChecks[0] : null;

        let status = "unknown";
        if (last_check) {
          status = last_check.is_up ? "up" : "down";
        }

        return {
          site_id: site.id,
          name: site.name,
          url: site.url,
          uptime_pct,
          avg_response_ms,
          last_check,
          status,
        };
      })
    );

    return res.json({ stats });
  } catch (err) {
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/cron/run — trigger a check run (protected by CRON_SECRET)
// ---------------------------------------------------------------------------
app.post("/api/cron/run", async (req, res) => {
  try {
    // Auth check (timing-safe comparison)
    const secret = req.headers["x-cron-secret"] || "";
    if (!CRON_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const expected = Buffer.from(CRON_SECRET);
    const received = Buffer.from(secret);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Fetch all active sites
    const { data: sites, error: sitesErr } = await supabase
      .from("sites")
      .select("*")
      .eq("is_active", true);

    if (sitesErr) {
      return res.status(500).json({ error: sitesErr.message });
    }

    if (sites.length === 0) {
      return res.json({ results: [], checked_at: new Date().toISOString() });
    }

    // Ping each site with a 10-second timeout
    const checkPromises = sites.map(async (site) => {
      const startTime = Date.now();
      try {
        // SSRF check before fetching
        const ssrfError = await validateUrlForFetch(site.url);
        if (ssrfError) {
          return { site_id: site.id, status_code: null, response_time_ms: 0, is_up: false, error: "Blocked: " + ssrfError };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(site.url, { signal: controller.signal });
        clearTimeout(timeout);

        const response_time_ms = Date.now() - startTime;
        const status_code = response.status;
        const is_up = status_code >= 200 && status_code <= 399;

        return {
          site_id: site.id,
          status_code,
          response_time_ms,
          is_up,
          error: null,
        };
      } catch (err) {
        const response_time_ms = Date.now() - startTime;
        return {
          site_id: site.id,
          status_code: null,
          response_time_ms,
          is_up: false,
          error: err.name === "AbortError" ? "Timeout (10s)" : err.message,
        };
      }
    });

    const results = await Promise.all(checkPromises);

    // Insert all results into checks table
    const { error: insertErr } = await supabase.from("checks").insert(results);

    if (insertErr) {
      console.error("Supabase error:", insertErr);
      return res.status(500).json({ error: "Internal server error" });
    }

    // Process results through incident pipeline
    if (incidentManager && notificationService) {
      try {
        const events = await incidentManager.processResults(results);
        for (const event of events) {
          await notificationService.sendNotification(event);
        }
      } catch (pipelineErr) {
        console.error("Incident pipeline error:", pipelineErr);
        // Don't fail the cron response — checks were saved successfully
      }
    }

    return res.json({ results, checked_at: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: "Failed to run checks" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/incidents/process — process check results through incident pipeline
// ---------------------------------------------------------------------------
app.post("/api/incidents/process", async (req, res) => {
  try {
    const secret = req.headers["x-cron-secret"] || "";
    if (!CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
    const expected = Buffer.from(CRON_SECRET);
    const received = Buffer.from(secret);
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { results } = req.body;
    if (!Array.isArray(results)) return res.status(400).json({ error: "results must be an array" });

    const events = await incidentManager.processResults(results);
    for (const event of events) {
      await notificationService.sendNotification(event);
    }
    return res.json({ incidents: events });
  } catch (err) {
    console.error("Incident process error:", err);
    return res.status(500).json({ error: "Failed to process incidents" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/incidents — list incidents
// ---------------------------------------------------------------------------
app.get("/api/incidents", async (req, res) => {
  try {
    const statusFilter = req.query.status || null;
    const incidents = await incidentManager.getIncidents(statusFilter);
    return res.json({ incidents });
  } catch (err) {
    console.error("Get incidents error:", err);
    return res.status(500).json({ error: "Failed to fetch incidents" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/incidents/:id — single incident with updates and notifications
// ---------------------------------------------------------------------------
app.get("/api/incidents/:id", async (req, res) => {
  try {
    const result = await incidentManager.getIncidentById(req.params.id);
    if (!result || !result.incident) return res.status(404).json({ error: "Incident not found" });
    return res.json(result);
  } catch (err) {
    console.error("Get incident error:", err);
    return res.status(500).json({ error: "Failed to fetch incident" });
  }
});

// ---------------------------------------------------------------------------
// POST /api/incidents/:id/resolve — manually resolve an incident
// ---------------------------------------------------------------------------
app.post("/api/incidents/:id/resolve", async (req, res) => {
  try {
    const incident = await incidentManager.resolveIncident(req.params.id);
    if (!incident) return res.status(404).json({ error: "Incident not found" });
    if (notificationService) {
      await notificationService.sendNotification({
        action: "resolved",
        incident,
        site_name: incident.site_name || "Unknown",
        site_url: incident.site_url || "",
      });
    }
    return res.json({ incident });
  } catch (err) {
    console.error("Resolve incident error:", err);
    return res.status(500).json({ error: "Failed to resolve incident" });
  }
});

// ---------------------------------------------------------------------------
// GET /api/status — public status summary
// ---------------------------------------------------------------------------
app.get("/api/status", async (_req, res) => {
  try {
    const sites = await incidentManager.getStatusSummary();
    return res.json({ sites });
  } catch (err) {
    console.error("Status summary error:", err);
    return res.status(500).json({ error: "Failed to fetch status" });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Uptime Pulse API running on port ${PORT}`);
});
