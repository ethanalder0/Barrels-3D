"""Human-readable rendering of the event dicts from game_state.

A view over the same dicts the poller already builds -- it does not change the
data, just how it looks in a terminal. Color turns itself off automatically
when stdout isn't a TTY (e.g. piped to a file), so redirected output stays clean.
"""

from __future__ import annotations

import sys

_COLOR = sys.stdout.isatty()


def _c(text, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _COLOR else str(text)


def _half(ev: dict) -> str:
    tag = {"top": "Top", "bottom": "Bot"}.get(ev.get("half"), ev.get("half") or "?")
    return f"{tag} {ev.get('inning', '?')}"


def _count(ev: dict) -> str:
    c = ev.get("count") or {}
    b, s = c.get("balls"), c.get("strikes")
    return f"{b}-{s}" if b is not None and s is not None else "?-?"


def _hit_tail(hit: dict | None) -> str:
    if not hit:
        return ""
    bits = []
    if hit.get("launch_speed") is not None:
        bits.append(f"{hit['launch_speed']} mph")
    if hit.get("launch_angle") is not None:
        bits.append(f"{hit['launch_angle']}\u00b0")
    if hit.get("total_distance") is not None:
        bits.append(f"{hit['total_distance']} ft")
    if hit.get("trajectory"):
        bits.append(str(hit["trajectory"]))
    return "  " + _c("\u2192 " + " \u00b7 ".join(bits), "33")  # yellow


def _pitch_line(ev: dict) -> str:
    p = ev.get("pitch") or {}
    name = p.get("type") or "Pitch"
    speed = p.get("speed")
    speed_str = f" {speed}" if speed is not None else ""
    call = p.get("call") or p.get("description") or ""
    matchup = f"{ev.get('pitcher')} to {ev.get('batter')}"
    marker = _c("  \u00b7", "2")  # dim
    line = f"{marker} {_half(ev)}  |  {_count(ev)}  |  {matchup}  |  {name}{speed_str} \u2014 {call}"
    return line + _hit_tail(ev.get("hit"))


def _result_line(ev: dict) -> str:
    marker = _c("\u25b6", "1;32")  # bold green
    tags = []
    if ev.get("event"):
        tags.append(ev["event"])
    if ev.get("rbi"):
        tags.append(f"{ev['rbi']} RBI")
    tag_str = f"  [{', '.join(tags)}]" if tags else ""
    score = ev.get("score") or {}
    a, h = score.get("away"), score.get("home")
    score_str = f"   {a}-{h}" if a is not None and h is not None else ""
    desc = ev.get("description") or ev.get("event") or ""
    body = _c(f"{_half(ev)}  |  {desc}{tag_str}{score_str}", "1")
    return f"{marker} {body}"


def format_event(ev: dict) -> str:
    """Return one readable line for a pitch or play_result event."""
    if ev.get("type") == "play_result":
        return _result_line(ev)
    return _pitch_line(ev)
