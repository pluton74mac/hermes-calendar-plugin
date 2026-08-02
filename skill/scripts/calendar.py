#!/usr/bin/env python3
"""Agent-facing CLI for the Hermes Calendar plugin.

Drives the plugin's own backend (``dashboard/plugin_api.py``) by importing it
and calling its handlers directly — the same pydantic validation, the same SQL,
the same schema migration the dashboard uses, minus the HTTP hop.

Why not HTTP? The plugin's REST routes live under ``/api/plugins/calendar/`` on
the Hermes web server, and every ``/api/`` route requires the dashboard session
token. That token is deliberately stripped from agent shells (it is on Hermes'
subprocess env blocklist), because it authenticates the entire dashboard
surface — config, MCP, the agent API — not just this calendar. Importing the
handlers keeps the exact same behaviour without asking for a credential that
broad, and works with the desktop app closed.

Every command prints JSON on stdout. Errors print {"error": "..."} and exit 1.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path


def _default_hermes_home() -> Path:
    if sys.platform == "win32":
        local_appdata = os.environ.get("LOCALAPPDATA", "").strip()
        base = Path(local_appdata) if local_appdata else Path.home() / "AppData" / "Local"
        return base / "hermes"
    return Path.home() / ".hermes"


def hermes_home() -> Path:
    configured = os.environ.get("HERMES_HOME", "").strip()
    return Path(configured) if configured else _default_hermes_home()


def load_api():
    """Import the installed plugin backend as a module."""
    api_path = hermes_home() / "plugins" / "calendar" / "dashboard" / "plugin_api.py"
    if not api_path.exists():
        fail(
            f"calendar backend not found at {api_path}. "
            "Install the plugin first: https://github.com/pluton74mac/hermes-calendar-plugin"
        )
    spec = importlib.util.spec_from_file_location("hermes_calendar_api", api_path)
    if spec is None or spec.loader is None:
        fail(f"could not load {api_path}")
    module = importlib.util.module_from_spec(spec)
    # Registered before exec so pydantic can resolve the module's own
    # forward references (it uses `from __future__ import annotations`).
    sys.modules["hermes_calendar_api"] = module
    spec.loader.exec_module(module)
    return module


def fail(message: str) -> None:
    print(json.dumps({"error": message}), file=sys.stdout)
    raise SystemExit(1)


def emit(payload) -> None:
    print(json.dumps(payload, indent=2, default=str))


def who(args) -> dict:
    """Provenance for a write. Defaults to the agent, named where possible."""
    if args.as_user:
        return {"creator": "user", "creator_name": None}
    name = args.agent or os.environ.get("HERMES_AGENT_NAME") or None
    return {"creator": "agent", "creator_name": name}


def editor(args) -> dict:
    if args.as_user:
        return {"editor": "user", "editor_name": None}
    return {"editor": "agent", "editor_name": args.agent or os.environ.get("HERMES_AGENT_NAME") or None}


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def cmd_list(api, args):
    start = args.start or args.date
    end = args.end or args.date or start
    if not start:
        fail("give --date, or --start and --end (YYYY-MM-DD)")
    emit(api.list_events(start_date=start, end_date=end))


def cmd_today(api, args):
    emit(api.get_today())


def cmd_add(api, args):
    body = api.EventCreate(
        title=args.title,
        date=args.date,
        start_time=args.start_time,
        end_time=args.end_time,
        all_day=args.all_day,
        color=args.color or "#4f8cff",
        description=args.description or "",
        **who(args),
    )
    emit(api.create_event(body))


def cmd_update(api, args):
    fields = {}
    for name in ("title", "date", "color", "description"):
        value = getattr(args, name)
        if value is not None:
            fields[name] = value
    # Presence, not None-ness: --clear-times sends explicit nulls.
    if args.clear_times:
        fields["start_time"] = None
        fields["end_time"] = None
    else:
        if args.start_time is not None:
            fields["start_time"] = args.start_time
        if args.end_time is not None:
            fields["end_time"] = args.end_time
    if args.all_day is not None:
        fields["all_day"] = args.all_day
    if not fields:
        fail("nothing to update — pass at least one field")
    emit(api.update_event(args.id, api.EventUpdate(**fields, **editor(args))))


def cmd_delete(api, args):
    emit(api.delete_event(args.id))


def cmd_todo_list(api, args):
    emit(api.list_todos(date=args.date))


def cmd_todo_add(api, args):
    emit(api.create_todo(api.TodoCreate(title=args.title, date=args.date, **who(args))))


def cmd_todo_set(api, args):
    emit(api.update_todo(args.id, api.TodoUpdate(completed=args.completed)))


def cmd_todo_delete(api, args):
    emit(api.delete_todo(args.id))


# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="calendar.py",
        description="Read and write the Hermes calendar (events + to-dos).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def identity(p):
        p.add_argument("--agent", help="Agent name recorded as the creator/editor.")
        p.add_argument("--as-user", action="store_true",
                       help="Record the write as the user rather than an agent.")

    p = sub.add_parser("list", help="List events in a date range.")
    p.add_argument("--date", help="Single day (YYYY-MM-DD).")
    p.add_argument("--start", help="Range start (YYYY-MM-DD).")
    p.add_argument("--end", help="Range end (YYYY-MM-DD).")
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("today", help="Today's events and to-dos.")
    p.set_defaults(func=cmd_today)

    p = sub.add_parser("add", help="Create an event.")
    p.add_argument("--title", required=True)
    p.add_argument("--date", required=True, help="YYYY-MM-DD")
    p.add_argument("--start-time", dest="start_time", help="HH:MM (24h)")
    p.add_argument("--end-time", dest="end_time", help="HH:MM (24h)")
    p.add_argument("--all-day", dest="all_day", action="store_true")
    p.add_argument("--color", help="Hex colour, e.g. #22c55e")
    p.add_argument("--description")
    identity(p)
    p.set_defaults(func=cmd_add)

    p = sub.add_parser("update", help="Update an event.")
    p.add_argument("id")
    p.add_argument("--title")
    p.add_argument("--date")
    p.add_argument("--start-time", dest="start_time")
    p.add_argument("--end-time", dest="end_time")
    p.add_argument("--all-day", dest="all_day", action="store_const", const=True)
    p.add_argument("--timed", dest="all_day", action="store_const", const=False,
                   help="Mark the event as not all-day.")
    p.add_argument("--clear-times", action="store_true", help="Remove start and end times.")
    p.add_argument("--color")
    p.add_argument("--description")
    identity(p)
    p.set_defaults(func=cmd_update)

    p = sub.add_parser("delete", help="Delete an event.")
    p.add_argument("id")
    p.set_defaults(func=cmd_delete)

    todo = sub.add_parser("todo", help="To-do list for a day.").add_subparsers(
        dest="todo_command", required=True)

    p = todo.add_parser("list", help="List to-dos for a date.")
    p.add_argument("--date", required=True)
    p.set_defaults(func=cmd_todo_list)

    p = todo.add_parser("add", help="Add a to-do.")
    p.add_argument("--title", required=True)
    p.add_argument("--date", required=True)
    identity(p)
    p.set_defaults(func=cmd_todo_add)

    p = todo.add_parser("done", help="Mark a to-do complete.")
    p.add_argument("id")
    p.set_defaults(func=cmd_todo_set, completed=True)

    p = todo.add_parser("undone", help="Mark a to-do incomplete.")
    p.add_argument("id")
    p.set_defaults(func=cmd_todo_set, completed=False)

    p = todo.add_parser("delete", help="Delete a to-do.")
    p.add_argument("id")
    p.set_defaults(func=cmd_todo_delete)

    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    api = load_api()
    try:
        args.func(api, args)
    except SystemExit:
        raise
    except Exception as exc:  # pydantic ValidationError, HTTPException, sqlite errors
        detail = getattr(exc, "detail", None) or str(exc)
        status = getattr(exc, "status_code", None)
        fail(f"{detail}" + (f" (status {status})" if status else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
