// ---------------------------------------------------------------------------
// Incident Manager — processes check results into incidents
// Receives a Supabase client via dependency injection.
// ---------------------------------------------------------------------------

/**
 * Calculate severity based on consecutive failure count.
 * 1-2 failures -> minor, 3-5 -> major, 6+ -> critical
 */
function calculateSeverity(failures) {
  if (failures >= 6) return "critical";
  if (failures >= 3) return "major";
  return "minor";
}

module.exports = function createIncidentManager(supabase) {
  // -----------------------------------------------------------------------
  // processResults(results) — called by cron after check results are stored
  // -----------------------------------------------------------------------
  async function processResults(results) {
    const events = [];

    for (const result of results) {
      try {
        if (!result.is_up) {
          // --- Site is DOWN ---
          const event = await handleDown(result);
          if (event) events.push(event);
        } else {
          // --- Site is UP ---
          const event = await handleUp(result);
          if (event) events.push(event);
        }
      } catch (err) {
        console.error(
          `Error processing result for site ${result.site_id}:`,
          err
        );
      }
    }

    return events;
  }

  // -----------------------------------------------------------------------
  // handleDown — create or update an incident for a site that is down
  // -----------------------------------------------------------------------
  async function handleDown(result) {
    // Check for an existing open incident for this site
    const { data: existing, error: fetchErr } = await supabase
      .from("incidents")
      .select("*, sites(name, url)")
      .eq("site_id", result.site_id)
      .neq("status", "resolved")
      .maybeSingle();

    if (fetchErr) {
      console.error("Error fetching existing incident:", fetchErr);
      return null;
    }

    if (existing) {
      // --- Update existing incident ---
      const newFailures = existing.consecutive_failures + 1;
      const newSeverity = calculateSeverity(newFailures);

      const updates = {
        consecutive_failures: newFailures,
        severity: newSeverity,
        updated_at: new Date().toISOString(),
      };

      let action = "updated";

      // Confirm the incident if it hits 3 consecutive failures and is still 'detected'
      if (newFailures >= 3 && existing.status === "detected") {
        updates.status = "confirmed";
        updates.confirmed_at = new Date().toISOString();
        action = "confirmed";
      }

      const { data: updated, error: updateErr } = await supabase
        .from("incidents")
        .update(updates)
        .eq("id", existing.id)
        .select("*, sites(name, url)")
        .single();

      if (updateErr) {
        console.error("Error updating incident:", updateErr);
        return null;
      }

      const siteName = updated.sites?.name || "";
      const siteUrl = updated.sites?.url || "";

      // Create a status_update when the incident is confirmed
      if (action === "confirmed") {
        await createStatusUpdate(
          updated.id,
          "confirmed",
          `Incident confirmed for ${siteName} after ${newFailures} consecutive failures (severity: ${newSeverity})`
        );
      }

      return {
        action,
        incident: stripSiteJoin(updated),
        site_name: siteName,
        site_url: siteUrl,
      };
    } else {
      // --- Create new incident ---
      return await createNewIncident(result);
    }
  }

  // -----------------------------------------------------------------------
  // createNewIncident — INSERT with dedup protection (unique partial index)
  // -----------------------------------------------------------------------
  async function createNewIncident(result) {
    const now = new Date().toISOString();

    const { data: created, error: insertErr } = await supabase
      .from("incidents")
      .insert({
        site_id: result.site_id,
        status: "detected",
        severity: "minor",
        started_at: now,
        consecutive_failures: 1,
      })
      .select("*, sites(name, url)")
      .single();

    if (insertErr) {
      // Dedup: unique constraint violation means another cron run already created one
      if (
        insertErr.code === "23505" ||
        (insertErr.message && insertErr.message.includes("duplicate"))
      ) {
        console.warn(
          `Dedup: incident already exists for site ${result.site_id}, fetching existing`
        );

        // Fetch the existing incident and update it instead
        const { data: existing, error: fetchErr } = await supabase
          .from("incidents")
          .select("*, sites(name, url)")
          .eq("site_id", result.site_id)
          .neq("status", "resolved")
          .maybeSingle();

        if (fetchErr || !existing) {
          console.error("Error fetching after dedup conflict:", fetchErr);
          return null;
        }

        // Increment failures on the existing record
        const newFailures = existing.consecutive_failures + 1;
        const { data: updated, error: updateErr } = await supabase
          .from("incidents")
          .update({
            consecutive_failures: newFailures,
            severity: calculateSeverity(newFailures),
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select("*, sites(name, url)")
          .single();

        if (updateErr) {
          console.error("Error updating after dedup conflict:", updateErr);
          return null;
        }

        return {
          action: "updated",
          incident: stripSiteJoin(updated),
          site_name: updated.sites?.name || "",
          site_url: updated.sites?.url || "",
        };
      }

      console.error("Error creating incident:", insertErr);
      return null;
    }

    const siteName = created.sites?.name || "";
    const siteUrl = created.sites?.url || "";

    // Create a status_update for the new detection
    await createStatusUpdate(
      created.id,
      "detected",
      `Incident detected for ${siteName} — site appears to be down`
    );

    return {
      action: "created",
      incident: stripSiteJoin(created),
      site_name: siteName,
      site_url: siteUrl,
    };
  }

  // -----------------------------------------------------------------------
  // handleUp — resolve any open incident for a site that is back up
  // -----------------------------------------------------------------------
  async function handleUp(result) {
    const { data: existing, error: fetchErr } = await supabase
      .from("incidents")
      .select("*, sites(name, url)")
      .eq("site_id", result.site_id)
      .neq("status", "resolved")
      .maybeSingle();

    if (fetchErr) {
      console.error("Error fetching incident for resolution:", fetchErr);
      return null;
    }

    if (!existing) return null;

    const resolvedAt = new Date().toISOString();
    const startedAt = new Date(existing.started_at).getTime();
    const durationMs = new Date(resolvedAt).getTime() - startedAt;

    const { data: resolved, error: updateErr } = await supabase
      .from("incidents")
      .update({
        status: "resolved",
        resolved_at: resolvedAt,
        duration_ms: durationMs,
        updated_at: resolvedAt,
      })
      .eq("id", existing.id)
      .select("*, sites(name, url)")
      .single();

    if (updateErr) {
      console.error("Error resolving incident:", updateErr);
      return null;
    }

    const siteName = resolved.sites?.name || "";
    const siteUrl = resolved.sites?.url || "";

    await createStatusUpdate(
      resolved.id,
      "resolved",
      `Incident resolved for ${siteName} — site is back up (duration: ${Math.round(durationMs / 1000)}s)`
    );

    return {
      action: "resolved",
      incident: stripSiteJoin(resolved),
      site_name: siteName,
      site_url: siteUrl,
    };
  }

  // -----------------------------------------------------------------------
  // getIncidents(statusFilter) — query incidents, optionally filter by status
  // -----------------------------------------------------------------------
  async function getIncidents(statusFilter) {
    try {
      let query = supabase
        .from("incidents")
        .select("*, sites(name, url)")
        .order("created_at", { ascending: false });

      if (statusFilter) {
        const statuses = statusFilter.split(",").map((s) => s.trim());
        query = query.in("status", statuses);
      }

      const { data, error } = await query;

      if (error) {
        console.error("Error fetching incidents:", error);
        return [];
      }

      // Flatten the site join into site_name and site_url
      return data.map((row) => ({
        ...stripSiteJoin(row),
        site_name: row.sites?.name || "",
        site_url: row.sites?.url || "",
      }));
    } catch (err) {
      console.error("Error in getIncidents:", err);
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // getIncidentById(id) — single incident with status_updates and notifications
  // -----------------------------------------------------------------------
  async function getIncidentById(id) {
    try {
      // Fetch the incident with site info
      const { data: incident, error: incErr } = await supabase
        .from("incidents")
        .select("*, sites(name, url)")
        .eq("id", id)
        .maybeSingle();

      if (incErr) {
        console.error("Error fetching incident by id:", incErr);
        return null;
      }
      if (!incident) return null;

      // Fetch status_updates for this incident
      const { data: updates, error: updErr } = await supabase
        .from("status_updates")
        .select("*")
        .eq("incident_id", id)
        .order("created_at", { ascending: true });

      if (updErr) {
        console.error("Error fetching status_updates:", updErr);
      }

      // Fetch notifications for this incident
      const { data: notifications, error: notifErr } = await supabase
        .from("notifications")
        .select("*")
        .eq("incident_id", id)
        .order("created_at", { ascending: true });

      if (notifErr) {
        console.error("Error fetching notifications:", notifErr);
      }

      return {
        incident: {
          ...stripSiteJoin(incident),
          site_name: incident.sites?.name || "",
          site_url: incident.sites?.url || "",
        },
        updates: updates || [],
        notifications: notifications || [],
      };
    } catch (err) {
      console.error("Error in getIncidentById:", err);
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // resolveIncident(id) — manually resolve an incident (admin action)
  // -----------------------------------------------------------------------
  async function resolveIncident(id) {
    try {
      // First fetch to get started_at for duration calculation
      const { data: existing, error: fetchErr } = await supabase
        .from("incidents")
        .select("*, sites(name, url)")
        .eq("id", id)
        .maybeSingle();

      if (fetchErr) {
        console.error("Error fetching incident for manual resolve:", fetchErr);
        return null;
      }
      if (!existing) return null;
      if (existing.status === "resolved") {
        // Already resolved — just return it
        return {
          ...stripSiteJoin(existing),
          site_name: existing.sites?.name || "",
          site_url: existing.sites?.url || "",
        };
      }

      const resolvedAt = new Date().toISOString();
      const startedAt = new Date(existing.started_at).getTime();
      const durationMs = new Date(resolvedAt).getTime() - startedAt;

      const { data: resolved, error: updateErr } = await supabase
        .from("incidents")
        .update({
          status: "resolved",
          resolved_at: resolvedAt,
          duration_ms: durationMs,
          updated_at: resolvedAt,
        })
        .eq("id", id)
        .select("*, sites(name, url)")
        .single();

      if (updateErr) {
        console.error("Error manually resolving incident:", updateErr);
        return null;
      }

      const siteName = resolved.sites?.name || "";

      await createStatusUpdate(
        resolved.id,
        "resolved",
        `Incident manually resolved for ${siteName} (duration: ${Math.round(durationMs / 1000)}s)`
      );

      return {
        ...stripSiteJoin(resolved),
        site_name: siteName,
        site_url: resolved.sites?.url || "",
      };
    } catch (err) {
      console.error("Error in resolveIncident:", err);
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // getStatusSummary() — per-site status for the public status page
  // -----------------------------------------------------------------------
  async function getStatusSummary() {
    try {
      // Fetch all active sites
      const { data: sites, error: sitesErr } = await supabase
        .from("sites")
        .select("*")
        .eq("is_active", true);

      if (sitesErr) {
        console.error("Error fetching sites for status summary:", sitesErr);
        return [];
      }

      const twentyFourHoursAgo = new Date(
        Date.now() - 24 * 60 * 60 * 1000
      ).toISOString();

      const summaries = await Promise.all(
        sites.map(async (site) => {
          // Check for an open incident
          const { data: openIncident } = await supabase
            .from("incidents")
            .select("*")
            .eq("site_id", site.id)
            .neq("status", "resolved")
            .maybeSingle();

          // Determine current_status based on active incident severity
          let currentStatus = "operational";
          if (openIncident) {
            if (
              openIncident.severity === "major" ||
              openIncident.severity === "critical"
            ) {
              currentStatus = "down";
            } else {
              currentStatus = "degraded";
            }
          }

          // Recent status_updates (last 10) for this site's incidents
          const { data: recentUpdates } = await supabase
            .from("status_updates")
            .select("*, incidents!inner(site_id)")
            .eq("incidents.site_id", site.id)
            .order("created_at", { ascending: false })
            .limit(10);

          // Clean up the join from status_updates
          const cleanUpdates = (recentUpdates || []).map((u) => {
            const { incidents, ...rest } = u;
            return rest;
          });

          // Uptime % in last 24h (same calculation as existing /api/stats)
          const { data: recentChecks } = await supabase
            .from("checks")
            .select("is_up")
            .eq("site_id", site.id)
            .gte("checked_at", twentyFourHoursAgo);

          const total = recentChecks ? recentChecks.length : 0;
          const upCount = recentChecks
            ? recentChecks.filter((c) => c.is_up).length
            : 0;
          const uptimePct =
            total > 0 ? Math.round((upCount / total) * 10000) / 100 : 100;

          return {
            site_id: site.id,
            site_name: site.name,
            site_url: site.url,
            current_status: currentStatus,
            active_incident: openIncident || null,
            recent_updates: cleanUpdates,
            uptime_pct_24h: uptimePct,
          };
        })
      );

      return summaries;
    } catch (err) {
      console.error("Error in getStatusSummary:", err);
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Helper: insert a status_update row
  // -----------------------------------------------------------------------
  async function createStatusUpdate(incidentId, type, message) {
    try {
      const { error } = await supabase.from("status_updates").insert({
        incident_id: incidentId,
        type,
        message,
      });

      if (error) {
        console.error("Error creating status_update:", error);
      }
    } catch (err) {
      console.error("Error in createStatusUpdate:", err);
    }
  }

  // -----------------------------------------------------------------------
  // Helper: remove the nested 'sites' join object from an incident row
  // so the returned object matches the Incident interface
  // -----------------------------------------------------------------------
  function stripSiteJoin(row) {
    const { sites, ...incident } = row;
    return incident;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------
  return {
    processResults,
    getIncidents,
    getIncidentById,
    resolveIncident,
    getStatusSummary,
  };
};
