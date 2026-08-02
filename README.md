# Hermes Calendar Plugin

A full-page calendar for the [Hermes desktop app](https://hermes-agent.nousresearch.com) with year/month/week/day views, event CRUD, to-do checklists, and a Python REST backend.

![Hermes Calendar Plugin](https://img.shields.io/badge/Hermes-Desktop%20Plugin-8A2BE2)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

| View | Description |
|------|-------------|
| **Year** | 12 mini month grids, 4 across; today and event days highlighted; click a month to drill in |
| **Month** | Classic calendar grid with inline event previews (3 visible + "+N more") |
| **Week** | 7-column card layout, color-coded by event type |
| **Day** | Hourly timeline + all-day events bar + to-do checklist sidebar |

Weeks run **Monday → Sunday** in every view.

**Every view** supports:
- ⬅ ➡ navigation arrows and a **Today** quick-jump button
- Segmented control to switch views instantly
- Click any event to open its card; edit from there
- Click a day to drill into it

**To-Do Checklist** (Day view only):
- Add / check off / delete items
- Editable by both you and Hermes agents via the REST API
- Persisted in SQLite across restarts

**Statusbar Pill:** shows today's events + open todos at a glance; click to open the calendar.

### Opening the calendar

| Surface | How |
|---------|-----|
| **Full-window overlay** | `⌘⌥C`, the statusbar pill, or ⌘K → *Calendar: Open*. Covers the session screen; **Esc** or ✕ closes it. |
| **Separate OS window** | The ⧉ button in the calendar header, or ⌘K → *Calendar: Open in New Window*. |
| **Pane tile** | The **Calendar** row in the sidebar routes to `/calendar` as a normal pane. |
| **New event** | `⌘⌥E`, or ⌘K → *Calendar: New Event*. |

> **On the separate window:** a plugin cannot open a calendar-*only* OS window —
> Electron denies `window.open` (it hands the URL to the external browser), and the
> route-targeted window kinds live in the main process. The ⧉ button uses the app's
> own "new window" bridge and hands the new window a short-lived note through plugin
> storage, so it raises the calendar as it boots. It is a full Hermes window that
> opens showing the calendar.

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
| `⌘⌥C` | Open the calendar |
| **Today** button | Jump straight to today's day view |
| `⌘⌥E` | New event |
| Sidebar icon | Open calendar as a pane |
| `⌘K` → `Calendar: Open` | Open the calendar |
| `⌘K` → `Calendar: Open in New Window` | Pop out to a separate window |
| `Esc` | Close the top layer (edit → card → settings → calendar) |

### Picking a time

Start and end each use an **hour** dropdown, a **minutes** dropdown in 5-minute
steps, and an **AM/PM** toggle. Choosing `—` for the hour clears the time (an
event may have no time without being all-day). A minute an agent wrote that
isn't on the 5-minute grid stays selectable, so editing never silently moves
it. An end at or before the start is flagged and blocks the save.

### Event card

Clicking an event opens a read-only card. Title, **when** (start – end) and
**description** lead; provenance sits quietly below a rule — who created it
(you, or the agent by name) with the date and time, and who last edited it and
when. The ⚙ button opens the edit form.

### Day view hours

The day view fits its whole hour window on screen — no scrolling. The ⚙ chip
above the timeline sets the window (default **6 AM – 10 PM**) and the choice is
remembered. A day with an event outside the window widens **just for that day**
to include it, and marks the borrowed hours.

Events are drawn over the hour grid at their real position and size, so a
two-hour meeting covers two hours. Overlapping events split the width into as
many columns as they need — two, three, or more — and a column is reused once
its previous event has ended. An event with no end time occupies one hour.

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
  "description": "Daily sync",

  // Provenance — shown on the event card. Agents should identify
  // themselves; omitting these records the event as user-created.
  "creator": "agent",
  "creator_name": "hermes-scheduler"
}

# Update an event  (send an explicit null to clear a nullable field)
PUT /api/plugins/calendar/events/{id}
{ "title": "Updated title" }

# Delete an event
DELETE /api/plugins/calendar/events/{id}
```

`creator` is `"user"` or `"agent"` and is set **once, at creation** — a `PUT`
cannot relabel who made an event. Pass `editor` / `editor_name` on a `PUT` to
record who made *that* edit; the card shows it as "Last edited". A name is
stored only alongside `"agent"`, so a `"user"` write can't carry an agent
byline. Rows created before these fields existed report as `user`, which is the
right assumption for a hand-made calendar.

#### Todos

```bash
# List todos for a date
GET /api/plugins/calendar/todos?date=2026-08-05

# Create a todo  (creator/creator_name accepted, same as events)
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
│  │  ├── ROUTES_AREA → /calendar     │   │
│  │  ├── SIDEBAR_NAV → sidebar icon  │   │
│  │  ├── STATUSBAR   → pill+overlay  │   │
│  │  ├── PALETTE     → ⌘K commands   │   │
│  │  └── KEYBINDS    → ⌘⌥C, ⌘⌥E      │   │
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

### Styling: don't reach for Tailwind

`plugin.js` ships its own stylesheet (`PLUGIN_CSS`, injected into `<head>` at
register and removed on unload) and styles its markup with `hcal-*` classes.

**Do not add Tailwind utility classes to this plugin's own markup.** Tailwind v4
generates utilities by scanning the *app's* source at build time. A plugin loaded
at runtime from `~/.hermes/desktop-plugins` is not in that scan, so any class the
app doesn't already use for itself has no rule at all and silently does nothing.
`grid-cols-7` is the one that mattered: absent from the shipped stylesheet, it
collapsed every calendar grid into a single column.

Components imported from `@hermes/plugin-sdk` (`Button`, `Input`, `Dialog`, …) are
app-built and bring their own styling — keep using those.

Theme colors are read as CSS custom properties (`--ui-text-primary`, `--ui-accent`,
`--ui-surface-background`, …). Those are runtime values, not build-time utilities,
so they are always available and the calendar re-themes with the rest of Hermes.

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