---
name: hermes-calendar
# Kept under SKILL_PROMPT_DESC_LIMIT (60) — the system-prompt skill index
# truncates past that, and a description cut mid-word triggers poorly.
description: "Read/write the user's calendar: events, schedule, to-dos."
version: 1.2.0
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [calendar, events, schedule, todo, appointments, reminders, planning]
    category: productivity
    homepage: https://github.com/pluton74mac/hermes-calendar-plugin
---

# Hermes Calendar

The user's calendar, shown in the Hermes desktop app's Calendar page. Use this
skill whenever the user asks about their schedule, wants an event created,
moved or cancelled, or wants something added to a day's to-do list.

Everything goes through one script:

```bash
CAL="python ${HERMES_HOME:-$HOME/.hermes}/skills/productivity/hermes-calendar/scripts/calendar.py"
```

It works whether or not the desktop app is running — it talks to the calendar's
own database directly. Changes appear in the UI within a minute (the app polls),
or immediately when the user next opens the calendar.

Every command prints JSON. On failure it prints `{"error": "..."}` and exits 1.

## Reading

```bash
$CAL today                                  # today's events + to-dos
$CAL list --date 2026-08-10                 # one day
$CAL list --start 2026-08-01 --end 2026-08-31   # a range
```

Dates are always `YYYY-MM-DD`. Times are 24-hour `HH:MM`.

**Always read before you write.** Check the day first so you don't double-book
or duplicate an event the user already has.

## Creating an event

```bash
$CAL add --title "Dentist" --date 2026-08-12 --start-time 14:30 --end-time 15:15
$CAL add --title "Conference" --date 2026-08-20 --all-day
$CAL add --title "Standup" --date 2026-08-12 --start-time 09:00 --end-time 09:15 \
         --color "#22c55e" --description "Daily sync"
```

Give an end time whenever you know one — the day view draws an event across its
real duration, so an event without one is shown as a one-hour block.

## Updating and deleting

```bash
$CAL update <id> --title "Dentist (rescheduled)" --start-time 16:00 --end-time 16:45
$CAL update <id> --all-day --clear-times      # convert to an all-day event
$CAL delete <id>
```

Get the `id` from `list` or `today`. Only send the fields you are changing.

## To-dos

To-dos belong to a specific day and appear in the day view's checklist.

```bash
$CAL todo list --date 2026-08-12
$CAL todo add --title "Book flights" --date 2026-08-12
$CAL todo done <id>
$CAL todo undone <id>
$CAL todo delete <id>
```

## Identifying yourself

Writes are recorded as agent-made by default, and the user sees this on the
event card. Pass your name so the card is specific:

```bash
$CAL add --title "Follow-up" --date 2026-08-14 --start-time 11:00 --agent scheduler
```

`--agent` (or the `HERMES_AGENT_NAME` environment variable) sets the name.
Use `--as-user` **only** when acting as a direct transcription of something the
user dictated and wants recorded as their own entry.

Who created an event is fixed at creation and cannot be changed later; edits
record you separately as the last editor.

## Colours

Default is blue. The plugin's palette:

`#4f8cff` blue · `#22c55e` green · `#f59e0b` amber · `#ef4444` red ·
`#a855f7` purple · `#ec4899` pink · `#06b6d4` cyan · `#84cc16` lime ·
`#f97316` orange · `#8b5cf6` violet

Colour-code consistently when creating a run of related events.

## Pitfalls

- **The REST API at `/api/plugins/calendar/` is not reachable from your shell.**
  Every `/api/` route needs the dashboard session token, and Hermes strips that
  token from agent subprocesses on purpose. Use this script; do not try to curl
  the endpoint or hunt for the token.
- **Do not write to the SQLite file directly.** The script applies the schema
  migration and the same validation the app uses. Hand-rolled SQL will skip both.
- **An end time at or before the start is rejected.** Check your arithmetic when
  an event crosses noon or midnight.
- **Relative dates are yours to resolve.** "Next Tuesday" must become a real
  `YYYY-MM-DD` before you call the script — confirm against `date` if unsure.
