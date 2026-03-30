// ============================================================
// Health Journal App - Complete JavaScript Logic
// ============================================================

// --- 1. Data Layer ---

const STORAGE_KEY = 'health-journal-entries';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function getEntries() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

function saveEntries(entries) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function addEntry(entry) {
  const entries = getEntries();
  entries.unshift({ ...entry, id: generateId() });
  saveEntries(entries);
}

function deleteEntry(id) {
  saveEntries(getEntries().filter(e => e.id !== id));
}

// Escape user content before inserting as HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- 2. Navigation ---

function setupNavigation() {
  const navBtns = document.querySelectorAll('.nav-btn[data-view]');
  const views = document.querySelectorAll('.view');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active button
      navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Show matching view, hide others
      const target = btn.getAttribute('data-view');
      views.forEach(v => v.classList.remove('active'));
      const targetView = document.getElementById(target);
      if (targetView) {
        targetView.classList.add('active');
      }

      // Trigger view-specific updates
      if (target === 'dashboard') {
        updateDashboard();
      } else if (target === 'log') {
        renderLog();
      } else if (target === 'add-entry') {
        // Set default date when showing add-entry view
        setDefaultDate();
      }
    });
  });
}

// --- 3. Add Entry Form ---

let currentType = 'symptom';

function setDefaultDate() {
  const dateInput = document.getElementById('entry-date');
  if (dateInput) {
    const now = new Date();
    // Format as YYYY-MM-DDTHH:MM for datetime-local
    const offset = now.getTimezoneOffset();
    const local = new Date(now.getTime() - offset * 60000);
    dateInput.value = local.toISOString().slice(0, 16);
  }
}

function setupEntryForm() {
  // --- Type selector ---
  const typeBtns = document.querySelectorAll('.type-btn[data-type]');
  const fieldSections = ['symptom-fields', 'medication-fields', 'vitals-fields', 'mood-fields', 'note-fields'];

  typeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      typeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.getAttribute('data-type');

      // Show matching fields, hide others
      fieldSections.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          if (id === currentType + '-fields') {
            el.classList.remove('hidden');
          } else {
            el.classList.add('hidden');
          }
        }
      });
    });
  });

  // --- Severity slider ---
  const severitySlider = document.getElementById('symptom-severity');
  const severityValue = document.getElementById('severity-value');
  if (severitySlider && severityValue) {
    severitySlider.addEventListener('input', () => {
      severityValue.textContent = severitySlider.value;
    });
  }

  // --- Mood picker ---
  const moodBtns = document.querySelectorAll('.mood-btn[data-mood]');
  moodBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      moodBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // --- Energy picker ---
  const energyBtns = document.querySelectorAll('.energy-btn[data-energy]');
  energyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      energyBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // --- Form submission ---
  const form = document.getElementById('entry-form');
  if (form) {
    form.addEventListener('submit', handleFormSubmit);
  }
}

function handleFormSubmit(e) {
  e.preventDefault();

  const date = document.getElementById('entry-date').value;
  const tagsRaw = document.getElementById('entry-tags').value.trim();
  const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
  const notes = document.getElementById('entry-notes').value.trim();

  let data = {};

  switch (currentType) {
    case 'symptom':
      data = {
        name: document.getElementById('symptom-name').value.trim(),
        severity: parseInt(document.getElementById('symptom-severity').value, 10)
      };
      if (!data.name) return;
      break;

    case 'medication':
      data = {
        name: document.getElementById('med-name').value.trim(),
        dosage: document.getElementById('med-dosage').value.trim()
      };
      if (!data.name) return;
      break;

    case 'vitals':
      data = {
        systolic: parseFloat(document.getElementById('bp-systolic').value) || null,
        diastolic: parseFloat(document.getElementById('bp-diastolic').value) || null,
        heartRate: parseFloat(document.getElementById('heart-rate').value) || null,
        weight: parseFloat(document.getElementById('weight').value) || null,
        temperature: parseFloat(document.getElementById('temperature').value) || null
      };
      break;

    case 'mood': {
      const activeMood = document.querySelector('.mood-btn.active');
      const activeEnergy = document.querySelector('.energy-btn.active');
      data = {
        mood: activeMood ? parseInt(activeMood.getAttribute('data-mood'), 10) : null,
        energy: activeEnergy ? parseInt(activeEnergy.getAttribute('data-energy'), 10) : null
      };
      if (!data.mood) return;
      break;
    }

    case 'note':
      data = {
        title: document.getElementById('note-title').value.trim(),
        body: document.getElementById('note-body').value.trim()
      };
      if (!data.title) return;
      break;
  }

  const entry = { type: currentType, date, tags, data, notes };
  addEntry(entry);

  // Reset form
  document.getElementById('entry-form').reset();
  setDefaultDate();

  // Reset pickers
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.energy-btn').forEach(b => b.classList.remove('active'));

  // Reset severity display
  const severityValue = document.getElementById('severity-value');
  if (severityValue) severityValue.textContent = '5';

  // Success feedback
  const saveBtn = document.querySelector('.save-btn');
  if (saveBtn) {
    saveBtn.classList.add('success');
    setTimeout(() => saveBtn.classList.remove('success'), 1500);
  }

  // Switch to log view
  const logBtn = document.querySelector('.nav-btn[data-view="log"]');
  if (logBtn) logBtn.click();
}

// --- 4. Entry Log ---

const TYPE_ICONS = {
  symptom: '\u{1F912}',
  medication: '\u{1F48A}',
  vitals: '\u2764\uFE0F',
  mood: '\u{1F60A}',
  note: '\u{1F4DD}'
};

const MOOD_EMOJIS = {
  1: '\u{1F61E}',
  2: '\u{1F615}',
  3: '\u{1F610}',
  4: '\u{1F642}',
  5: '\u{1F601}'
};

function getEntrySummary(entry) {
  const d = entry.data;
  switch (entry.type) {
    case 'symptom':
      return escapeHtml(d.name) + ' - severity ' + d.severity + '/10';
    case 'medication':
      return escapeHtml(d.name) + (d.dosage ? ' (' + escapeHtml(d.dosage) + ')' : '');
    case 'vitals': {
      const parts = [];
      if (d.systolic && d.diastolic) parts.push('BP ' + d.systolic + '/' + d.diastolic);
      if (d.weight) parts.push(d.weight + ' lbs');
      return parts.join(', ') || 'Vitals recorded';
    }
    case 'mood':
      return (MOOD_EMOJIS[d.mood] || '') + ' mood ' + d.mood + '/5, energy ' + (d.energy || '?') + '/5';
    case 'note':
      return escapeHtml(d.title);
    default:
      return 'Entry';
  }
}

function getEntryDetails(entry) {
  const d = entry.data;
  let html = '<div class="detail-content">';

  switch (entry.type) {
    case 'symptom':
      html += '<p><strong>Symptom:</strong> ' + escapeHtml(d.name) + '</p>';
      html += '<p><strong>Severity:</strong> ' + d.severity + '/10</p>';
      break;
    case 'medication':
      html += '<p><strong>Medication:</strong> ' + escapeHtml(d.name) + '</p>';
      if (d.dosage) html += '<p><strong>Dosage:</strong> ' + escapeHtml(d.dosage) + '</p>';
      break;
    case 'vitals':
      if (d.systolic && d.diastolic) html += '<p><strong>Blood Pressure:</strong> ' + d.systolic + '/' + d.diastolic + ' mmHg</p>';
      if (d.heartRate) html += '<p><strong>Heart Rate:</strong> ' + d.heartRate + ' bpm</p>';
      if (d.weight) html += '<p><strong>Weight:</strong> ' + d.weight + ' lbs</p>';
      if (d.temperature) html += '<p><strong>Temperature:</strong> ' + d.temperature + '\u00B0F</p>';
      break;
    case 'mood':
      html += '<p><strong>Mood:</strong> ' + (MOOD_EMOJIS[d.mood] || '') + ' ' + d.mood + '/5</p>';
      html += '<p><strong>Energy:</strong> ' + (d.energy || '?') + '/5</p>';
      break;
    case 'note':
      html += '<p><strong>' + escapeHtml(d.title) + '</strong></p>';
      if (d.body) html += '<p>' + escapeHtml(d.body) + '</p>';
      break;
  }

  // Tags
  if (entry.tags && entry.tags.length > 0) {
    html += '<div class="entry-tags">';
    entry.tags.forEach(tag => {
      html += '<span class="tag-pill">' + escapeHtml(tag) + '</span>';
    });
    html += '</div>';
  }

  // Notes
  if (entry.notes) {
    html += '<p class="entry-note"><em>' + escapeHtml(entry.notes) + '</em></p>';
  }

  html += '<button class="delete-btn" onclick="handleDelete(\'' + entry.id + '\')">Delete</button>';
  html += '</div>';
  return html;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

function applyFilters(entries) {
  const filterType = document.getElementById('filter-type').value;
  const filterFrom = document.getElementById('filter-from').value;
  const filterTo = document.getElementById('filter-to').value;
  const filterSearch = document.getElementById('filter-search').value.toLowerCase().trim();

  return entries.filter(entry => {
    // Type filter
    if (filterType && filterType !== 'all' && entry.type !== filterType) return false;

    // Date range
    if (filterFrom && entry.date < filterFrom) return false;
    if (filterTo && entry.date > filterTo + 'T23:59:59') return false;

    // Search text - match against all text fields
    if (filterSearch) {
      const searchable = [
        entry.type,
        entry.notes || '',
        JSON.stringify(entry.data),
        (entry.tags || []).join(' ')
      ].join(' ').toLowerCase();
      if (!searchable.includes(filterSearch)) return false;
    }

    return true;
  });
}

function renderLog() {
  const list = document.getElementById('entries-list');
  if (!list) return;

  const entries = getEntries();
  const filtered = applyFilters(entries);

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">No entries found.</div>';
    return;
  }

  list.innerHTML = filtered.map(entry => {
    const icon = TYPE_ICONS[entry.type] || '';
    const summary = getEntrySummary(entry);
    const date = formatDate(entry.date);
    const details = getEntryDetails(entry);

    return '<div class="log-entry type-' + escapeHtml(entry.type) + '" data-id="' + escapeHtml(entry.id) + '">' +
      '<div class="entry-header" onclick="toggleEntry(\'' + entry.id + '\')">' +
        '<span class="entry-icon">' + icon + '</span>' +
        '<span class="entry-summary">' + summary + '</span>' +
        '<span class="entry-date">' + escapeHtml(date) + '</span>' +
      '</div>' +
      '<div class="entry-details">' + details + '</div>' +
    '</div>';
  }).join('');
}

function toggleEntry(id) {
  const el = document.querySelector('.log-entry[data-id="' + id + '"]');
  if (el) el.classList.toggle('expanded');
}

function handleDelete(id) {
  if (!confirm('Delete this entry?')) return;
  deleteEntry(id);
  renderLog();
}

function setupLogFilters() {
  const ids = ['filter-type', 'filter-from', 'filter-to', 'filter-search'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', renderLog);
      el.addEventListener('change', renderLog);
    }
  });
}

// --- 5. Dashboard ---

// Store chart instances so we can destroy them before re-creating
let moodChartInstance = null;
let weightChartInstance = null;
let bpChartInstance = null;

function updateDashboard() {
  const entries = getEntries();
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Total entries
  const totalEl = document.getElementById('total-entries');
  if (totalEl) totalEl.textContent = entries.length;

  // This week count
  const weekEntries = entries.filter(e => new Date(e.date) >= weekAgo);
  const weekEl = document.getElementById('week-entries');
  if (weekEl) weekEl.textContent = weekEntries.length;

  // Top symptom
  const symptomCounts = {};
  entries.filter(e => e.type === 'symptom').forEach(e => {
    const name = e.data.name;
    symptomCounts[name] = (symptomCounts[name] || 0) + 1;
  });
  const topSymptom = Object.entries(symptomCounts).sort((a, b) => b[1] - a[1])[0];
  const topSymptomEl = document.getElementById('top-symptom');
  if (topSymptomEl) topSymptomEl.textContent = topSymptom ? topSymptom[0] : 'None';

  // Average mood
  const moodEntries = entries.filter(e => e.type === 'mood' && e.data.mood);
  const avgMood = moodEntries.length > 0
    ? (moodEntries.reduce((sum, e) => sum + e.data.mood, 0) / moodEntries.length).toFixed(1)
    : '-';
  const avgMoodEl = document.getElementById('avg-mood');
  if (avgMoodEl) avgMoodEl.textContent = avgMood;

  // Charts
  updateCharts(entries);
}

function updateCharts(entries) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const chartColors = {
    grid: '#333',
    text: '#888',
    primary: '#c9a96e',
    secondary: '#e8d5b7'
  };

  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: chartColors.text } }
    },
    scales: {
      x: {
        grid: { color: chartColors.grid },
        ticks: { color: chartColors.text }
      },
      y: {
        grid: { color: chartColors.grid },
        ticks: { color: chartColors.text }
      }
    }
  };

  // --- Mood Chart ---
  const moodData = entries
    .filter(e => e.type === 'mood' && e.data.mood && new Date(e.date) >= thirtyDaysAgo)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (moodChartInstance) { moodChartInstance.destroy(); moodChartInstance = null; }
  const moodCanvas = document.getElementById('mood-chart');
  if (moodCanvas) {
    if (moodData.length === 0) {
      showNoData(moodCanvas, 'No data yet');
    } else {
      clearNoData(moodCanvas);
      const ctx = moodCanvas.getContext('2d');
      moodChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: moodData.map(e => new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
          datasets: [{
            label: 'Mood',
            data: moodData.map(e => e.data.mood),
            borderColor: chartColors.primary,
            backgroundColor: chartColors.primary + '33',
            tension: 0.3,
            fill: false
          }]
        },
        options: {
          ...baseOptions,
          scales: {
            ...baseOptions.scales,
            y: { ...baseOptions.scales.y, min: 1, max: 5 }
          }
        }
      });
    }
  }

  // --- Weight Chart ---
  const weightData = entries
    .filter(e => e.type === 'vitals' && e.data.weight && new Date(e.date) >= thirtyDaysAgo)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (weightChartInstance) { weightChartInstance.destroy(); weightChartInstance = null; }
  const weightCanvas = document.getElementById('weight-chart');
  if (weightCanvas) {
    if (weightData.length === 0) {
      showNoData(weightCanvas, 'No data yet');
    } else {
      clearNoData(weightCanvas);
      const ctx = weightCanvas.getContext('2d');
      weightChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: weightData.map(e => new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
          datasets: [{
            label: 'Weight',
            data: weightData.map(e => e.data.weight),
            borderColor: chartColors.primary,
            backgroundColor: chartColors.primary + '33',
            tension: 0.3,
            fill: false
          }]
        },
        options: baseOptions
      });
    }
  }

  // --- BP Chart ---
  const bpData = entries
    .filter(e => e.type === 'vitals' && e.data.systolic && e.data.diastolic && new Date(e.date) >= thirtyDaysAgo)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (bpChartInstance) { bpChartInstance.destroy(); bpChartInstance = null; }
  const bpCanvas = document.getElementById('bp-chart');
  if (bpCanvas) {
    if (bpData.length === 0) {
      showNoData(bpCanvas, 'No data yet');
    } else {
      clearNoData(bpCanvas);
      const ctx = bpCanvas.getContext('2d');
      bpChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
          labels: bpData.map(e => new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
          datasets: [
            {
              label: 'Systolic',
              data: bpData.map(e => e.data.systolic),
              borderColor: chartColors.primary,
              backgroundColor: chartColors.primary + '33',
              tension: 0.3,
              fill: false
            },
            {
              label: 'Diastolic',
              data: bpData.map(e => e.data.diastolic),
              borderColor: chartColors.secondary,
              backgroundColor: chartColors.secondary + '33',
              tension: 0.3,
              fill: false
            }
          ]
        },
        options: baseOptions
      });
    }
  }
}

function showNoData(canvas, message) {
  // Place a "no data" message over the canvas
  const parent = canvas.parentElement;
  let overlay = parent.querySelector('.no-data-message');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'no-data-message';
    overlay.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#888;font-size:1rem;';
    parent.style.position = 'relative';
    parent.appendChild(overlay);
  }
  overlay.textContent = message;
  canvas.style.display = 'none';
}

function clearNoData(canvas) {
  canvas.style.display = '';
  const parent = canvas.parentElement;
  const overlay = parent.querySelector('.no-data-message');
  if (overlay) overlay.remove();
}

// --- 6. CSV Export ---

function setupExport() {
  const exportBtn = document.getElementById('export-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', exportCSV);
  }
}

function exportCSV() {
  const entries = getEntries();
  const filtered = applyFilters(entries);

  const rows = [['Date', 'Type', 'Summary', 'Tags', 'Notes']];

  filtered.forEach(entry => {
    // Build a plain-text summary (no HTML)
    const summary = getPlainSummary(entry);
    rows.push([
      entry.date,
      entry.type,
      summary,
      (entry.tags || []).join('; '),
      entry.notes || ''
    ]);
  });

  const csvContent = rows.map(row =>
    row.map(cell => '"' + String(cell).replace(/"/g, '""') + '"').join(',')
  ).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const today = new Date().toISOString().slice(0, 10);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'health-journal-' + today + '.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function getPlainSummary(entry) {
  const d = entry.data;
  switch (entry.type) {
    case 'symptom':
      return d.name + ' - severity ' + d.severity + '/10';
    case 'medication':
      return d.name + (d.dosage ? ' (' + d.dosage + ')' : '');
    case 'vitals': {
      const parts = [];
      if (d.systolic && d.diastolic) parts.push('BP ' + d.systolic + '/' + d.diastolic);
      if (d.weight) parts.push(d.weight + ' lbs');
      return parts.join(', ') || 'Vitals recorded';
    }
    case 'mood':
      return 'Mood ' + d.mood + '/5, Energy ' + (d.energy || '?') + '/5';
    case 'note':
      return d.title;
    default:
      return 'Entry';
  }
}

// --- Make onclick-referenced functions global ---
window.toggleEntry = toggleEntry;
window.handleDelete = handleDelete;

// --- Initialize on DOM ready ---

document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupEntryForm();
  setupLogFilters();
  setupExport();

  // Set default date and show dashboard
  setDefaultDate();
  updateDashboard();
});
