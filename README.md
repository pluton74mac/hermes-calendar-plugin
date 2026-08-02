# Hermes Calendar Plugin

A full-page calendar for the [Hermes desktop app](https://hermes-agent.nousresearch.com) with year/month/week/day views, event CRUD, to-do checklists, and a Python REST backend.

![Hermes Calendar Plugin](https://img.shields.io/badge/Hermes-Desktop%20Plugin-8A2BE2)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

| View | Description |
|------|-------------|
| **Year** | 12 mini month grids with event dot indicators; click a month to drill in |
| **Month** | Classic calendar grid with inline event previews (3 visible + "+N more") |
| **Week** | 7-column card layout, color-coded by event type |
| **Day** | Hourly timeline + all-day events bar + to-do checklist sidebar |

**Every view** supports:
- ⬅ ➡ navigation arrows and a **Today** quick-jump button
- Segmented control to switch views instantly
- Click any event to edit (title, time, color, description)
- Click empty space → Add Event dialog

**To-Do Checklist** (Day view only):
- Add / check off / delete items
- Editable by both you and Hermes agents via the REST API
- Persisted in SQLite across restarts

**Statusbar Pill:** shows today's events + open todos at a glance; click to jump to `/calendar`.

---

## Requirements

- [Hermes Agent](https://hermes-agent.nousresearch.com) with the **desktop app** (not just the CLI)
- Node.js (bundled with Hermes desktop) — no manual install needed
- Python 3.10+ (for the backend API)

---

## Installation

### Quick install

```bash
git clone https://github.com/pluton74mac/hermes-calendar-plugin.git
cd hermes-calendar-plugin
chmod +x install.sh
./install.sh
```

### Manual install

**1. Desktop plugin** (UI — the calendar page, sidebar nav, statusbar pill):

```bash
cp plugin.js ~/.hermes/desktop-plugins/calendar/plugin.js
```

**2. Python backend** (events/todos REST API):

```bash
mkdir -p ~/.hermes/plugins/calendar/dashboard
cp dashboard/manifest.json ~/.hermes/plugins/calendar/dashboard/manifest.json
cp dashboard/plugin_api.py ~/.hermes/plugins/calendar/dashboard/plugin_api.py
```

**3. Enable the backend** (the UI plugin loads automatically):

```bash
hermes plugins enable calendar
```

Or add to `~/.hermes/config.yaml`:

```yaml
plugins:
  enabled:
    - calendar
```

### Activate

1. **Reload desktop plugins:** `⌘K` → `Reload desktop plugins`
2. **Restart Hermes gateway** (so the Python backend mounts):
   ```
   hermes restart
   ```
3. Open the Calendar from the sidebar or `⌘K` → `Calendar: Open`

---

## Usage

### Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘⌥E` | New event |
| Sidebar icon | Open calendar |
| `⌘K` → `Calendar: Open` | Navigate to calendar |

### Agent API

Hermes agents can read/write events and todos via the REST API at `/api/plugins/calendar/`. The plugin uses this internally via `ctx.rest`.

#### Events

```bash
# List events in a date range
GET /api/plugins/calendar/events?start_date=2026-08-01&end_date=2026-08-31

# Create an event
POST /api/plugins/calendar/events
{
  "title": "Team standup",
  "date": "2026-08-05",
  "start_time": "09:00",
  "end_time": "09:30",
  "all_day": false,
  "color": "#22c55e",
  "description": "Daily sync"
}

# Update an event
PUT /api/plugins/calendar/events/{id}
{ "title": "Updated title" }

# Delete an event
DELETE /api/plugins/calendar/events/{id}
```

#### Todos

```bash
# List todos for a date
GET /api/plugins/calendar/todos?date=2026-08-05

# Create a todo
POST /api/plugins/calendar/todos
{ "title": "Buy groceries", "date": "2026-08-05" }

# Toggle completion
PUT /api/plugins/calendar/todos/{id}
{ "completed": true }

# Delete
DELETE /api/plugins/calendar/todos/{id}
```

#### Today summary

```bash
GET /api/plugins/calendar/today
# Returns { date, events[], todos[] } for today
```

Agents call these via `ctx.rest('/events?start_date=...')` inside their plugin context, or via `fetchJSON('/api/plugins/calendar/events?...')` in browser contexts.

---

## Architecture

```
┌─────────────────────────────────────────┐
│  Hermes Desktop App (Electron)          │
│  ┌──────────────────────────────────┐   │
│  │  plugin.js                       │   │
│  │  ├── ROUTES_AREA  → /calendar    │   │
│  │  ├── SIDEBAR_NAV → sidebar icon  │   │
│  │  ├── STATUSBAR   → today pill    │   │
│  │  ├── PALETTE     → ⌘K commands   │   │
│  │  └── KEYBINDS    → ⌘⌥E           │   │
│  └──────────────────┬───────────────┘   │
│                     │ ctx.rest           │
│                     ▼                    │
│  Hermes Web Server (FastAPI)            │
│  ┌──────────────────────────────────┐   │
│  │  dashboard/plugin_api.py         │   │
│  │  ├── GET/POST /events           │   │
│  │  ├── PUT/DELETE /events/{id}    │   │
│  │  ├── GET/POST /todos            │   │
│  │  ├── PUT/DELETE /todos/{id}    │   │
│  │  └── GET /today                │   │
│  │  Data: ~/.hermes/calendar.db    │   │
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### Files

```
~/.hermes/
├── desktop-plugins/
│   └── calendar/
│       └── plugin.js          # Desktop UI — loaded by Hermes desktop app
└── plugins/
    └── calendar/
        └── dashboard/
            ├── manifest.json  # Plugin manifest (hidden tab, API declaration)
            └── plugin_api.py  # FastAPI router — events + todos CRUD
```

---

## Development

The plugin is a single plain-JS ESM file — no build step, no bundler. Edit `plugin.js` and save; the desktop app hot-reloads it in place.

```bash
# After editing, typing in save triggers hot reload
# If it doesn't appear, run ⌘K → Reload desktop plugins
```

### SDK surface used

| Import | Purpose |
|--------|---------|
| `@hermes/plugin-sdk` | All SDK exports |
| `react/jsx-runtime` | `jsx()` / `jsxs()` (no JSX transpiler) |
| `atom`, `useValue` | Reactive state |
| `useQuery`, `useMutation` | Data fetching + caching |
| `ROUTES_AREA` | Full page route |
| `SIDEBAR_NAV_AREA` | Sidebar nav row |
| `STATUSBAR_AREAS` | Statusbar pill |
| `PALETTE_AREA` | Command palette entries |
| `KEYBINDS_AREA` | Keybindings |
| `ctx.rest` | Backend API calls |
| `ctx.i18n` | Locale bundles |
| `ctx.onDispose` | Cleanup on reload/disable |

---

## License

MIT