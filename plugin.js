/**
 * Calendar — Hermes desktop plugin. v1.1.0
 *
 * A full-page calendar with year/month/week/day views, event CRUD and
 * to-do checklists. Agents read/write events and todos via the REST
 * backend; users interact through the UI.
 *
 * Python backend: ~/.hermes/plugins/calendar/dashboard/plugin_api.py
 * Auto-discovered at /api/plugins/calendar/
 *
 * STYLING — this plugin ships its own stylesheet (see PLUGIN_CSS) and does not
 * use the host's Tailwind utilities. Tailwind v4 generates utilities by
 * scanning the app's own source at BUILD time; a plugin loaded at runtime from
 * ~/.hermes/desktop-plugins is not in that scan, so a class the app doesn't
 * already use for itself has no rule at all. `grid-cols-7` is the case that
 * matters here — absent from the shipped CSS, which silently collapsed every
 * calendar grid into a single column. Components imported from the SDK
 * (Button, Input, Dialog, …) are app-built and keep their own styling; only
 * this file's own markup is styled from PLUGIN_CSS.
 */

import {
  atom,
  Button,
  Checkbox,
  Codicon,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  host,
  Input,
  KEYBINDS_AREA,
  PALETTE_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
  Textarea,
  Tip,
  useMutation,
  useQuery,
  useQueryClient,
  useValue
} from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { Fragment, useEffect, useMemo, useState } from 'react'

// ---------------------------------------------------------------------------
// REST binding — bound at register time, consumed by React Query.
// ---------------------------------------------------------------------------

let rest = null

function call(path, opts) {
  return rest
    ? rest(path, opts)
    : Promise.reject(new Error('calendar api not ready'))
}

function bindApi(r) {
  rest = r
  return function () { rest = null }
}

// ---------------------------------------------------------------------------
// Stylesheet
//
// Injected into <head> at register, removed on unload. Colours come from the
// app's own CSS custom properties (those are runtime values, not build-time
// utilities, so they are always available) — the calendar re-themes with the
// rest of Hermes.
// ---------------------------------------------------------------------------

const STYLE_ID = 'hermes-calendar-plugin-styles'

const PLUGIN_CSS = `
.hcal {
  --hcal-line: color-mix(in srgb, var(--ui-text-quaternary) 26%, transparent);
  --hcal-line-soft: color-mix(in srgb, var(--ui-text-quaternary) 14%, transparent);
  --hcal-hover: color-mix(in srgb, var(--ui-text-primary) 8%, transparent);
  --hcal-muted: color-mix(in srgb, var(--ui-text-quaternary) 7%, transparent);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 0.75rem;
  color: var(--ui-text-primary);
  font-size: 0.8125rem;
}
.hcal-overlay {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: var(--ui-surface-background, var(--ui-bg-primary));
}

/* header ------------------------------------------------------------------ */
.hcal-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex: 0 0 auto; margin-bottom: 0.75rem; }
.hcal-head-l, .hcal-head-r { display: flex; align-items: center; gap: 0.375rem; }
.hcal-title { font-size: 0.95rem; font-weight: 600; white-space: nowrap; }
.hcal-icon { display: inline-flex; align-items: center; justify-content: center; width: 1.5rem; height: 1.5rem; border: 0; border-radius: 4px; background: none; color: var(--ui-text-tertiary); cursor: pointer; }
.hcal-icon:hover { background: var(--hcal-hover); color: var(--ui-text-primary); }

/* segmented view switcher -------------------------------------------------- */
.hcal-seg { display: inline-flex; padding: 2px; border-radius: 6px; background: var(--hcal-muted); }
.hcal-seg button { border: 0; background: none; padding: 0.15rem 0.6rem; font-size: 0.72rem; border-radius: 4px; color: var(--ui-text-tertiary); cursor: pointer; }
.hcal-seg button:hover { color: var(--ui-text-primary); }
.hcal-seg button[data-on='1'] { background: var(--ui-bg-elevated, var(--ui-bg-card)); color: var(--ui-text-primary); font-weight: 500; box-shadow: 0 1px 2px rgb(0 0 0 / 0.18); }

/* the 7-column week grid — the class the host stylesheet never had ---------- */
.hcal-grid7 { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.hcal-dow { text-align: center; font-size: 0.65rem; font-weight: 500; color: var(--ui-text-quaternary); padding: 0.25rem 0; }

/* month -------------------------------------------------------------------- */
.hcal-month { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.hcal-month-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); grid-auto-rows: 1fr; flex: 1; min-height: 0; border-top: 1px solid var(--hcal-line); border-left: 1px solid var(--hcal-line); }
.hcal-cell { border-right: 1px solid var(--hcal-line); border-bottom: 1px solid var(--hcal-line); padding: 2px 3px; overflow: hidden; display: flex; flex-direction: column; gap: 2px; cursor: pointer; }
.hcal-cell:hover { background: var(--hcal-hover); }
.hcal-cell--blank { background: var(--hcal-muted); cursor: default; }
.hcal-cell--blank:hover { background: var(--hcal-muted); }
.hcal-cell--today { box-shadow: inset 0 0 0 1px var(--ui-accent); }
.hcal-daynum { font-size: 0.7rem; font-weight: 500; color: var(--ui-text-secondary); }
.hcal-cell--today .hcal-daynum { color: var(--ui-accent); font-weight: 700; }
.hcal-more { font-size: 0.6rem; color: var(--ui-accent); font-weight: 500; }

/* event chips -------------------------------------------------------------- */
/* flex:none — inside a short month cell a shrinkable chip gets squashed below
   its own line-height and the label is sliced in half; let the cell clip. */
.hcal-chip { flex: none; border-radius: 3px; padding: 1px 4px; font-size: 0.62rem; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.hcal-chip:hover { filter: brightness(1.15); }
.hcal-chip--lg { font-size: 0.72rem; padding: 3px 6px; border-radius: 4px; }
.hcal-chip-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; }
.hcal-chip-time { font-size: 0.6rem; opacity: 0.75; }

/* week --------------------------------------------------------------------- */
.hcal-week { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.hcal-week-head { cursor: pointer; text-align: center; padding: 0.2rem 0; border-radius: 5px; }
.hcal-week-head:hover { background: var(--hcal-hover); }
.hcal-week-head[data-today='1'] { background: var(--ui-accent); }
.hcal-week-head[data-today='1'] .hcal-week-dow, .hcal-week-head[data-today='1'] .hcal-week-num { color: #fff; }
.hcal-week-dow { font-size: 0.6rem; color: var(--ui-text-quaternary); }
.hcal-week-num { font-size: 0.85rem; font-weight: 500; }
.hcal-week-body { display: flex; flex: 1; min-height: 0; border-top: 1px solid var(--hcal-line); }
.hcal-week-col { flex: 1; min-width: 0; padding: 3px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; border-left: 1px solid var(--hcal-line-soft); }
.hcal-week-col:first-child { border-left: 0; }
.hcal-week-col[data-today='1'] { background: color-mix(in srgb, var(--ui-accent) 8%, transparent); }

/* year --------------------------------------------------------------------- */
/* 4 x 3 that fills the pane — explicit 1fr rows, no align-content:start, so
   the twelve months share the height instead of leaving a gap underneath. */
.hcal-year { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 0.5rem; flex: 1; min-height: 0; }
.hcal-mini { display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--hcal-line); border-radius: 8px; padding: 0.35rem; overflow: hidden; }
.hcal-mini-name { flex: none; font-size: 0.72rem; font-weight: 600; margin-bottom: 0.15rem; cursor: pointer; }
.hcal-mini-name:hover { color: var(--ui-accent); }
.hcal-mini-dow { font-size: 0.5rem; text-align: center; color: var(--ui-text-quaternary); }
/* Every month renders a fixed 6 rows, so day cells line up across the year. */
.hcal-mini-weeks { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.hcal-mini-week { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); align-items: center; }
.hcal-mini-day { font-size: 0.56rem; text-align: center; border-radius: 3px; cursor: pointer; }
.hcal-mini-day:hover { background: var(--hcal-hover); }
.hcal-mini-day[data-today='1'] { background: var(--ui-accent); color: #fff; font-weight: 700; }
.hcal-mini-day[data-has='1']:not([data-today='1']) { color: var(--ui-accent); font-weight: 600; }

/* day ---------------------------------------------------------------------- */
.hcal-day { display: flex; height: 100%; min-height: 0; gap: 0.75rem; }
.hcal-day-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.hcal-allday { display: flex; flex-direction: column; gap: 3px; margin-bottom: 0.4rem; flex: 0 0 auto; }
/* The whole window fits — rows share the height, nothing scrolls. Hour rows
   are the backdrop; events are absolutely placed over them so one can span
   several hours and overlapping ones can share the width. */
.hcal-hours { position: relative; flex: 1; min-height: 0; border-top: 1px solid var(--hcal-line); overflow: hidden; }
.hcal-hourgrid { position: absolute; inset: 0; display: flex; flex-direction: column; }
.hcal-hour { flex: 1; min-height: 0; display: flex; border-bottom: 1px solid var(--hcal-line-soft); }
/* An hour pulled in only because an event lives there. */
.hcal-hour[data-extra='1'] { background: var(--hcal-muted); }
.hcal-hour-label { width: 3.5rem; flex: 0 0 auto; text-align: right; padding: 2px 6px 0 0; font-size: 0.62rem; color: var(--ui-text-quaternary); font-variant-numeric: tabular-nums; }
.hcal-hour-rest { flex: 1; min-width: 0; }
.hcal-events { position: absolute; top: 0; bottom: 0; left: 3.5rem; right: 0; }
/* min-height keeps a short event readable: a 15-minute block in a 16-hour
   window is only a couple of pixels tall, so its title would be sliced off. */
.hcal-ev { position: absolute; overflow: hidden; min-height: 1.1rem; border-radius: 4px; padding: 1px 5px; font-size: 0.7rem; line-height: 1.25; cursor: pointer; box-shadow: 0 0 0 1px var(--ui-surface-background, transparent); }
.hcal-ev:hover { filter: brightness(1.15); }
.hcal-ev-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hcal-ev-time { font-size: 0.6rem; opacity: 0.8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hcal-note { flex: none; padding-top: 0.35rem; font-size: 0.66rem; color: var(--ui-text-quaternary); }

/* day-range setting -------------------------------------------------------- */
.hcal-dayset { position: relative; flex: none; align-self: flex-start; margin-bottom: 0.35rem; }
.hcal-dayset-toggle { display: inline-flex; align-items: center; gap: 0.3rem; border: 1px solid var(--hcal-line); border-radius: 5px; background: none; padding: 0.1rem 0.4rem; font: inherit; font-size: 0.66rem; color: var(--ui-text-tertiary); cursor: pointer; }
.hcal-dayset-toggle:hover { background: var(--hcal-hover); color: var(--ui-text-primary); }
.hcal-dayset-panel { position: absolute; top: calc(100% + 4px); left: 0; z-index: 5; width: 15rem; display: flex; flex-direction: column; gap: 0.45rem; padding: 0.6rem; border: 1px solid var(--hcal-line); border-radius: 8px; background: var(--ui-bg-elevated, var(--ui-bg-card)); box-shadow: 0 8px 24px rgb(0 0 0 / 0.35); }
.hcal-dayset-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; font-size: 0.72rem; }
/* One dropdown look, shared by the day-range panel and the event form. */
.hcal-select { font: inherit; font-size: 0.72rem; padding: 0.15rem 0.3rem; border-radius: 4px; border: 1px solid var(--hcal-line); background: var(--ui-bg-input, transparent); color: var(--ui-text-primary); cursor: pointer; }
.hcal-select:hover { border-color: color-mix(in srgb, var(--ui-text-quaternary) 50%, transparent); }
.hcal-select:disabled { opacity: 0.45; cursor: default; }
.hcal-field { display: flex; flex-direction: column; gap: 0.2rem; }
.hcal-fieldlabel { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ui-text-quaternary); }

/* start/end time: hour + minute dropdowns and an AM/PM toggle */
.hcal-times { display: flex; flex-direction: column; gap: 0.5rem; }
.hcal-time { display: flex; align-items: center; gap: 0.25rem; }
.hcal-time-sep { color: var(--ui-text-quaternary); }
.hcal-mer { display: inline-flex; margin-left: 0.3rem; padding: 2px; border-radius: 5px; background: var(--hcal-muted); }
.hcal-mer button { border: 0; background: none; padding: 0.1rem 0.45rem; font: inherit; font-size: 0.68rem; border-radius: 4px; color: var(--ui-text-tertiary); cursor: pointer; }
.hcal-mer button:hover:not(:disabled) { color: var(--ui-text-primary); }
.hcal-mer button[data-on='1'] { background: var(--ui-bg-elevated, var(--ui-bg-card)); color: var(--ui-text-primary); font-weight: 600; box-shadow: 0 1px 2px rgb(0 0 0 / 0.18); }
.hcal-mer button:disabled { opacity: 0.45; cursor: default; }
.hcal-timeerr { font-size: 0.66rem; color: var(--ui-danger, #ef4444); }
.hcal-dayset-actions { display: flex; justify-content: flex-end; gap: 0.3rem; }
.hcal-dayset-note { font-size: 0.62rem; color: var(--ui-text-quaternary); line-height: 1.4; }

/* event detail card -------------------------------------------------------- */
.hcal-card { display: flex; flex-direction: column; gap: 0.7rem; padding: 0.5rem 0 0.25rem; }
.hcal-card-title { display: inline-flex; align-items: center; gap: 0.45rem; }
.hcal-card-dot { width: 0.6rem; height: 0.6rem; border-radius: 50%; flex: none; }
.hcal-card-row { display: flex; align-items: flex-start; gap: 0.5rem; color: var(--ui-text-tertiary); }
.hcal-card-rowtext { min-width: 0; }
.hcal-card-label { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ui-text-quaternary); }
.hcal-card-value { font-size: 0.8rem; color: var(--ui-text-primary); overflow-wrap: anywhere; }
.hcal-card-desc { padding-top: 0.15rem; white-space: pre-wrap; }
/* Provenance is secondary — quieter type, below a rule. */
.hcal-card-footer { display: flex; flex-direction: column; gap: 0.2rem; margin-top: 0.2rem; padding-top: 0.55rem; border-top: 1px solid var(--hcal-line-soft); }
.hcal-card-meta { display: flex; gap: 0.4rem; font-size: 0.68rem; color: var(--ui-text-quaternary); }
.hcal-card-metalabel { flex: none; }
.hcal-card-metavalue { color: var(--ui-text-tertiary); overflow-wrap: anywhere; }

/* to-do -------------------------------------------------------------------- */
.hcal-todo { width: 15rem; flex: 0 0 auto; display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--hcal-line); border-radius: 8px; padding: 0.6rem; }
.hcal-todo-head { display: flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; font-weight: 600; margin-bottom: 0.5rem; flex: 0 0 auto; }
.hcal-todo-add { display: flex; gap: 0.3rem; margin-bottom: 0.5rem; flex: 0 0 auto; }
.hcal-todo-list { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
.hcal-todo-row { display: flex; align-items: center; gap: 0.45rem; padding: 2px 0; }
.hcal-todo-text { flex: 1; min-width: 0; font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; }
.hcal-todo-row[data-done='1'] .hcal-todo-text { text-decoration: line-through; color: var(--ui-text-quaternary); }
.hcal-todo-del { border: 0; background: none; padding: 0; cursor: pointer; color: var(--ui-text-quaternary); opacity: 0; }
.hcal-todo-row:hover .hcal-todo-del { opacity: 1; }
.hcal-todo-del:hover { color: var(--ui-danger, #ef4444); }
.hcal-empty { font-size: 0.72rem; color: var(--ui-text-quaternary); font-style: italic; }

/* dialog ------------------------------------------------------------------- */
.hcal-form { display: flex; flex-direction: column; gap: 0.6rem; padding: 0.75rem 0; }
.hcal-check { display: flex; align-items: center; gap: 0.45rem; font-size: 0.8rem; }
.hcal-swatches { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.hcal-swatch { width: 1.35rem; height: 1.35rem; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
.hcal-swatch[data-on='1'] { border-color: var(--ui-text-primary); transform: scale(1.12); }

/* statusbar pill ----------------------------------------------------------- */
.hcal-pill { display: inline-flex; align-items: center; gap: 0.25rem; height: 100%; padding: 0 0.35rem; border: 0; background: none; font-size: 0.6875rem; font-variant-numeric: tabular-nums; color: var(--ui-text-tertiary); cursor: pointer; }
.hcal-pill:hover { background: var(--hcal-hover, rgb(255 255 255 / 0.08)); color: var(--ui-text-primary); }
`

function installStyles() {
  if (typeof document === 'undefined') return function () {}

  var existing = document.getElementById(STYLE_ID)
  if (existing) existing.remove()

  var el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = PLUGIN_CSS
  document.head.appendChild(el)

  return function () {
    if (el.parentNode) el.parentNode.removeChild(el)
  }
}

// ---------------------------------------------------------------------------
// Pop-out to a separate OS window.
//
// A plugin cannot open a calendar-only window: Electron's window-open handler
// denies `window.open` (it hands the URL to the external browser), and the
// route-targeted window kinds live in the main process. What IS reachable is
// the app's own "new window" bridge, which opens a full peer window. So we
// open one and leave a short-lived note in plugin storage — localStorage is
// shared across windows of the same origin, so the NEW window's copy of this
// plugin finds the note as it registers and raises the calendar itself.
// ---------------------------------------------------------------------------

let store = null

const HANDOFF_KEY = 'openOverlayOnBoot'
const HANDOFF_TTL_MS = 20000

function bindStorage(s) {
  store = s
  return function () { store = null }
}

function canPopOut() {
  return typeof window !== 'undefined' &&
    Boolean(window.hermesDesktop) &&
    typeof window.hermesDesktop.openWindow === 'function'
}

/** True once, in the window that was opened by `openInNewWindow`. */
function consumeHandoff() {
  if (!store) return false
  var ts = store.get(HANDOFF_KEY, 0)
  store.remove(HANDOFF_KEY)
  return typeof ts === 'number' && Date.now() - ts < HANDOFF_TTL_MS
}

function openInNewWindow() {
  if (!canPopOut()) {
    host.notifyError(
      new Error('the desktop shell bridge is unavailable'),
      'Calendar: cannot open a new window'
    )
    return
  }

  if (store) store.set(HANDOFF_KEY, Date.now())

  Promise.resolve(window.hermesDesktop.openWindow())
    .then(function (result) {
      if (!result || !result.ok) {
        if (store) store.remove(HANDOFF_KEY)
        host.notifyError(
          new Error((result && result.error) || 'unknown error'),
          'Calendar: could not open a new window'
        )
      }
    })
    .catch(function (err) {
      if (store) store.remove(HANDOFF_KEY)
      host.notifyError(err, 'Calendar: could not open a new window')
    })
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

function eventsKey(startDate, endDate) {
  return ['calendar', 'events', startDate, endDate]
}

function todosKey(date) {
  return ['calendar', 'todos', date]
}

function todayKey() {
  return ['calendar', 'today']
}

// ---------------------------------------------------------------------------
// State atoms
// ---------------------------------------------------------------------------

const $viewDate = atom(new Date())
const $viewMode = atom('month')
const $dialogOpen = atom(false)
const $editingEvent = atom(null)
const $newTodoText = atom('')
/** Full-window calendar layer, over the session screen. */
const $overlayOpen = atom(false)
/** Event whose detail card is showing (null = none). */
const $viewingEvent = atom(null)
/** Visible hour window in the day view, inclusive start, exclusive end. */
const $dayStartHour = atom(6)
const $dayEndHour = atom(22)
const $daySettingsOpen = atom(false)

const DAY_RANGE_KEY = 'dayHourRange'

function setDayRange(start, end) {
  var s = Math.max(0, Math.min(23, start))
  var e = Math.max(s + 1, Math.min(24, end))
  $dayStartHour.set(s)
  $dayEndHour.set(e)
  if (store) store.set(DAY_RANGE_KEY, { start: s, end: e })
}

function loadDayRange() {
  if (!store) return
  var saved = store.get(DAY_RANGE_KEY, null)
  if (saved && typeof saved.start === 'number' && typeof saved.end === 'number') {
    $dayStartHour.set(Math.max(0, Math.min(23, saved.start)))
    $dayEndHour.set(Math.max(1, Math.min(24, saved.end)))
  }
}

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

// Monday-first, so every grid reads Mon…Sun. `dowIndex` converts a JS
// getDay() (Sun=0) into a column in these arrays — index them with that, never
// with getDay() directly.
const DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAYS_MIN = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]
const EVENT_COLORS = [
  '#4f8cff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#8b5cf6'
]

function pad(n) {
  return String(n).padStart(2, '0')
}

function todayStr() {
  var d = new Date()
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function isoDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
}

function addDays(date, n) {
  var d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

/** Column for a date in a Monday-first week: Mon=0 … Sun=6. */
function dowIndex(d) {
  return (d.getDay() + 6) % 7
}

function monthGrid(year, month) {
  var firstDow = dowIndex(new Date(year, month, 1))
  var days = daysInMonth(year, month)
  var grid = []
  var week = []
  for (var i = 0; i < firstDow; i++) week.push(null)
  for (var d = 1; d <= days; d++) {
    week.push(d)
    if (week.length === 7) { grid.push(week); week = [] }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null)
    grid.push(week)
  }
  return grid
}

/** Today always lands on today's day view, so it's only inert when you are
 *  already looking at exactly that. */
function viewShowsToday(viewMode, viewDate) {
  return viewMode === 'day' && isoDate(viewDate) === todayStr()
}

/** Pad a month grid out to `rows` week rows, so a 4- or 5-row month occupies
 *  the same height as a 6-row one (keeps the year view's cells aligned). */
function padWeeks(grid, rows) {
  var out = grid.slice()
  while (out.length < rows) out.push([null, null, null, null, null, null, null])
  return out
}

// Monday-first, matching `monthGrid` and the DAYS_SHORT header row.
function getWeekDays(date) {
  var d = new Date(date)
  var mon = new Date(d)
  mon.setDate(d.getDate() - dowIndex(d))
  var days = []
  for (var i = 0; i < 7; i++) {
    days.push(addDays(mon, i))
  }
  return days
}

function formatTime(isoTime) {
  if (!isoTime) return ''
  var parts = String(isoTime).split(':')
  var hour = parseInt(parts[0], 10)
  if (isNaN(hour)) return ''
  var minute = parseInt(parts[1], 10)
  if (isNaN(minute)) minute = 0
  var suffix = hour < 12 ? 'AM' : 'PM'
  var h12 = hour % 12
  if (h12 === 0) h12 = 12
  return minute === 0
    ? h12 + ' ' + suffix
    : h12 + ':' + pad(minute) + ' ' + suffix
}

/** Minutes past midnight, or null when the time is unusable. */
function minutesOf(isoTime) {
  var parts = String(isoTime || '').split(':')
  var h = parseInt(parts[0], 10)
  var m = parseInt(parts[1], 10)
  if (isNaN(h) || h < 0 || h > 23) return null
  if (isNaN(m) || m < 0 || m > 59) m = 0
  return h * 60 + m
}

/** DEFAULT_EVENT_MINUTES is what an event with no end time occupies — one
 *  slot, matching how such events used to render. */
const DEFAULT_EVENT_MINUTES = 60

/** An event's [start, end) in minutes past midnight. */
function eventSpan(e) {
  var start = minutesOf(e.start_time)
  if (start === null) start = 0
  var end = minutesOf(e.end_time)
  // An end at or before the start is bad data (or a wrap past midnight) —
  // fall back to the default block rather than rendering a negative height.
  if (end === null || end <= start) end = start + DEFAULT_EVENT_MINUTES
  return { start: start, end: Math.min(end, 24 * 60) }
}

/**
 * Position overlapping events into columns — any number of them, not just two.
 *
 * Events are grouped into clusters of transitively-overlapping events; within
 * a cluster each event takes the first column already free at its start time,
 * and the whole cluster is split into as many columns as that needed. So two
 * concurrent events are halves, three are thirds, and a non-overlapping event
 * still gets the full width.
 */
function layoutDayEvents(events) {
  var items = events.map(function (e) {
    var span = eventSpan(e)
    return { event: e, start: span.start, end: span.end, col: 0, cols: 1 }
  })

  items.sort(function (a, b) { return a.start - b.start || a.end - b.end })

  var cluster = []
  var clusterEnd = -1

  function flush() {
    if (!cluster.length) return
    var colEnds = []
    cluster.forEach(function (it) {
      var placed = false
      for (var c = 0; c < colEnds.length; c++) {
        if (it.start >= colEnds[c]) {
          it.col = c
          colEnds[c] = it.end
          placed = true
          break
        }
      }
      if (!placed) {
        it.col = colEnds.length
        colEnds.push(it.end)
      }
    })
    cluster.forEach(function (it) { it.cols = colEnds.length })
    cluster = []
    clusterEnd = -1
  }

  items.forEach(function (it) {
    if (cluster.length && it.start >= clusterEnd) flush()
    cluster.push(it)
    clusterEnd = Math.max(clusterEnd, it.end)
  })
  flush()

  return items
}

/** Events are agent-writable over REST, so never trust `color` to be set —
 *  a null would otherwise render as the string 'null22' in a style. */
function eventColor(e) {
  return (e && e.color) || EVENT_COLORS[0]
}

/** Tinted background + solid left edge, the chip look used by every view. */
function chipStyle(e) {
  var c = eventColor(e)
  return { backgroundColor: c + '2e', borderLeft: '3px solid ' + c }
}

// ---------------------------------------------------------------------------
// Helper: date range for current view
// ---------------------------------------------------------------------------

function useViewRange() {
  var viewMode = useValue($viewMode)
  var vd = useValue($viewDate)

  return useMemo(function () {
    switch (viewMode) {
      case 'year':
        return { start: vd.getFullYear() + '-01-01', end: vd.getFullYear() + '-12-31' }
      case 'month':
        return {
          start: vd.getFullYear() + '-' + pad(vd.getMonth() + 1) + '-01',
          end: vd.getFullYear() + '-' + pad(vd.getMonth() + 1) + '-' + pad(daysInMonth(vd.getFullYear(), vd.getMonth()))
        }
      case 'week': {
        var wd = getWeekDays(vd)
        return { start: isoDate(wd[0]), end: isoDate(wd[6]) }
      }
      case 'day':
        return { start: isoDate(vd), end: isoDate(vd) }
      default:
        return { start: todayStr(), end: todayStr() }
    }
  }, [viewMode, vd])
}

// ---------------------------------------------------------------------------
// Event dialog
// ---------------------------------------------------------------------------

const MINUTE_STEP = 5
// 12, 1, 2 … 11 — chronological within a meridiem rather than plain numeric.
const HOUR12_CHOICES = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]

/** 'HH:MM' (24h) → { hour12, minute, meridiem }, or null when unset/unusable. */
function splitTime(value) {
  var mins = minutesOf(value)
  if (mins === null) return null
  var h = Math.floor(mins / 60)
  var h12 = h % 12
  if (h12 === 0) h12 = 12
  return { hour12: h12, minute: mins % 60, meridiem: h < 12 ? 'AM' : 'PM' }
}

/** { hour12, minute, meridiem } → 'HH:MM' (24h). */
function joinTime(hour12, minute, meridiem) {
  var h = hour12 % 12
  if (meridiem === 'PM') h += 12
  return pad(h) + ':' + pad(minute)
}

/** With hour/minute/meridiem picked independently, an end at or before the
 *  start is reachable — the dialog blocks the save rather than storing a
 *  negative duration. */
function endsBeforeStart(allDay, startTime, endTime) {
  if (allDay) return false
  var start = minutesOf(startTime)
  var end = minutesOf(endTime)
  return start !== null && end !== null && end <= start
}

/**
 * Hour + minute dropdowns and an AM/PM toggle. The hour list carries a '—'
 * entry so a time can still be cleared, which the backend allows (an event
 * may have no time without being all-day).
 */
function TimeSelect(props) {
  var parts = splitTime(props.value)

  function emit(hour12, minute, meridiem) {
    props.onChange(joinTime(hour12, minute, meridiem))
  }

  // Editing a cleared time has to start somewhere: 9:00 AM, then the user
  // adjusts. Picking '—' clears it again.
  var cur = parts || { hour12: 9, minute: 0, meridiem: 'AM' }

  var minuteValues = []
  for (var m = 0; m < 60; m += MINUTE_STEP) minuteValues.push(m)
  // An off-grid minute already on the event (an agent can write 09:07) stays
  // selectable, so editing never silently moves it.
  if (parts && minuteValues.indexOf(parts.minute) === -1) {
    minuteValues.push(parts.minute)
    minuteValues.sort(function (a, b) { return a - b })
  }

  return jsxs('div', {
    className: 'hcal-time',
    children: [
      jsx('select', {
        className: 'hcal-select',
        'aria-label': props.label + ' hour',
        value: parts ? String(parts.hour12) : '',
        onChange: function (e) {
          if (e.target.value === '') return props.onChange('')
          emit(parseInt(e.target.value, 10), cur.minute, cur.meridiem)
        },
        children: [jsx('option', { value: '', children: '—' }, 'none')].concat(
          HOUR12_CHOICES.map(function (h) {
            return jsx('option', { value: String(h), children: String(h) }, h)
          })
        )
      }),
      jsx('span', { className: 'hcal-time-sep', children: ':' }),
      jsx('select', {
        className: 'hcal-select',
        'aria-label': props.label + ' minutes',
        disabled: !parts,
        value: parts ? String(parts.minute) : '',
        onChange: function (e) { emit(cur.hour12, parseInt(e.target.value, 10), cur.meridiem) },
        children: minuteValues.map(function (v) {
          return jsx('option', { value: String(v), children: pad(v) }, v)
        })
      }),
      jsx('div', {
        className: 'hcal-mer',
        children: ['AM', 'PM'].map(function (mer) {
          return jsx('button', {
            type: 'button',
            'data-on': parts && parts.meridiem === mer ? '1' : '0',
            disabled: !parts,
            onClick: function () { emit(cur.hour12, cur.minute, mer) },
            children: mer
          }, mer)
        })
      })
    ]
  })
}

function EventDialog() {
  var open = useValue($dialogOpen)
  var editing = useValue($editingEvent)
  var qc = useQueryClient()
  var vm = useValue($viewMode)
  var vd = useValue($viewDate)

  var _useState = useState('')
  var title = _useState[0]
  var setTitle = _useState[1]
  var _useState2 = useState(todayStr())
  var evDate = _useState2[0]
  var setEvDate = _useState2[1]
  var _useState3 = useState('09:00')
  var startTime = _useState3[0]
  var setStartTime = _useState3[1]
  var _useState4 = useState('10:00')
  var endTime = _useState4[0]
  var setEndTime = _useState4[1]
  var _useState5 = useState(false)
  var allDay = _useState5[0]
  var setAllDay = _useState5[1]
  var _useState6 = useState(EVENT_COLORS[0])
  var color = _useState6[0]
  var setColor = _useState6[1]
  var _useState7 = useState('')
  var desc = _useState7[0]
  var setDesc = _useState7[1]

  useEffect(function () {
    if (editing) {
      setTitle(editing.title || '')
      setEvDate(editing.date || todayStr())
      setStartTime(editing.start_time || '09:00')
      setEndTime(editing.end_time || '10:00')
      setAllDay(Boolean(editing.all_day))
      setColor(editing.color || EVENT_COLORS[0])
      setDesc(editing.description || '')
    } else if (open) {
      var d = vm === 'day' ? isoDate(vd) : todayStr()
      setTitle('')
      setEvDate(d)
      setStartTime('')
      setEndTime('')
      setAllDay(false)
      setColor(EVENT_COLORS[0])
      setDesc('')
    }
  }, [open, editing])

  var saveMutation = useMutation({
    mutationFn: function () {
      // An all-day event carries no times: send explicit nulls so switching an
      // existing timed event to all-day actually drops its old start/end.
      var body = {
        title: title.trim(),
        date: evDate,
        start_time: allDay ? null : (startTime || null),
        end_time: allDay ? null : (endTime || null),
        all_day: allDay,
        color: color,
        description: desc
      }
      if (editing) {
        body.editor = 'user'
        return call('/events/' + editing.id, { method: 'PUT', body: body })
      }
      // Provenance is set once, at creation — an edit must not relabel an
      // agent's event as yours.
      body.creator = 'user'
      return call('/events', { method: 'POST', body: body })
    },
    onSuccess: function () {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      $dialogOpen.set(false)
      $editingEvent.set(null)
    }
  })

  var deleteMutation = useMutation({
    mutationFn: function () { return editing ? call('/events/' + editing.id, { method: 'DELETE' }) : Promise.resolve() },
    onSuccess: function () {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      $dialogOpen.set(false)
      $editingEvent.set(null)
    }
  })

  function close() {
    $dialogOpen.set(false)
    $editingEvent.set(null)
  }

  var badRange = endsBeforeStart(allDay, startTime, endTime)

  if (!open) return null

  return jsx(Dialog, {
    open: true,
    onOpenChange: close,
    children: jsxs(DialogContent, {
      children: [
        jsx(DialogHeader, {
          children: jsx(DialogTitle, {
            children: editing ? 'Edit Event' : 'New Event'
          })
        }),
        jsxs('div', {
          className: 'hcal-form',
          children: [
            jsx(Input, {
              placeholder: 'Event title',
              value: title,
              onChange: function (e) { setTitle(e.target.value) }
            }),
            jsx(Input, {
              type: 'date',
              value: evDate,
              onChange: function (e) { setEvDate(e.target.value) }
            }),
            !allDay && jsxs('div', {
              className: 'hcal-times',
              children: [
                jsxs('div', {
                  className: 'hcal-field',
                  children: [
                    jsx('span', { className: 'hcal-fieldlabel', children: 'Starts' }),
                    jsx(TimeSelect, {
                      label: 'Start',
                      value: startTime,
                      onChange: setStartTime
                    })
                  ]
                }),
                jsxs('div', {
                  className: 'hcal-field',
                  children: [
                    jsx('span', { className: 'hcal-fieldlabel', children: 'Ends' }),
                    jsx(TimeSelect, {
                      label: 'End',
                      value: endTime,
                      onChange: setEndTime
                    })
                  ]
                }),
                badRange && jsx('div', {
                  className: 'hcal-timeerr',
                  children: 'The end time is before the start time.'
                })
              ]
            }),
            jsxs('label', {
              className: 'hcal-check',
              children: [
                jsx('input', { type: 'checkbox', checked: allDay, onChange: function (e) { setAllDay(e.target.checked) } }),
                'All day'
              ]
            }),
            jsx('div', {
              className: 'hcal-swatches',
              children: EVENT_COLORS.map(function (c) {
                return jsx('button', {
                  type: 'button',
                  className: 'hcal-swatch',
                  'data-on': color === c ? '1' : '0',
                  style: { backgroundColor: c },
                  onClick: function () { setColor(c) }
                }, c)
              })
            }),
            jsx(Textarea, {
              placeholder: 'Description (optional)',
              value: desc,
              onChange: function (e) { setDesc(e.target.value) },
              rows: 3
            })
          ]
        }),
        jsxs(DialogFooter, {
          children: [
            editing && jsx(Button, { variant: 'destructive', size: 'sm', onClick: function () { deleteMutation.mutate() }, children: 'Delete' }),
            jsx(Button, { variant: 'ghost', size: 'sm', onClick: close, children: 'Cancel' }),
            jsx(Button, {
              size: 'sm',
              onClick: function () { saveMutation.mutate() },
              disabled: !title.trim() || badRange,
              children: 'Save'
            })
          ]
        })
      ]
    })
  })
}

// ---------------------------------------------------------------------------
// Event detail card — what a click on an event opens. Editing is one gear away.
// ---------------------------------------------------------------------------

/** Epoch seconds (what the backend stores) → readable local timestamp. */
function formatStamp(epochSeconds) {
  if (!epochSeconds && epochSeconds !== 0) return 'unknown'
  var d = new Date(Number(epochSeconds) * 1000)
  if (isNaN(d.getTime())) return 'unknown'
  return DAYS_SHORT[dowIndex(d)] + ', ' + MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate() + ', ' +
    d.getFullYear() + ' at ' + formatTime(pad(d.getHours()) + ':' + pad(d.getMinutes()))
}

/** Human date for an event's own day. */
function formatEventDate(ds) {
  var parts = String(ds || '').split('-')
  if (parts.length !== 3) return ds || ''
  var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
  if (isNaN(d.getTime())) return ds
  return DAYS_SHORT[dowIndex(d)] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear()
}

function EventCard() {
  var event = useValue($viewingEvent)
  if (!event) return null

  function close() { $viewingEvent.set(null) }

  var when = event.all_day
    ? 'All day'
    : event.end_time
      ? formatTime(event.start_time) + ' – ' + formatTime(event.end_time)
      : formatTime(event.start_time) || 'No time set'

  // Rows created before provenance existed report as 'user' via the column
  // default, which is the right assumption for a hand-made calendar.
  function actor(kind, name) {
    return kind === 'agent' ? 'Agent · ' + (name || 'unnamed') : 'You'
  }

  var createdBy = actor(event.creator, event.creator_name)
  var edited = event.updated_at && event.updated_at !== event.created_at
  var editedBy = actor(event.editor || event.creator, event.editor_name || event.creator_name)

  function row(icon, label, value) {
    return jsxs('div', {
      className: 'hcal-card-row',
      children: [
        jsx(Codicon, { name: icon, size: '0.85rem' }),
        jsxs('div', {
          className: 'hcal-card-rowtext',
          children: [
            jsx('div', { className: 'hcal-card-label', children: label }),
            jsx('div', { className: 'hcal-card-value', children: value })
          ]
        })
      ]
    }, label)
  }

  function meta(label, value) {
    return jsxs('div', {
      className: 'hcal-card-meta',
      children: [
        jsx('span', { className: 'hcal-card-metalabel', children: label }),
        jsx('span', { className: 'hcal-card-metavalue', children: value })
      ]
    }, label)
  }

  return jsx(Dialog, {
    open: true,
    onOpenChange: close,
    children: jsxs(DialogContent, {
      children: [
        jsx(DialogHeader, {
          children: jsx(DialogTitle, {
            children: jsxs('span', {
              className: 'hcal-card-title',
              children: [
                jsx('span', { className: 'hcal-card-dot', style: { backgroundColor: eventColor(event) } }),
                event.title
              ]
            })
          })
        }),
        jsxs('div', {
          className: 'hcal-card',
          children: [
            // Primary: when it is, and what it's about.
            row('calendar', 'When', formatEventDate(event.date) + ' · ' + when),
            event.description
              ? jsxs('div', {
                  className: 'hcal-card-desc',
                  children: [
                    jsx('div', { className: 'hcal-card-label', children: 'Description' }),
                    jsx('div', { className: 'hcal-card-value', children: event.description })
                  ]
                })
              : jsx('div', { className: 'hcal-card-desc hcal-empty', children: 'No description' }),
            // Secondary: provenance, quieter and below a rule.
            jsxs('div', {
              className: 'hcal-card-footer',
              children: [
                meta('Created by', createdBy + ' · ' + formatStamp(event.created_at)),
                edited && meta('Last edited', editedBy + ' · ' + formatStamp(event.updated_at))
              ]
            })
          ]
        }),
        jsxs(DialogFooter, {
          children: [
            jsx(Tip, {
              label: 'Edit event',
              children: jsx('button', {
                type: 'button',
                className: 'hcal-icon',
                'aria-label': 'Edit event',
                onClick: function () {
                  $viewingEvent.set(null)
                  $editingEvent.set(event)
                  $dialogOpen.set(true)
                },
                children: jsx(Codicon, { name: 'settings-gear', size: '0.95rem' })
              })
            }),
            jsx(Button, { size: 'sm', variant: 'ghost', onClick: close, children: 'Close' })
          ]
        })
      ]
    })
  })
}

// ---------------------------------------------------------------------------
// Day view: visible-hours setting
// ---------------------------------------------------------------------------

var HOUR_CHOICES = Array.from({ length: 25 }, function (_, i) { return i })

/** Gear + panel for the day view's hour window. Persisted per install. */
function DayRangeSettings() {
  var open = useValue($daySettingsOpen)
  var start = useValue($dayStartHour)
  var end = useValue($dayEndHour)

  function hourOptions(list) {
    return list.map(function (h) {
      return jsx('option', { value: h, children: formatTime(pad(h % 24) + ':00') }, h)
    })
  }

  return jsxs('div', {
    className: 'hcal-dayset',
    children: [
      jsxs('button', {
        type: 'button',
        className: 'hcal-dayset-toggle',
        onClick: function () { $daySettingsOpen.set(!open) },
        children: [
          jsx(Codicon, { name: 'settings-gear', size: '0.8rem' }),
          formatTime(pad(start) + ':00') + ' – ' + formatTime(pad(end % 24) + ':00')
        ]
      }),
      open && jsxs('div', {
        className: 'hcal-dayset-panel',
        children: [
          jsxs('label', {
            className: 'hcal-dayset-row',
            children: [
              'From',
              jsx('select', {
                className: 'hcal-select',
                value: start,
                onChange: function (e) { setDayRange(parseInt(e.target.value, 10), end) },
                children: hourOptions(HOUR_CHOICES.slice(0, 24))
              })
            ]
          }),
          jsxs('label', {
            className: 'hcal-dayset-row',
            children: [
              'To',
              jsx('select', {
                className: 'hcal-select',
                value: end,
                onChange: function (e) { setDayRange(start, parseInt(e.target.value, 10)) },
                children: hourOptions(HOUR_CHOICES.filter(function (h) { return h > start }))
              })
            ]
          }),
          jsxs('div', {
            className: 'hcal-dayset-actions',
            children: [
              jsx(Button, { size: 'xs', variant: 'ghost', onClick: function () { setDayRange(0, 24) }, children: 'Full day' }),
              jsx(Button, { size: 'xs', variant: 'ghost', onClick: function () { setDayRange(6, 22) }, children: 'Reset' }),
              jsx(Button, { size: 'xs', onClick: function () { $daySettingsOpen.set(false) }, children: 'Done' })
            ]
          }),
          jsx('div', {
            className: 'hcal-dayset-note',
            children: 'A day with events outside this window widens to fit them.'
          })
        ]
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Day view: hourly timeline + todo list
// ---------------------------------------------------------------------------

function DayView() {
  var d = useValue($viewDate)
  var dateStr = isoDate(d)
  var qc = useQueryClient()
  var ntt = useValue($newTodoText)

  var eventsResult = useQuery({
    queryKey: eventsKey(dateStr, dateStr),
    queryFn: function () { return call('/events?start_date=' + dateStr + '&end_date=' + dateStr) }
  })
  var todosResult = useQuery({
    queryKey: todosKey(dateStr),
    queryFn: function () { return call('/todos?date=' + dateStr) }
  })

  var events = (eventsResult.data && eventsResult.data.events) || []
  var todos = (todosResult.data && todosResult.data.todos) || []

  var createTodoMutation = useMutation({
    mutationFn: function (title) { return call('/todos', { method: 'POST', body: { title: title, date: dateStr, creator: 'user' } }) },
    onSuccess: function () {
      qc.invalidateQueries({ queryKey: ['calendar', 'todos', dateStr] })
      qc.invalidateQueries({ queryKey: ['calendar', 'today'] })
      $newTodoText.set('')
    }
  })

  var toggleTodoMutation = useMutation({
    mutationFn: function (args) { return call('/todos/' + args.id, { method: 'PUT', body: { completed: args.completed } }) },
    onSuccess: function () {
      qc.invalidateQueries({ queryKey: ['calendar', 'todos', dateStr] })
      qc.invalidateQueries({ queryKey: ['calendar', 'today'] })
    }
  })

  var deleteTodoMutation = useMutation({
    mutationFn: function (id) { return call('/todos/' + id, { method: 'DELETE' }) },
    onSuccess: function () {
      qc.invalidateQueries({ queryKey: ['calendar', 'todos', dateStr] })
      qc.invalidateQueries({ queryKey: ['calendar', 'today'] })
    }
  })

  var dayEvents = events.filter(function (e) { return e.date === dateStr })
  var allDayEvents = dayEvents.filter(function (e) { return e.all_day })
  var timedEvents = dayEvents.filter(function (e) { return !e.all_day })

  // Events are positioned over the hour grid by their real start/end, so a
  // two-hour meeting covers two hours instead of sitting in one slot.
  var laidOut = layoutDayEvents(timedEvents)

  function addTodo() {
    var text = ntt.trim()
    if (!text) return
    createTodoMutation.mutate(text)
  }

  // The visible window is the configured range, widened just enough to hold
  // any event that falls outside it — and only for the day that has one, so a
  // single 5am alarm doesn't permanently expand every other day.
  var startHour = useValue($dayStartHour)
  var endHour = useValue($dayEndHour)

  // Widen to cover an event's whole span, not just where it starts — an
  // event running past the window's end would otherwise be clipped.
  var visStart = startHour
  var visEnd = endHour
  laidOut.forEach(function (it) {
    var firstHour = Math.floor(it.start / 60)
    var lastHour = Math.ceil(it.end / 60)
    if (firstHour < visStart) visStart = firstHour
    if (lastHour > visEnd) visEnd = lastHour
  })
  visEnd = Math.min(24, Math.max(visEnd, visStart + 1))

  var outsideCount = laidOut.filter(function (it) {
    return Math.floor(it.start / 60) < startHour || Math.ceil(it.end / 60) > endHour
  }).length

  var visibleHours = []
  for (var vh = visStart; vh < visEnd; vh++) visibleHours.push(vh)

  var winStart = visStart * 60
  var winMinutes = (visEnd - visStart) * 60

  function placement(it) {
    var top = ((it.start - winStart) / winMinutes) * 100
    var height = ((it.end - it.start) / winMinutes) * 100
    var width = 100 / it.cols
    return {
      top: Math.max(0, top) + '%',
      height: Math.min(100 - Math.max(0, top), height) + '%',
      left: (it.col * width) + '%',
      width: width + '%'
    }
  }

  return jsxs('div', {
    className: 'hcal-day',
    children: [
      jsxs('div', {
        className: 'hcal-day-main',
        children: [
          allDayEvents.length > 0 && jsx('div', {
            className: 'hcal-allday',
            children: allDayEvents.map(function (e) {
              return jsx('div', {
                className: 'hcal-chip hcal-chip--lg',
                style: chipStyle(e),
                onClick: function () { $viewingEvent.set(e) },
                children: e.title
              }, e.id)
            })
          }),
          jsx(DayRangeSettings, {}),
          // Scroll container sized by the flex chain, not a hardcoded 100vh
          // sum — the calendar renders inside a pane tile whose height has
          // nothing to do with the window height.
          // The whole window is shown at once — rows share the height rather
          // than scrolling. The hour rows are the backdrop; events float over
          // them, positioned and sized by their real times.
          jsxs('div', {
            className: 'hcal-hours',
            children: [
              jsx('div', {
                className: 'hcal-hourgrid',
                children: visibleHours.map(function (hour) {
                  var label = formatTime(pad(hour) + ':00')
                  return jsxs('div', {
                    className: 'hcal-hour',
                    'data-extra': (hour < startHour || hour >= endHour) ? '1' : '0',
                    children: [
                      jsx('div', { className: 'hcal-hour-label', children: label }),
                      jsx('div', { className: 'hcal-hour-rest' })
                    ]
                  }, label)
                })
              }),
              jsx('div', {
                className: 'hcal-events',
                children: laidOut.map(function (it) {
                  var e = it.event
                  var place = placement(it)
                  var span = formatTime(e.start_time) +
                    (e.end_time ? ' – ' + formatTime(e.end_time) : '')
                  return jsxs('div', {
                    className: 'hcal-ev',
                    style: Object.assign({}, chipStyle(e), place),
                    onClick: function () { $viewingEvent.set(e) },
                    children: [
                      jsx('div', { className: 'hcal-ev-title', children: e.title }),
                      jsx('div', { className: 'hcal-ev-time', children: span })
                    ]
                  }, e.id)
                })
              })
            ]
          }),
          outsideCount > 0 && jsx('div', {
            className: 'hcal-note',
            children: outsideCount + (outsideCount === 1 ? ' event falls' : ' events fall') +
              ' outside your ' + formatTime(pad(startHour) + ':00') + '–' + formatTime(pad(endHour % 24) + ':00') +
              ' window; the day was widened to fit.'
          })
        ]
      }),
      jsxs('div', {
        className: 'hcal-todo',
        children: [
          jsxs('div', {
            className: 'hcal-todo-head',
            children: [jsx(Codicon, { name: 'checklist', size: '0.9rem' }), 'To-Do']
          }),
          jsxs('div', {
            className: 'hcal-todo-add',
            children: [
              jsx(Input, {
                placeholder: 'Add a to-do…',
                value: ntt,
                onChange: function (e) { $newTodoText.set(e.target.value) },
                onKeyDown: function (e) { if (e.key === 'Enter') addTodo() }
              }),
              jsx(Button, {
                size: 'icon-xs',
                onClick: addTodo,
                disabled: !ntt.trim(),
                children: jsx(Codicon, { name: 'add', size: '0.8rem' })
              })
            ]
          }),
          todos.length === 0
            ? jsx('div', { className: 'hcal-empty', children: 'Nothing planned' })
            : jsx('div', {
                className: 'hcal-todo-list',
                children: todos.map(function (t) {
                  return jsxs('div', {
                    className: 'hcal-todo-row',
                    'data-done': t.completed ? '1' : '0',
                    children: [
                      jsx(Checkbox, {
                        checked: Boolean(t.completed),
                        onCheckedChange: function (checked) { toggleTodoMutation.mutate({ id: t.id, completed: checked }) }
                      }),
                      jsx('span', { className: 'hcal-todo-text', children: t.title }),
                      jsx('button', {
                        type: 'button',
                        className: 'hcal-todo-del',
                        'aria-label': 'Delete to-do',
                        onClick: function () { deleteTodoMutation.mutate(t.id) },
                        children: jsx(Codicon, { name: 'trash', size: '0.75rem' })
                      })
                    ]
                  }, t.id)
                })
              })
        ]
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Month view
// ---------------------------------------------------------------------------

function MonthView() {
  var d = useValue($viewDate)
  var year = d.getFullYear()
  var month = d.getMonth()
  var today = todayStr()
  var grid = monthGrid(year, month)
  var range = useViewRange()

  var eventsResult = useQuery({
    queryKey: eventsKey(range.start, range.end),
    queryFn: function () { return call('/events?start_date=' + range.start + '&end_date=' + range.end) }
  })

  var events = (eventsResult.data && eventsResult.data.events) || []
  var dayEvents = {}
  events.forEach(function (e) {
    if (!dayEvents[e.date]) dayEvents[e.date] = []
    dayEvents[e.date].push(e)
  })

  return jsxs('div', {
    className: 'hcal-month',
    children: [
      jsx('div', {
        className: 'hcal-grid7',
        children: DAYS_SHORT.map(function (dName) {
          return jsx('div', { className: 'hcal-dow', children: dName }, dName)
        })
      }),
      jsx('div', {
        className: 'hcal-month-grid',
        children: grid.flatMap(function (week, wi) {
          return week.map(function (day, di) {
            if (day === null) {
              return jsx('div', { className: 'hcal-cell hcal-cell--blank' }, 'e-' + wi + '-' + di)
            }
            var ds = year + '-' + pad(month + 1) + '-' + pad(day)
            var isToday = ds === today
            var dayEvts = dayEvents[ds] || []
            var maxShow = 3

            return jsxs('div', {
              className: isToday ? 'hcal-cell hcal-cell--today' : 'hcal-cell',
              onClick: function () {
                $viewDate.set(new Date(year, month, day))
                $viewMode.set('day')
              },
              children: [
                jsx('div', { className: 'hcal-daynum', children: day }),
                dayEvts.slice(0, maxShow).map(function (e) {
                  return jsx('div', {
                    className: 'hcal-chip',
                    style: chipStyle(e),
                    onClick: function (ev) { ev.stopPropagation(); $viewingEvent.set(e) },
                    children: e.all_day ? e.title : formatTime(e.start_time) + ' ' + e.title
                  }, e.id)
                }),
                dayEvts.length > maxShow && jsx('div', {
                  className: 'hcal-more',
                  children: '+' + (dayEvts.length - maxShow) + ' more'
                })
              ]
            }, wi + '-' + di)
          })
        })
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Week view
// ---------------------------------------------------------------------------

function WeekView() {
  var d = useValue($viewDate)
  var today = todayStr()
  var weekDays = getWeekDays(d)
  var range = useViewRange()

  var eventsResult = useQuery({
    queryKey: eventsKey(range.start, range.end),
    queryFn: function () { return call('/events?start_date=' + range.start + '&end_date=' + range.end) }
  })

  var events = (eventsResult.data && eventsResult.data.events) || []

  return jsxs('div', {
    className: 'hcal-week',
    children: [
      jsx('div', {
        className: 'hcal-grid7',
        children: weekDays.map(function (wd) {
          var ds = isoDate(wd)
          var isToday = ds === today
          return jsxs('div', {
            className: 'hcal-week-head',
            'data-today': isToday ? '1' : '0',
            onClick: function () { $viewDate.set(wd); $viewMode.set('day') },
            children: [
              jsx('div', { className: 'hcal-week-dow', children: DAYS_MIN[dowIndex(wd)] }),
              jsx('div', { className: 'hcal-week-num', children: wd.getDate() })
            ]
          }, ds)
        })
      }),
      jsx('div', {
        className: 'hcal-week-body',
        children: weekDays.map(function (wd) {
          var ds = isoDate(wd)
          var isToday = ds === today
          var dayEvts = events.filter(function (e) { return e.date === ds })
          return jsx('div', {
            className: 'hcal-week-col',
            'data-today': isToday ? '1' : '0',
            children: dayEvts.map(function (e) {
              return jsxs('div', {
                className: 'hcal-chip hcal-chip--lg',
                style: chipStyle(e),
                onClick: function () { $viewingEvent.set(e) },
                children: [
                  jsx('div', { className: 'hcal-chip-title', children: e.title }),
                  !e.all_day && jsx('div', {
                    className: 'hcal-chip-time',
                    children: formatTime(e.start_time) +
                      (e.end_time ? ' – ' + formatTime(e.end_time) : '')
                  })
                ]
              }, e.id)
            })
          }, ds)
        })
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Year view: 12 mini month grids, 4 across
// ---------------------------------------------------------------------------

function YearView() {
  var d = useValue($viewDate)
  var year = d.getFullYear()
  var today = todayStr()
  var range = useViewRange()

  var eventsResult = useQuery({
    queryKey: eventsKey(range.start, range.end),
    queryFn: function () { return call('/events?start_date=' + range.start + '&end_date=' + range.end) }
  })

  var events = (eventsResult.data && eventsResult.data.events) || []

  var eventsByMonth = {}
  events.forEach(function (e) {
    var m = parseInt(String(e.date).split('-')[1], 10) - 1
    if (!eventsByMonth[m]) eventsByMonth[m] = {}
    eventsByMonth[m][e.date] = (eventsByMonth[m][e.date] || 0) + 1
  })

  return jsx('div', {
    className: 'hcal-year',
    children: Array.from({ length: 12 }, function (_, month) {
      var grid = monthGrid(year, month)
      return jsxs('div', {
        className: 'hcal-mini',
        children: [
          jsx('div', {
            className: 'hcal-mini-name',
            onClick: function () { $viewDate.set(new Date(year, month, 1)); $viewMode.set('month') },
            children: MONTHS_SHORT[month]
          }),
          jsx('div', {
            className: 'hcal-grid7',
            children: DAYS_MIN.map(function (dName) {
              return jsx('div', { className: 'hcal-mini-dow', children: dName }, dName)
            })
          }),
          jsx('div', {
            className: 'hcal-mini-weeks',
            children: padWeeks(grid, 6).map(function (week, wi) {
              return jsx('div', {
                className: 'hcal-mini-week',
                children: week.map(function (day, di) {
                  // Blank leading/trailing cells need keys unique within the
                  // row — a shared key collapses them during reconciliation.
                  if (day === null) return jsx('div', {}, 'n-' + wi + '-' + di)
                  var ds = year + '-' + pad(month + 1) + '-' + pad(day)
                  var isToday = ds === today
                  var hasEvents = Boolean(eventsByMonth[month] && eventsByMonth[month][ds])
                  return jsx('div', {
                    className: 'hcal-mini-day',
                    'data-today': isToday ? '1' : '0',
                    'data-has': hasEvents ? '1' : '0',
                    onClick: function () { $viewDate.set(new Date(year, month, day)); $viewMode.set('day') },
                    children: day
                  }, ds)
                })
              }, 'w-' + wi)
            })
          })
        ]
      }, month)
    })
  })
}

// ---------------------------------------------------------------------------
// Calendar header: title, nav arrows, view switcher, add event button
// ---------------------------------------------------------------------------

var VIEW_OPTIONS = [
  { value: 'year', label: 'Year' },
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' }
]

function CalendarHeader(props) {
  var viewMode = useValue($viewMode)
  var viewDate = useValue($viewDate)
  var onClose = props && props.onClose

  var d = new Date(viewDate)
  var showingToday = viewShowsToday(viewMode, d)
  var title = ''
  switch (viewMode) {
    case 'year':
      title = String(d.getFullYear())
      break
    case 'month':
      title = MONTHS[d.getMonth()] + ' ' + d.getFullYear()
      break
    case 'week': {
      var wd = getWeekDays(d)
      title = MONTHS_SHORT[wd[0].getMonth()] + ' ' + wd[0].getDate() + ' – ' + MONTHS_SHORT[wd[6].getMonth()] + ' ' + wd[6].getDate() + ', ' + wd[6].getFullYear()
      break
    }
    case 'day':
      title = DAYS_SHORT[dowIndex(d)] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear()
      break
  }

  function nav(dir) {
    var dt = new Date(viewDate)
    switch (viewMode) {
      case 'year':
        dt.setFullYear(dt.getFullYear() + dir)
        break
      case 'month':
        dt.setMonth(dt.getMonth() + dir)
        break
      case 'week':
        dt.setDate(dt.getDate() + 7 * dir)
        break
      case 'day':
        dt.setDate(dt.getDate() + dir)
        break
    }
    $viewDate.set(dt)
  }

  return jsxs('div', {
    className: 'hcal-head',
    children: [
      jsxs('div', {
        className: 'hcal-head-l',
        children: [
          jsx('button', {
            type: 'button',
            className: 'hcal-icon',
            onClick: function () { nav(-1) },
            children: jsx(Codicon, { name: 'chevron-left', size: '1rem' })
          }),
          jsx('button', {
            type: 'button',
            className: 'hcal-icon',
            onClick: function () { nav(1) },
            children: jsx(Codicon, { name: 'chevron-right', size: '1rem' })
          }),
          jsx('span', { className: 'hcal-title', children: title }),
          // Always lands on today's day view — a plain date change used to
          // leave the current month looking identical, which read as dead.
          jsx(Button, {
            size: 'xs',
            variant: 'outline',
            disabled: showingToday,
            onClick: function () {
              $viewDate.set(new Date())
              $viewMode.set('day')
            },
            children: 'Today'
          })
        ]
      }),
      jsxs('div', {
        className: 'hcal-head-r',
        children: [
          jsx('div', {
            className: 'hcal-seg',
            children: VIEW_OPTIONS.map(function (opt) {
              return jsx('button', {
                type: 'button',
                'data-on': viewMode === opt.value ? '1' : '0',
                onClick: function () { $viewMode.set(opt.value) },
                children: opt.label
              }, opt.value)
            })
          }),
          jsx(Button, {
            size: 'xs',
            onClick: function () { $editingEvent.set(null); $dialogOpen.set(true) },
            children: 'New Event'
          }),
          canPopOut() && jsx(Tip, {
            label: 'Open in a new window',
            children: jsx('button', {
              type: 'button',
              className: 'hcal-icon',
              onClick: openInNewWindow,
              children: jsx(Codicon, { name: 'multiple-windows', size: '0.9rem' })
            })
          }),
          onClose && jsx(Tip, {
            label: 'Close (Esc)',
            children: jsx('button', {
              type: 'button',
              className: 'hcal-icon',
              onClick: onClose,
              children: jsx(Codicon, { name: 'close', size: '0.9rem' })
            })
          })
        ]
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Main calendar
// ---------------------------------------------------------------------------

/** The calendar itself. Rendered both as the `/calendar` pane tile and as the
 *  full-window overlay, so the two can never drift apart. */
function CalendarBody(props) {
  var viewMode = useValue($viewMode)

  var view
  switch (viewMode) {
    case 'year':  view = jsx(YearView, {}); break
    case 'month': view = jsx(MonthView, {}); break
    case 'week':  view = jsx(WeekView, {}); break
    case 'day':   view = jsx(DayView, {}); break
    default:      view = jsx(MonthView, {}); break
  }

  return jsxs('div', {
    className: 'hcal',
    children: [
      jsx(CalendarHeader, { onClose: props && props.onClose }),
      jsx(EventCard, {}),
      jsx(EventDialog, {}),
      view
    ]
  })
}

function CalendarPage() {
  return jsx(CalendarBody, {})
}

// ---------------------------------------------------------------------------
// Full-window overlay
//
// Mounted from the statusbar contribution, which the shell renders as a
// SIBLING of the pane tree — so `position: fixed` resolves against the viewport
// instead of being trapped by a transformed pane tile. (react-dom is not
// importable from a runtime plugin, so a portal is not an option.)
// ---------------------------------------------------------------------------

function CalendarOverlay() {
  var open = useValue($overlayOpen)

  useEffect(function () {
    if (!open) return undefined

    function onKey(e) {
      if (e.key !== 'Escape') return
      // Dialogs are layered above the overlay: peel them off one at a time so
      // a single Esc never dismisses two things at once.
      if ($dialogOpen.get()) {
        $dialogOpen.set(false)
        $editingEvent.set(null)
      } else if ($viewingEvent.get()) {
        $viewingEvent.set(null)
      } else if ($daySettingsOpen.get()) {
        $daySettingsOpen.set(false)
      } else {
        $overlayOpen.set(false)
      }
      e.stopPropagation()
    }

    window.addEventListener('keydown', onKey, true)
    return function () { window.removeEventListener('keydown', onKey, true) }
  }, [open])

  if (!open) return null

  return jsx('div', {
    className: 'hcal-overlay',
    children: jsx(CalendarBody, {
      onClose: function () { $overlayOpen.set(false) }
    })
  })
}

function openOverlay() {
  $overlayOpen.set(true)
}

// ---------------------------------------------------------------------------
// Statusbar pill
// ---------------------------------------------------------------------------

function CalendarPill() {
  var result = useQuery({
    queryKey: todayKey(),
    queryFn: function () { return call('/today') },
    refetchInterval: 60_000
  })

  var todayData = result.data
  if (!todayData) return null

  var evtCount = (todayData.events && todayData.events.length) || 0
  var todoOpen = (todayData.todos && todayData.todos.filter(function (t) { return !t.completed }).length) || 0
  var total = evtCount + todoOpen

  if (total === 0) return null

  return jsx(Tip, {
    label: total + ' item' + (total !== 1 ? 's' : '') + ' today',
    children: jsx('button', {
      type: 'button',
      className: 'hcal-pill',
      onClick: openOverlay,
      children: jsxs('span', {
        style: { display: 'inline-flex', alignItems: 'center', gap: '0.25rem' },
        children: [
          jsx(Codicon, { name: 'calendar', size: '0.7rem' }),
          jsx('span', { children: total })
        ]
      })
    })
  })
}

/** The statusbar contribution: the pill, plus the overlay it hosts. The pill
 *  hides itself on a quiet day, so the overlay is a sibling — not a child —
 *  or an empty day would take the calendar layer down with it. */
function CalendarStatusbar() {
  return jsxs(Fragment, {
    children: [jsx(CalendarOverlay, {}), jsx(CalendarPill, {})]
  })
}

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

var plugin = {
  id: 'calendar',
  name: 'Calendar',
  defaultEnabled: true,

  register: function (ctx) {
    ctx.onDispose(bindApi(ctx.rest))
    ctx.onDispose(bindStorage(ctx.storage))
    ctx.onDispose(installStyles())
    loadDayRange()

    // Opened by "Calendar: Open in New Window" from a peer window? Raise the
    // calendar rather than booting into the chat screen. Deferred a tick so
    // the statusbar (the overlay's host) has mounted.
    if (consumeHandoff()) {
      var boot = setTimeout(openOverlay, 0)
      ctx.onDispose(function () { clearTimeout(boot) })
    }

    ctx.i18n.register({ en: { title: 'Calendar', today: 'Today', year: 'Year', month: 'Month', week: 'Week', day: 'Day', addEvent: 'Add Event', editEvent: 'Edit Event', deleteEvent: 'Delete Event', eventTitle: 'Title', eventDate: 'Date', startTime: 'Start', endTime: 'End', allDay: 'All day', color: 'Color', description: 'Description', save: 'Save', cancel: 'Cancel', delete: 'Delete', noEvents: 'No events', todos: 'To-Do', addTodo: 'Add to-do', todoPlaceholder: 'What needs to be done?', noTodos: 'Nothing planned', openCalendar: 'Calendar: Open', newEvent: 'Calendar: New Event', openWindow: 'Calendar: Open in New Window', statusbarTooltip: 'Calendar — events today' } })

    function newEvent() {
      $editingEvent.set(null)
      $dialogOpen.set(true)
      openOverlay()
    }

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        title: 'Calendar',
        data: { path: '/calendar' },
        render: function () { return jsx(CalendarPage, {}) }
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 60,
        data: { codicon: 'calendar', label: 'Calendar', path: '/calendar' }
      },
      {
        id: 'pill',
        area: STATUSBAR_AREAS.right,
        order: 85,
        render: function () { return jsx(CalendarStatusbar, {}) }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'calendar.open',
          label: 'Calendar: Open',
          keywords: ['calendar', 'events', 'schedule'],
          run: openOverlay
        }
      },
      {
        id: 'open-window',
        area: PALETTE_AREA,
        data: {
          id: 'calendar.openWindow',
          action: 'calendar.openWindow',
          label: 'Calendar: Open in New Window',
          keywords: ['calendar', 'window', 'popout', 'pop out', 'detach'],
          run: openInNewWindow
        }
      },
      {
        id: 'open-overlay',
        area: KEYBINDS_AREA,
        data: {
          id: 'calendar.open',
          category: 'view',
          defaults: ['mod+alt+c'],
          label: 'Calendar: Open',
          run: openOverlay
        }
      },
      {
        id: 'new-event',
        area: PALETTE_AREA,
        data: {
          id: 'calendar.newEvent',
          action: 'calendar.newEvent',
          label: 'Calendar: New Event',
          keywords: ['calendar', 'event', 'new', 'create'],
          run: newEvent
        }
      },
      {
        id: 'new-event',
        area: KEYBINDS_AREA,
        data: {
          id: 'calendar.newEvent',
          category: 'view',
          defaults: ['mod+alt+e'],
          label: 'Calendar: New Event',
          run: newEvent
        }
      }
    ])
  }
}

export default plugin
