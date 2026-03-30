// Uptime Pulse — Public Status Page Logic

// ── Configuration ──────────────────────────────────────────────────
var CONFIG = {
  API_URL: 'https://sandbox-auto-production.up.railway.app',
  SUPABASE_URL: 'https://qwrqcfajrnjedclfvzrl.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_kgVplccU6NREqyFg89Vi5g_j_GgIRcK',
};

// ── Supabase Client ────────────────────────────────────────────────
var supabaseClient = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

// ── HTML Escaping ──────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Relative Time ──────────────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return 'unknown';
  var now = Date.now();
  var then = new Date(dateStr).getTime();
  var diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) {
    var m = Math.floor(diffSec / 60);
    return m + ' min ago';
  }
  if (diffSec < 86400) {
    var h = Math.floor(diffSec / 3600);
    return h + ' hr ago';
  }
  var d = Math.floor(diffSec / 86400);
  return d + ' day' + (d > 1 ? 's' : '') + ' ago';
}

// ── Render Overall Status Banner ───────────────────────────────────
function renderOverallStatus(sites) {
  var el = document.getElementById('overall-status');
  if (!el) return;

  var hasDown = false;
  var hasDegraded = false;

  for (var i = 0; i < sites.length; i++) {
    if (sites[i].current_status === 'down') hasDown = true;
    if (sites[i].current_status === 'degraded') hasDegraded = true;
  }

  // Remove all status classes
  el.className = 'status-header';

  if (hasDown) {
    el.classList.add('status-down');
    el.textContent = 'Major System Outage';
  } else if (hasDegraded) {
    el.classList.add('status-degraded');
    el.textContent = 'Some Systems Experiencing Issues';
  } else {
    el.classList.add('status-operational');
    el.textContent = 'All Systems Operational';
  }
}

// ── Render Site Rows ───────────────────────────────────────────────
function renderSiteRows(sites) {
  var container = document.getElementById('sites-status-list');
  if (!container) return;

  if (!sites || sites.length === 0) {
    container.innerHTML = '<p class="empty-state">No monitored sites.</p>';
    return;
  }

  var html = '';
  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    var statusClass = site.current_status || 'operational';
    var statusText = statusClass === 'down' ? 'Down' :
                     statusClass === 'degraded' ? 'Degraded' : 'Operational';

    html += '<div class="site-status-row ' + escapeHtml(statusClass) + '">'
          +   '<span class="status-dot"></span>'
          +   '<span class="site-name">' + escapeHtml(site.site_name) + '</span>'
          +   '<span class="site-status-text">' + statusText + '</span>'
          + '</div>';
  }

  container.innerHTML = html;
}

// ── Render Incidents ───────────────────────────────────────────────
function renderIncidents(sites) {
  var activeContainer = document.getElementById('incidents-list');
  var historyContainer = document.getElementById('incident-history');
  if (!activeContainer || !historyContainer) return;

  var activeHtml = '';
  var historyHtml = '';
  var hasActive = false;
  var hasHistory = false;

  for (var i = 0; i < sites.length; i++) {
    var site = sites[i];
    var incident = site.active_incident;

    // Active incident
    if (incident && incident.status !== 'resolved') {
      hasActive = true;
      activeHtml += buildIncidentCard(incident, site.site_name, site.recent_updates);
    }

    // Resolved incidents from recent_updates
    if (incident && incident.status === 'resolved') {
      hasHistory = true;
      historyHtml += buildIncidentCard(incident, site.site_name, site.recent_updates);
    }
  }

  activeContainer.innerHTML = hasActive ? activeHtml
    : '<p class="empty-state">No active incidents. All clear!</p>';

  historyContainer.innerHTML = hasHistory ? historyHtml
    : '<p class="empty-state">No recent incidents.</p>';
}

function buildIncidentCard(incident, siteName, updates) {
  var severity = escapeHtml(incident.severity || 'minor');
  var status = escapeHtml(incident.status || 'detected');
  var started = timeAgo(incident.started_at);

  var html = '<div class="incident-card ' + severity + '">'
           +   '<div class="incident-card-header">'
           +     '<span class="incident-card-title">' + escapeHtml(siteName) + ' — ' + status + '</span>'
           +     '<span class="incident-card-severity">' + severity + '</span>'
           +   '</div>'
           +   '<div class="incident-card-meta">Started ' + escapeHtml(started) + '</div>';

  // Timeline entries from recent_updates
  if (updates && updates.length > 0) {
    html += '<div class="incident-timeline">';
    for (var j = 0; j < updates.length; j++) {
      var update = updates[j];
      html += '<div class="timeline-entry">'
            +   '<span class="timeline-dot"></span>'
            +   escapeHtml(update.message)
            +   '<span class="timeline-time">' + escapeHtml(timeAgo(update.created_at)) + '</span>'
            + '</div>';
    }
    html += '</div>';
  }

  html += '</div>';
  return html;
}

// ── Load Status from API ───────────────────────────────────────────
function loadStatus() {
  var url = CONFIG.API_URL + '/api/status';

  fetch(url)
    .then(function(res) {
      if (!res.ok) throw new Error('Status API returned ' + res.status);
      return res.json();
    })
    .then(function(data) {
      var sites = data.sites || [];
      renderOverallStatus(sites);
      renderSiteRows(sites);
      renderIncidents(sites);
    })
    .catch(function(err) {
      console.error('Failed to load status:', err);
      var el = document.getElementById('overall-status');
      if (el) {
        el.className = 'status-header status-degraded';
        el.textContent = 'Unable to load status — please try again later';
      }
    });
}

// ── Supabase Realtime ──────────────────────────────────────────────
var reloadTimer = null;

function debouncedReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(function() {
    loadStatus();
  }, 2000);
}

function subscribeRealtime() {
  supabaseClient
    .channel('status-page')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'incidents' }, function() {
      debouncedReload();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'status_updates' }, function() {
      debouncedReload();
    })
    .subscribe();
}

// ── Init ───────────────────────────────────────────────────────────
loadStatus();
subscribeRealtime();
