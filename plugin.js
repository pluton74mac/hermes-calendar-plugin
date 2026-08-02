/**
 * Calendar — Hermes desktop plugin.
 *
 * A full-page calendar with year/month/week/day views, event CRUD,
 * to-do checklists, and cron job visibility. Agents read/write events
 * and todos via the REST backend; users interact through the UI.
 *
 * Python backend: ~/.hermes/plugins/calendar/dashboard/plugin_api.py
 * Auto-discovered at /api/plugins/calendar/
 */

import {
  atom,
  Badge,
  Button,
  Checkbox,
  cn,
  Codicon,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  host,
  KEYBINDS_AREA,
  PALETTE_AREA,
  ROUTES_AREA,
  ScrollArea,
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
import { useEffect, useMemo, useState } from 'react'

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

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAYS_MIN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
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

function monthGrid(year, month) {
  var firstDow = new Date(year, month, 1).getDay()
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

function getWeekDays(date) {
  var d = new Date(date)
  var day = d.getDay()
  var mon = new Date(d)
  mon.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  var days = []
  for (var i = 0; i < 7; i++) {
    days.push(addDays(mon, i))
  }
  return days
}

function formatTime(isoTime) {
  if (!isoTime) return ''
  var parts = isoTime.split(':')
  var hour = parseInt(parts[0], 10)
  if (hour === 0) return '12 AM'
  if (hour < 12) return hour + ' AM'
  if (hour === 12) return '12 PM'
  return (hour - 12) + ' PM'
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
      var body = { title: title, date: evDate, start_time: startTime || null, end_time: endTime || null, all_day: allDay, color: color, description: desc }
      return editing
        ? call('/events/' + editing.id, { method: 'PUT', body: body })
        : call('/events', { method: 'POST', body: body })
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

  if (!open) return null

  return jsx(Dialog, {
    open: true,
    onOpenChange: close,
    children: jsxs(DialogContent, {
      className: 'sm:max-w-[420px]',
      children: [
        jsx(DialogHeader, {
          children: jsx(DialogTitle, {
            children: editing ? 'Edit Event' : 'New Event'
          })
        }),
        jsxs('div', {
          className: 'flex flex-col gap-3 py-4',
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
              className: 'flex gap-2',
              children: [
                jsx('div', { className: 'flex-1', children: jsx(Input, { type: 'time', value: startTime, onChange: function (e) { setStartTime(e.target.value) } }) }),
                jsx('div', { className: 'flex-1', children: jsx(Input, { type: 'time', value: endTime, onChange: function (e) { setEndTime(e.target.value) } }) })
              ]
            }),
            jsxs('label', {
              className: 'flex items-center gap-2 text-sm',
              children: [
                jsx('input', { type: 'checkbox', checked: allDay, onChange: function (e) { setAllDay(e.target.checked) }, className: 'h-4 w-4' }),
                'All day'
              ]
            }),
            jsxs('div', {
              className: 'flex flex-wrap gap-1.5',
              children: EVENT_COLORS.map(function (c) {
                return jsx('button', {
                  type: 'button',
                  className: cn(
                    'h-6 w-6 rounded-full border-2 transition-all',
                    color === c ? 'border-foreground scale-110' : 'border-transparent'
                  ),
                  style: { backgroundColor: c },
                  onClick: function () { setColor(c) }
                }, c)
              })
            }),
            jsx(Textarea, {
              placeholder: 'Description (optional)',
              value: desc,
              onChange: function (e) { setDesc(e.target.value) },
              className: 'min-h-[60px] resize-none'
            })
          ]
        }),
        jsxs(DialogFooter, {
          children: [
            editing && jsx(Button, { variant: 'destructive', size: 'sm', onClick: function () { deleteMutation.mutate() }, children: 'Delete' }),
            jsx(Button, { variant: 'ghost', onClick: close, children: 'Cancel' }),
            jsx(Button, { onClick: function () { saveMutation.mutate() }, disabled: !title.trim(), children: 'Save' })
          ]
        })
      ]
    })
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
    mutationFn: function (title) { return call('/todos', { method: 'POST', body: { title: title, date: dateStr } }) },
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

  var hourMap = {}
  for (var h = 0; h < 24; h++) {
    var key = pad(h) + ':00'
    hourMap[key] = timedEvents.filter(function (e) {
      var st = (e.start_time || '00:00').slice(0, 5)
      return st === key
    })
  }

  var hours = Array.from({ length: 24 }, function (_, i) { return pad(i) + ':00' })

  function addTodo() {
    var text = ntt.trim()
    if (!text) return
    createTodoMutation.mutate(text)
  }

  return jsxs('div', {
    className: 'flex h-full gap-4',
    children: [
      jsxs('div', {
        className: 'flex-1 min-w-0',
        children: [
          allDayEvents.length > 0 && jsx('div', {
            className: 'mb-2 space-y-1',
            children: allDayEvents.map(function (e) {
              return jsx('div', {
                className: 'rounded px-2 py-1 text-xs font-medium cursor-pointer hover:opacity-80',
                style: { backgroundColor: e.color + '22', borderLeft: '3px solid ' + e.color },
                onClick: function () { $editingEvent.set(e); $dialogOpen.set(true) },
                children: e.title
              }, e.id)
            })
          }),
          jsx(ScrollArea, {
            className: 'h-[calc(100vh-280px)]',
            children: jsx('div', {
              children: hours.map(function (h) {
                var slotEvents = hourMap[h] || []
                return jsxs('div', {
                  className: 'flex border-t border-border/40 min-h-[48px] group',
                  children: [
                    jsx('div', {
                      className: 'w-14 shrink-0 pt-1 text-right pr-2 text-[0.65rem] text-(--ui-text-quaternary) tabular-nums',
                      children: h
                    }),
                    jsxs('div', {
                      className: 'flex-1 relative',
                      children: slotEvents.map(function (e) {
                        return jsx('div', {
                          className: 'absolute left-1 right-1 rounded px-1.5 py-0.5 text-xs font-medium cursor-pointer truncate hover:opacity-80 z-10',
                          style: { backgroundColor: e.color + '33', borderLeft: '3px solid ' + e.color, top: '2px' },
                          onClick: function () { $editingEvent.set(e); $dialogOpen.set(true) },
                          children: e.title
                        }, e.id)
                      })
                    })
                  ]
                }, h)
              })
            })
          })
        ]
      }),
      jsxs('div', {
        className: 'w-64 shrink-0 border-l border-border/40 pl-4',
        children: [
          jsx('div', {
            className: 'font-medium text-sm mb-3 flex items-center gap-2',
            children: [jsx(Codicon, { name: 'checklist', size: '0.9rem' }), 'To-Do']
          }),
          jsxs('div', {
            className: 'flex gap-1.5 mb-3',
            children: [
              jsx(Input, {
                placeholder: 'Add a to-do...',
                value: ntt,
                onChange: function (e) { $newTodoText.set(e.target.value) },
                onKeyDown: function (e) { if (e.key === 'Enter') addTodo() },
                className: 'h-8 text-xs flex-1'
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
            ? jsx('div', { className: 'text-xs text-(--ui-text-quaternary) italic', children: 'No todos for today' })
            : jsx('div', {
                className: 'space-y-1',
                children: todos.map(function (t) {
                  return jsxs('div', {
                    className: 'flex items-center gap-2 group py-1',
                    children: [
                      jsx(Checkbox, {
                        checked: Boolean(t.completed),
                        onCheckedChange: function (checked) { toggleTodoMutation.mutate({ id: t.id, completed: checked }) }
                      }),
                      jsx('span', {
                        className: cn('flex-1 text-sm cursor-pointer', t.completed && 'line-through text-(--ui-text-quaternary)'),
                        children: t.title
                      }),
                      jsx('button', {
                        type: 'button',
                        className: 'opacity-0 group-hover:opacity-100 text-(--ui-text-quaternary) hover:text-red-400 transition-opacity',
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
    className: 'flex flex-col flex-1',
    children: [
      jsx('div', {
        className: 'grid grid-cols-7 mb-1',
        children: DAYS_SHORT.map(function (dName) {
          return jsx('div', {
            className: 'text-center text-[0.65rem] font-medium text-(--ui-text-quaternary) py-1',
            children: dName
          }, dName)
        })
      }),
      jsx('div', {
        className: 'grid grid-cols-7 flex-1 auto-rows-fr',
        children: grid.flatMap(function (week, wi) {
          return week.map(function (day, di) {
            if (day === null) {
              return jsx('div', { className: 'border border-border/20 bg-muted/20' }, 'e-' + wi + '-' + di)
            }
            var ds = year + '-' + pad(month + 1) + '-' + pad(day)
            var isToday = ds === today
            var dayEvts = dayEvents[ds] || []
            var maxShow = 3

            return jsxs('div', {
              className: cn(
                'border border-border/20 p-1 cursor-pointer hover:bg-accent/30 transition-colors overflow-hidden',
                isToday && 'ring-1 ring-(--ui-accent) ring-inset'
              ),
              onClick: function () {
                $viewDate.set(new Date(year, month, day))
                $viewMode.set('day')
              },
              children: [
                jsx('div', {
                  className: cn('text-xs font-medium mb-0.5', isToday ? 'text-(--ui-accent)' : 'text-(--ui-text-secondary)'),
                  children: day
                }),
                dayEvts.slice(0, maxShow).map(function (e) {
                  return jsx('div', {
                    className: 'rounded-sm px-1 py-0.5 text-[0.6rem] truncate cursor-pointer hover:opacity-80 mb-0.5',
                    style: { backgroundColor: e.color + '22', borderLeft: '2px solid ' + e.color },
                    onClick: function (ev) { ev.stopPropagation(); $editingEvent.set(e); $dialogOpen.set(true) },
                    children: e.all_day ? e.title : formatTime(e.start_time) + ' ' + e.title
                  }, e.id)
                }),
                dayEvts.length > maxShow && jsx('div', {
                  className: 'text-[0.6rem] text-(--ui-accent) font-medium',
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
    className: 'flex flex-col flex-1',
    children: [
      jsx('div', {
        className: 'grid grid-cols-7 mb-1',
        children: weekDays.map(function (wd) {
          var ds = isoDate(wd)
          var isToday = ds === today
          return jsxs('div', {
            className: cn('text-center py-1 cursor-pointer rounded', isToday && 'bg-(--ui-accent) text-accent-foreground'),
            onClick: function () { $viewDate.set(wd); $viewMode.set('day') },
            children: [
              jsx('div', { className: 'text-[0.6rem] text-(--ui-text-quaternary)', children: DAYS_MIN[wd.getDay()] }),
              jsx('div', { className: cn('text-sm font-medium', isToday && 'text-white'), children: wd.getDate() })
            ]
          }, ds)
        })
      }),
      jsx('div', {
        className: 'flex flex-1',
        children: weekDays.map(function (wd) {
          var ds = isoDate(wd)
          var isToday = ds === today
          var dayEvts = events.filter(function (e) { return e.date === ds })
          return jsxs('div', {
            className: cn('flex-1 border-l border-border/20 first:border-l-0 p-1 overflow-y-auto', isToday && 'bg-accent/10'),
            children: dayEvts.map(function (e) {
              return jsx('div', {
                className: 'rounded px-1.5 py-1 mb-1 text-xs cursor-pointer hover:opacity-80',
                style: { backgroundColor: e.color + '22', borderLeft: '3px solid ' + e.color },
                onClick: function () { $editingEvent.set(e); $dialogOpen.set(true) },
                children: jsxs('div', {
                  children: [
                    jsx('div', { className: 'font-medium truncate', children: e.title }),
                    !e.all_day && jsx('div', { className: 'text-[0.6rem] text-(--ui-text-quaternary)', children: formatTime(e.start_time) })
                  ]
                })
              }, e.id)
            })
          }, ds)
        })
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Year view: 12 mini month grids
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
    var m = parseInt(e.date.split('-')[1], 10) - 1
    if (!eventsByMonth[m]) eventsByMonth[m] = {}
    eventsByMonth[m][e.date] = (eventsByMonth[m][e.date] || 0) + 1
  })

  return jsx('div', {
    className: 'grid grid-cols-3 gap-4 flex-1 content-start',
    children: Array.from({ length: 12 }, function (_, month) {
      var grid = monthGrid(year, month)
      return jsxs('div', {
        className: 'border border-border/20 rounded-lg p-2',
        children: [
          jsx('div', {
            className: 'text-xs font-medium mb-1 cursor-pointer hover:text-(--ui-accent)',
            onClick: function () { $viewDate.set(new Date(year, month, 1)); $viewMode.set('month') },
            children: MONTHS_SHORT[month]
          }),
          jsx('div', {
            className: 'grid grid-cols-7 gap-0 mb-0.5',
            children: DAYS_MIN.map(function (dName) {
              return jsx('div', { className: 'text-[0.5rem] text-center text-(--ui-text-quaternary)', children: dName }, dName)
            })
          }),
          grid.map(function (week) {
            return jsx('div', {
              className: 'grid grid-cols-7',
              children: week.map(function (day) {
                if (day === null) return jsx('div', {}, 'n-' + month)
                var ds = year + '-' + pad(month + 1) + '-' + pad(day)
                var isToday = ds === today
                var hasEvents = eventsByMonth[month] && eventsByMonth[month][ds]
                return jsx('div', {
                  className: cn(
                    'text-center text-[0.55rem] py-[1px]',
                    isToday && 'bg-(--ui-accent) text-accent-foreground rounded font-bold',
                    !isToday && hasEvents && 'text-(--ui-accent) font-medium'
                  ),
                  children: day
                }, ds)
              })
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

function CalendarHeader() {
  var viewMode = useValue($viewMode)
  var viewDate = useValue($viewDate)

  var d = new Date(viewDate)
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
      title = MONTHS_SHORT[wd[0].getMonth()] + ' ' + wd[0].getDate() + ' \u2013 ' + MONTHS_SHORT[wd[6].getMonth()] + ' ' + wd[6].getDate() + ', ' + wd[6].getFullYear()
      break
    }
    case 'day':
      title = DAYS_SHORT[d.getDay()] + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear()
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
    className: 'flex items-center justify-between mb-4',
    children: [
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx('button', {
            type: 'button',
            className: 'p-1 rounded hover:bg-accent/50 text-(--ui-text-tertiary)',
            onClick: function () { nav(-1) },
            children: jsx(Codicon, { name: 'chevron-left', size: '1rem' })
          }),
          jsxs('div', {
            className: 'flex items-baseline gap-2',
            children: [
              jsx('span', { className: 'text-base font-semibold', children: title }),
              jsx('button', {
                type: 'button',
                className: 'text-[0.65rem] text-(--ui-accent) hover:underline cursor-pointer',
                onClick: function () { $viewDate.set(new Date()) },
                children: 'Today'
              })
            ]
          }),
          jsx('button', {
            type: 'button',
            className: 'p-1 rounded hover:bg-accent/50 text-(--ui-text-tertiary)',
            onClick: function () { nav(1) },
            children: jsx(Codicon, { name: 'chevron-right', size: '1rem' })
          })
        ]
      }),
      jsxs('div', {
        className: 'flex items-center gap-2',
        children: [
          jsx('div', {
            className: 'flex bg-muted rounded-md p-0.5',
            children: VIEW_OPTIONS.map(function (opt) {
              return jsx('button', {
                type: 'button',
                className: cn(
                  'px-3 py-1 text-xs rounded-sm transition-all',
                  viewMode === opt.value ? 'bg-background shadow-sm font-medium' : 'text-(--ui-text-tertiary) hover:text-foreground'
                ),
                onClick: function () { $viewMode.set(opt.value) },
                children: opt.label
              }, opt.value)
            })
          }),
          jsx(Button, {
            size: 'sm',
            onClick: function () { $editingEvent.set(null); $dialogOpen.set(true) },
            children: jsxs('div', {
              className: 'flex items-center gap-1',
              children: [jsx(Codicon, { name: 'add', size: '0.8rem' }), 'Event']
            })
          })
        ]
      })
    ]
  })
}

// ---------------------------------------------------------------------------
// Main calendar page
// ---------------------------------------------------------------------------

function CalendarPage() {
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
    className: 'flex flex-col h-full p-4',
    children: [
      jsx(CalendarHeader, {}),
      jsx(EventDialog, {}),
      jsx('div', { className: 'flex-1 overflow-hidden', children: view })
    ]
  })
}

// ---------------------------------------------------------------------------
// Statusbar pill
// ---------------------------------------------------------------------------

function CalendarPill() {
  var today = todayStr()

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
      className: cn(
        'inline-flex h-full items-center gap-1 rounded-none px-1.5 text-[0.6875rem] tabular-nums transition-colors',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
      ),
      onClick: function () { host.navigate('/calendar') },
      children: jsxs('div', {
        className: 'flex items-center gap-1',
        children: [
          jsx(Codicon, { name: 'calendar', size: '0.7rem' }),
          jsx('span', { children: total })
        ]
      })
    })
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
    ctx.i18n.register({ en: { title: 'Calendar', today: 'Today', year: 'Year', month: 'Month', week: 'Week', day: 'Day', addEvent: 'Add Event', editEvent: 'Edit Event', deleteEvent: 'Delete Event', eventTitle: 'Title', eventDate: 'Date', startTime: 'Start', endTime: 'End', allDay: 'All day', color: 'Color', description: 'Description', save: 'Save', cancel: 'Cancel', delete: 'Delete', noEvents: 'No events', todos: 'To-Do', addTodo: 'Add to-do', todoPlaceholder: 'What needs to be done?', noTodos: 'No todos for today', cronJobs: 'Cron Jobs', openCalendar: 'Calendar: Open', newEvent: 'Calendar: New Event', statusbarTooltip: 'Calendar \u2014 events today' } })

    function newEvent() {
      $editingEvent.set(null)
      $dialogOpen.set(true)
      host.navigate('/calendar')
    }

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
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
        render: function () { return jsx(CalendarPill, {}) }
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'calendar.open',
          label: 'Calendar: Open',
          keywords: ['calendar', 'events', 'schedule'],
          run: function () { host.navigate('/calendar') }
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