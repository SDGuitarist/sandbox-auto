// Uptime Pulse — Frontend Logic

// ── Configuration ──────────────────────────────────────────────────
// These will be set after deployment — placeholder values for now
const CONFIG = {
  API_URL: 'https://RAILWAY_URL_HERE',  // Will be updated after Railway deploy
  SUPABASE_URL: 'https://qwrqcfajrnjedclfvzrl.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_kgVplccU6NREqyFg89Vi5g_j_GgIRcK',
};

// ── Supabase Client ────────────────────────────────────────────────
const supabaseClient = window.supabase.createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY
);

// ── HTML Escaping ──────────────────────────────────────────────────
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Relative Time ──────────────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return 'never';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return m + ' min ago';
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return h + ' hr ago';
  }
  const d = Math.floor(diffSec / 86400);
  return d + ' day' + (d > 1 ? 's' : '') + ' ago';
}

// ── Error Toast ────────────────────────────────────────────────────
let toastTimer = null;

function showError(message) {
  const toast = document.getElementById('error-toast');
  toast.textContent = message;
  toast.classList.add('visible');

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () {
    toast.classList.remove('visible');
  }, 5000);
}

// ── API Helper ─────────────────────────────────────────────────────
async function api(path, options) {
  const url = CONFIG.API_URL + path;
  const defaults = {
    headers: { 'Content-Type': 'application/json' },
  };
  const opts = Object.assign({}, defaults, options);

  try {
    const res = await fetch(url, opts);
    const data = await res.json();

    if (!res.ok) {
      const msg = (data && data.error) || 'Request failed (' + res.status + ')';
      showError(msg);
      return null;
    }
    return data;
  } catch (err) {
    showError('Network error: ' + err.message);
    return null;
  }
}

// ── Chart Instances ────────────────────────────────────────────────
let responseChart = null;
let uptimeChart = null;

// ── Chart Theme Config ─────────────────────────────────────────────
const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: { color: '#888' },
    },
  },
  scales: {
    x: {
      ticks: { color: '#888' },
      grid: { color: '#333' },
    },
    y: {
      ticks: { color: '#888' },
      grid: { color: '#333' },
    },
  },
};

// ── Render Charts ──────────────────────────────────────────────────
function renderResponseChart(statsArr, checksMap) {
  // Destroy previous instance
  if (responseChart) {
    responseChart.destroy();
    responseChart = null;
  }

  const canvas = document.getElementById('response-chart');
  const container = canvas.parentElement;

  // Remove old overlay if any
  const oldOverlay = container.querySelector('.no-data-overlay');
  if (oldOverlay) oldOverlay.remove();

  if (!statsArr || statsArr.length === 0 || Object.keys(checksMap).length === 0) {
    const overlay = document.createElement('div');
    overlay.className = 'no-data-overlay';
    overlay.textContent = 'No data yet';
    container.appendChild(overlay);
    return;
  }

  // Build datasets: one line per site
  const colors = ['#c9a96e', '#2ecc71', '#e74c3c', '#3498db', '#9b59b6', '#f39c12'];
  const datasets = [];

  statsArr.forEach(function (site, i) {
    const checks = checksMap[site.site_id] || [];
    if (checks.length === 0) return;

    datasets.push({
      label: site.name,
      data: checks.map(function (c) {
        return {
          x: new Date(c.checked_at),
          y: c.response_time_ms,
        };
      }),
      borderColor: colors[i % colors.length],
      backgroundColor: colors[i % colors.length] + '33',
      tension: 0.3,
      pointRadius: 2,
      borderWidth: 2,
      fill: false,
    });
  });

  if (datasets.length === 0) {
    const overlay = document.createElement('div');
    overlay.className = 'no-data-overlay';
    overlay.textContent = 'No data yet';
    container.appendChild(overlay);
    return;
  }

  canvas.style.height = '250px';
  responseChart = new Chart(canvas, {
    type: 'line',
    data: { datasets: datasets },
    options: Object.assign({}, chartDefaults, {
      scales: Object.assign({}, chartDefaults.scales, {
        x: Object.assign({}, chartDefaults.scales.x, {
          type: 'time',
          time: { unit: 'hour' },
          title: { display: true, text: 'Time', color: '#888' },
        }),
        y: Object.assign({}, chartDefaults.scales.y, {
          title: { display: true, text: 'ms', color: '#888' },
          beginAtZero: true,
        }),
      }),
      plugins: {
        legend: { labels: { color: '#888' } },
      },
    }),
  });
}

function renderUptimeChart(statsArr) {
  // Destroy previous instance
  if (uptimeChart) {
    uptimeChart.destroy();
    uptimeChart = null;
  }

  const canvas = document.getElementById('uptime-chart');
  const container = canvas.parentElement;

  // Remove old overlay if any
  const oldOverlay = container.querySelector('.no-data-overlay');
  if (oldOverlay) oldOverlay.remove();

  if (!statsArr || statsArr.length === 0) {
    const overlay = document.createElement('div');
    overlay.className = 'no-data-overlay';
    overlay.textContent = 'No data yet';
    container.appendChild(overlay);
    return;
  }

  const labels = statsArr.map(function (s) { return s.name; });
  const data = statsArr.map(function (s) { return s.uptime_pct; });
  const bgColors = statsArr.map(function (s) {
    if (s.uptime_pct >= 95) return 'rgba(46, 204, 113, 0.7)';
    if (s.uptime_pct >= 80) return 'rgba(243, 156, 18, 0.7)';
    return 'rgba(231, 76, 60, 0.7)';
  });
  const borderColors = statsArr.map(function (s) {
    if (s.uptime_pct >= 95) return '#2ecc71';
    if (s.uptime_pct >= 80) return '#f39c12';
    return '#e74c3c';
  });

  canvas.style.height = '250px';
  uptimeChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Uptime %',
        data: data,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 1,
      }],
    },
    options: Object.assign({}, chartDefaults, {
      scales: Object.assign({}, chartDefaults.scales, {
        y: Object.assign({}, chartDefaults.scales.y, {
          beginAtZero: true,
          max: 100,
          title: { display: true, text: '%', color: '#888' },
        }),
      }),
      plugins: {
        legend: { display: false },
      },
    }),
  });
}

// ── Render Site Cards ──────────────────────────────────────────────
function renderSites(statsArr) {
  const container = document.getElementById('sites-list');

  if (!statsArr || statsArr.length === 0) {
    container.innerHTML = '<div class="empty-state">No sites monitored yet. Add one above!</div>';
    return;
  }

  var html = '';
  statsArr.forEach(function (site) {
    var statusClass = 'status-' + site.status;
    var badgeClass = (site.status === 'up' || site.status === 'down') ? site.status : '';
    var badgeText = site.status.toUpperCase();
    var lastChecked = site.last_check ? timeAgo(site.last_check.checked_at) : 'never';

    html += '<div class="site-card ' + statusClass + '">'
      + '<span class="status-badge ' + badgeClass + '">' + escapeHtml(badgeText) + '</span>'
      + '<div class="site-info">'
      + '<div class="site-name">' + escapeHtml(site.name) + '</div>'
      + '<div class="site-url">' + escapeHtml(site.url) + '</div>'
      + '</div>'
      + '<div class="site-metrics">'
      + '<span><strong>' + site.uptime_pct.toFixed(1) + '%</strong> uptime</span>'
      + '<span><strong>' + Math.round(site.avg_response_ms) + 'ms</strong> avg</span>'
      + '</div>'
      + '<span class="site-last-checked">' + escapeHtml(lastChecked) + '</span>'
      + '<button class="delete-btn" data-site-id="' + escapeHtml(site.site_id) + '">Delete</button>'
      + '</div>';
  });

  container.innerHTML = html;
}

// ── Update Stat Cards ──────────────────────────────────────────────
function updateStatCards(statsArr) {
  var total = statsArr ? statsArr.length : 0;
  var up = 0;
  var uptimeSum = 0;
  var responseSum = 0;

  if (statsArr) {
    statsArr.forEach(function (s) {
      if (s.status === 'up') up++;
      uptimeSum += s.uptime_pct;
      responseSum += s.avg_response_ms;
    });
  }

  document.getElementById('total-sites').textContent = total;
  document.getElementById('sites-up').textContent = up;
  document.getElementById('avg-uptime').textContent =
    total > 0 ? (uptimeSum / total).toFixed(1) + '%' : '0%';
  document.getElementById('avg-response').textContent =
    total > 0 ? Math.round(responseSum / total) + 'ms' : '0ms';
}

// ── Load Stats (main data refresh) ────────────────────────────────
async function loadStats() {
  var data = await api('/api/stats');
  if (!data) return;

  var statsArr = data.stats || [];

  // Update stat cards
  updateStatCards(statsArr);

  // Render site cards
  renderSites(statsArr);

  // Render uptime chart
  renderUptimeChart(statsArr);

  // Fetch checks for response time chart (parallel requests)
  var checksMap = {};
  var checkPromises = statsArr.map(function (site) {
    return api('/api/sites/' + site.site_id + '/checks?limit=50')
      .then(function (res) {
        if (res && res.checks) {
          checksMap[site.site_id] = res.checks;
        }
      });
  });

  await Promise.all(checkPromises);
  renderResponseChart(statsArr, checksMap);
}

// ── Add Site ───────────────────────────────────────────────────────
function handleAddSite(e) {
  e.preventDefault();

  var nameInput = document.getElementById('site-name');
  var urlInput = document.getElementById('site-url');
  var name = nameInput.value.trim();
  var url = urlInput.value.trim();

  if (!name || !url) {
    showError('Please fill in both name and URL.');
    return;
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    showError('URL must start with http:// or https://');
    return;
  }

  api('/api/sites', {
    method: 'POST',
    body: JSON.stringify({ name: name, url: url }),
  }).then(function (data) {
    if (data) {
      nameInput.value = '';
      urlInput.value = '';
      loadStats();
    }
  });
}

// ── Delete Site (event delegation) ─────────────────────────────────
function handleSiteListClick(e) {
  var btn = e.target.closest('.delete-btn[data-site-id]');
  if (!btn) return;

  var siteId = btn.getAttribute('data-site-id');
  if (!confirm('Delete this site and all its check history?')) return;

  api('/api/sites/' + siteId, { method: 'DELETE' }).then(function (data) {
    if (data) {
      loadStats();
    }
  });
}

// ── Realtime Subscription ──────────────────────────────────────────
function subscribeRealtime() {
  supabaseClient
    .channel('checks-realtime')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'checks',
    }, function () {
      // New check came in — refresh dashboard
      loadStats();
    })
    .subscribe();
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  // Load initial data
  loadStats();

  // Form submit handler
  document.getElementById('add-site-form').addEventListener('submit', handleAddSite);

  // Event delegation for delete buttons
  document.getElementById('sites-list').addEventListener('click', handleSiteListClick);

  // Subscribe to realtime updates
  subscribeRealtime();
});
