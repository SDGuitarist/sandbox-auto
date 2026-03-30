---
title: Health Journal App
origin: conversation
feed_forward:
  risk: "Chart library complexity — may bloat a single-file static app"
  verify_first: true
---

# Health Journal App

## What is changing?
Building a multi-view health journal as a static site (HTML/CSS/JS) deployed to GitHub Pages. Uses localStorage for persistence. No backend.

## What must NOT change?
- Existing TIL app (`index.html`) stays untouched
- GitHub Pages workflow (`.github/workflows/pages.yml`) already works
- No secrets, no real medical data — this is a sandbox

## How will we know it worked?
- App loads at `sdguitarist.github.io/sandbox-auto/health/`
- Can add entries of each type (symptom, medication, vitals, mood, note)
- Dashboard shows charts of vitals/mood over time
- Can filter entries by type and date range
- Can export entries to CSV
- Works on mobile

## Most likely way this plan is wrong?
- Chart.js CDN adds complexity — if it causes issues, fall back to simple CSS bar charts
- localStorage has a ~5MB limit — fine for a journal but worth noting

---

## Architecture

Single directory (`/health/`) with:
```
health/
  index.html      — app shell, navigation, all views
  app.js          — all logic (entries CRUD, charts, filtering, export)
  styles.css      — all styles
```

Three files keeps it simple. No build step, no bundler.

## Views

### 1. Dashboard (default view)
- Summary cards: total entries, entries this week, most tracked symptom
- Mood trend chart (last 30 days, line chart)
- Weight trend chart (last 30 days, line chart)
- Blood pressure trend (last 30 days, line chart)
- Quick-add button

### 2. Add Entry (form view)
- Entry type selector: symptom, medication, vitals, mood, note
- Dynamic form fields based on type:
  - **Symptom:** name, severity (1-10 slider), notes
  - **Medication:** name, dosage, time taken, notes
  - **Vitals:** blood pressure (sys/dia), heart rate, weight, temperature
  - **Mood:** rating (1-5 emoji scale), energy (1-5), notes
  - **Note:** title, body text
- Date/time picker (defaults to now)
- Tags input (comma-separated)
- Save button

### 3. Entry Log (list view)
- Chronological list of all entries
- Filter bar: type dropdown, date range picker, search text
- Each entry shows: icon by type, summary, date, tags
- Click to expand full details
- Delete button per entry

### 4. Export
- Button in the log view header
- Generates CSV with columns: date, type, details, tags, notes
- Downloads as `health-journal-YYYY-MM-DD.csv`

## Data Model (localStorage)

```json
{
  "entries": [
    {
      "id": "uuid",
      "type": "symptom|medication|vitals|mood|note",
      "date": "ISO8601",
      "tags": ["tag1", "tag2"],
      "data": { /* type-specific fields */ },
      "notes": "free text"
    }
  ]
}
```

## Design
- Dark theme matching TIL app (background: #1a1a2e, accent: #c9a96e)
- Responsive — works on mobile
- Chart.js via CDN for trend charts
- Entry type icons via emoji (no icon library needed)

## Implementation Order
1. `styles.css` — full stylesheet
2. `index.html` — app shell with all view containers
3. `app.js` — in this order:
   a. Data layer (localStorage CRUD)
   b. Navigation (view switching)
   c. Add Entry form (dynamic fields)
   d. Entry Log (list, filter, search, delete)
   e. Dashboard (summary cards + charts)
   f. Export (CSV generation)

## Feed-Forward
- **Hardest decision:** Keeping it to 3 files. A framework would be easier to organize but defeats the sandbox purpose.
- **Rejected alternatives:** React/Vue (overkill for static site), separate pages per view (harder to share state), IndexedDB (more complex than localStorage for this scope).
- **Least confident:** Chart.js integration — rendering 3 chart types in a vanilla JS app with dynamic data updates. If charts are buggy, CSS-only fallback is the escape hatch.
