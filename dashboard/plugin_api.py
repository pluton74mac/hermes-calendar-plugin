"""Calendar dashboard plugin — backend API routes.

Mounted at /api/plugins/calendar/ by the dashboard plugin system.
Stores events and todos in an SQLite database at ~/.hermes/calendar.db.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

log = logging.getLogger(__name__)

router = APIRouter()

def _default_hermes_home() -> Path:
    """Platform-native Hermes home, matching hermes_constants."""
    if sys.platform == "win32":
        local_appdata = os.environ.get("LOCALAPPDATA", "").strip()
        base = Path(local_appdata) if local_appdata else Path.home() / "AppData" / "Local"
        return base / "hermes"
    return Path.home() / ".hermes"


def _hermes_home() -> Path:
    """Honour HERMES_HOME so a profile-scoped install reads its own database.

    Resolved through the environment rather than ``hermes_constants`` on
    purpose: this module is imported directly (no HTTP) by the agent CLI in
    skills/, which may run outside the Hermes package path.
    """
    configured = os.environ.get("HERMES_HOME", "").strip()
    return Path(configured) if configured else _default_hermes_home()


DB_PATH = _hermes_home() / "calendar.db"


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _get_conn() -> sqlite3.Connection:
    """Get a connection, creating schema on first use (idempotent)."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _init_schema(conn)
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS events (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            date        TEXT NOT NULL,
            start_time  TEXT,
            end_time    TEXT,
            all_day     INTEGER NOT NULL DEFAULT 0,
            color       TEXT DEFAULT '#4f8cff',
            description TEXT DEFAULT '',
            creator     TEXT NOT NULL DEFAULT 'user',
            creator_name TEXT,
            editor      TEXT,
            editor_name TEXT,
            created_at  REAL NOT NULL,
            updated_at  REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS todos (
            id          TEXT PRIMARY KEY,
            title       TEXT NOT NULL,
            date        TEXT NOT NULL,
            completed   INTEGER NOT NULL DEFAULT 0,
            "order"     REAL NOT NULL DEFAULT 0,
            creator     TEXT NOT NULL DEFAULT 'user',
            creator_name TEXT,
            created_at  REAL NOT NULL,
            updated_at  REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
        CREATE INDEX IF NOT EXISTS idx_todos_date ON todos(date);
    """)
    _migrate(conn)


# Columns added after 1.0.0. Existing databases predate them, and CREATE TABLE
# IF NOT EXISTS won't touch a table that already exists — so add them here.
_ADDED_COLUMNS = {
    "events": {
        "creator": "TEXT NOT NULL DEFAULT 'user'",
        "creator_name": "TEXT",
        "editor": "TEXT",
        "editor_name": "TEXT",
    },
    "todos": {
        "creator": "TEXT NOT NULL DEFAULT 'user'",
        "creator_name": "TEXT",
    },
}


def _migrate(conn: sqlite3.Connection) -> None:
    for table, columns in _ADDED_COLUMNS.items():
        existing = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        for name, decl in columns.items():
            if name not in existing:
                conn.execute(f'ALTER TABLE {table} ADD COLUMN "{name}" {decl}')
    conn.commit()


def _now() -> float:
    return time.time()


def _today_str() -> str:
    return date.today().isoformat()


def _make_id() -> str:
    import uuid
    return uuid.uuid4().hex[:12]


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

# `\d{2}` would happily accept "25:00" or "09:99", and `\d{2}-\d{2}` a 13th
# month — bounded alternatives keep nonsense out of the database. Day-of-month
# is range-checked, not calendar-checked (Feb 30 still parses); the UI only
# ever sends real dates and a bad one simply lands on a day nobody visits.
_DATE_RE = r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$"
_TIME_RE = r"^([01]\d|2[0-3]):[0-5]\d$"
_ACTOR_RE = r"^(user|agent)$"


class EventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    date: str = Field(..., pattern=_DATE_RE)
    start_time: Optional[str] = Field(None, pattern=_TIME_RE)
    end_time: Optional[str] = Field(None, pattern=_TIME_RE)
    all_day: bool = False
    color: str = "#4f8cff"
    description: str = ""
    # Provenance, shown on the event card. Agents should POST
    # creator="agent" plus their own name; the UI sends "user".
    creator: str = Field("user", pattern=_ACTOR_RE)
    creator_name: Optional[str] = Field(None, max_length=120)


class EventUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    date: Optional[str] = Field(None, pattern=_DATE_RE)
    start_time: Optional[str] = Field(None, pattern=_TIME_RE)
    end_time: Optional[str] = Field(None, pattern=_TIME_RE)
    all_day: Optional[bool] = None
    color: Optional[str] = None
    description: Optional[str] = None
    # Who is making THIS edit — recorded as the event's last editor.
    editor: Optional[str] = Field(None, pattern=_ACTOR_RE)
    editor_name: Optional[str] = Field(None, max_length=120)


class TodoCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    date: str = Field(..., pattern=_DATE_RE)
    creator: str = Field("user", pattern=_ACTOR_RE)
    creator_name: Optional[str] = Field(None, max_length=120)


class TodoUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=500)
    completed: Optional[bool] = None
    order: Optional[float] = None
    date: Optional[str] = Field(None, pattern=_DATE_RE)


# ---------------------------------------------------------------------------
# Events endpoints
# ---------------------------------------------------------------------------

@router.get("/events")
def list_events(
    start_date: str = Query(..., pattern=_DATE_RE),
    end_date: str = Query(..., pattern=_DATE_RE),
):
    """Get events in a date range."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date, start_time",
            (start_date, end_date),
        ).fetchall()
        return {"events": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.post("/events")
def create_event(body: EventCreate):
    """Create a new event."""
    conn = _get_conn()
    try:
        ev_id = _make_id()
        ts = _now()
        # A name only means something for an agent; never let a "user" event
        # carry an agent byline.
        name = body.creator_name if body.creator == "agent" else None
        conn.execute(
            "INSERT INTO events (id, title, date, start_time, end_time, all_day, color, description, "
            "creator, creator_name, editor, editor_name, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (ev_id, body.title, body.date, body.start_time, body.end_time,
             int(body.all_day), body.color, body.description,
             body.creator, name, body.creator, name, ts, ts),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM events WHERE id = ?", (ev_id,)).fetchone()
        return {"event": dict(row)}
    finally:
        conn.close()


@router.put("/events/{event_id}")
def update_event(event_id: str, body: EventUpdate):
    """Update an event."""
    conn = _get_conn()
    try:
        existing = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Event not found")

        # Only touch fields the client actually sent, so a partial update can
        # leave the rest alone. Nullable columns use presence (not None-ness)
        # so an explicit `null` clears them — that is how the UI drops the
        # times off an event when it is switched to all-day.
        sent = body.model_fields_set
        updates: dict[str, Any] = {}
        if body.title is not None:  # NOT NULL column — null means "leave it"
            updates["title"] = body.title
        if body.date is not None:
            updates["date"] = body.date
        if "start_time" in sent:
            updates["start_time"] = body.start_time
        if "end_time" in sent:
            updates["end_time"] = body.end_time
        if body.all_day is not None:
            updates["all_day"] = int(body.all_day)
        if body.color is not None:
            updates["color"] = body.color
        if body.description is not None:
            updates["description"] = body.description
        if body.editor is not None:
            updates["editor"] = body.editor
            updates["editor_name"] = body.editor_name if body.editor == "agent" else None

        updates["updated_at"] = _now()

        set_clause = ", ".join(f'"{k}" = ?' for k in updates)
        values = list(updates.values()) + [event_id]
        conn.execute(f"UPDATE events SET {set_clause} WHERE id = ?", values)
        conn.commit()
        row = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        return {"event": dict(row)}
    finally:
        conn.close()


@router.delete("/events/{event_id}")
def delete_event(event_id: str):
    """Delete an event."""
    conn = _get_conn()
    try:
        existing = conn.execute("SELECT * FROM events WHERE id = ?", (event_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Event not found")
        conn.execute("DELETE FROM events WHERE id = ?", (event_id,))
        conn.commit()
        return {"deleted": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Todos endpoints
# ---------------------------------------------------------------------------

@router.get("/todos")
def list_todos(
    date: str = Query(..., pattern=_DATE_RE),
):
    """Get todos for a specific date."""
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM todos WHERE date = ? ORDER BY \"order\", created_at",
            (date,),
        ).fetchall()
        return {"todos": [dict(r) for r in rows]}
    finally:
        conn.close()


@router.post("/todos")
def create_todo(body: TodoCreate):
    """Create a new todo."""
    conn = _get_conn()
    try:
        todo_id = _make_id()
        ts = _now()
        # Get next order value
        max_order = conn.execute(
            "SELECT COALESCE(MAX(\"order\"), -1) + 1 FROM todos WHERE date = ?",
            (body.date,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO todos (id, title, date, completed, \"order\", creator, creator_name, created_at, updated_at) "
            "VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)",
            (todo_id, body.title, body.date, max_order,
             body.creator, body.creator_name if body.creator == "agent" else None, ts, ts),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM todos WHERE id = ?", (todo_id,)).fetchone()
        return {"todo": dict(row)}
    finally:
        conn.close()


@router.put("/todos/{todo_id}")
def update_todo(todo_id: str, body: TodoUpdate):
    """Update a todo."""
    conn = _get_conn()
    try:
        existing = conn.execute("SELECT * FROM todos WHERE id = ?", (todo_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Todo not found")

        updates: dict[str, Any] = {}
        if body.title is not None:
            updates["title"] = body.title
        if body.completed is not None:
            updates["completed"] = int(body.completed)
        if body.order is not None:
            updates["order"] = body.order
        if body.date is not None:
            updates["date"] = body.date

        updates["updated_at"] = _now()

        # Identifiers are quoted: "order" is an SQL reserved word, so an
        # unquoted `SET order = ?` is a syntax error.
        set_clause = ", ".join(f'"{k}" = ?' for k in updates)
        values = list(updates.values()) + [todo_id]
        conn.execute(f"UPDATE todos SET {set_clause} WHERE id = ?", values)
        conn.commit()
        row = conn.execute("SELECT * FROM todos WHERE id = ?", (todo_id,)).fetchone()
        return {"todo": dict(row)}
    finally:
        conn.close()


@router.delete("/todos/{todo_id}")
def delete_todo(todo_id: str):
    """Delete a todo."""
    conn = _get_conn()
    try:
        existing = conn.execute("SELECT * FROM todos WHERE id = ?", (todo_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Todo not found")
        conn.execute("DELETE FROM todos WHERE id = ?", (todo_id,))
        conn.commit()
        return {"deleted": True}
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Today summary
# ---------------------------------------------------------------------------

@router.get("/today")
def get_today():
    """Get today's events and todos count."""
    today = _today_str()
    conn = _get_conn()
    try:
        events = conn.execute(
            "SELECT * FROM events WHERE date = ? ORDER BY start_time",
            (today,),
        ).fetchall()
        todos = conn.execute(
            "SELECT * FROM todos WHERE date = ? ORDER BY \"order\", created_at",
            (today,),
        ).fetchall()
        return {
            "date": today,
            "events": [dict(r) for r in events],
            "todos": [dict(r) for r in todos],
        }
    finally:
        conn.close()