"""Turn the stadium spreadsheet into a module the field engine can build from.

Input (dropped in by hand, not generated):
    assets/parks/stadium_dimensions.xlsx

Output:
    src/data/parks.js       one record per ballpark, keyed by venue name

The sheet is one row per park and nineteen columns wide. Only some of it is
geometry the engine can use; the rest is carried through because it costs
nothing to keep and the seating bowl will want it later.

    A  Stadium                     O  LF line       \\
    B  Team                        P  LF power alley |  the outfield wall,
    C  MLB lifetime (years)        Q  Center field   |  sampled at -45, -22.5,
    D  Seating capacity            R  RF power alley |  0, +22.5, +45 degrees
    E  1st deck rows               S  RF line       /
    F  2nd deck rows
    G  Upper deck rows             H  Fair territory   (1000 sq ft)
    J  LF fence height             I  Foul territory   (1000 sq ft)
    K  CF fence height             M  Compass bearing to center field
    L  RF fence height             N  Backstop distance

WHY THE POWER-ALLEY ANGLES ARE KNOWN TO BE 22.5 DEGREES

The sheet never says what angle columns P and R are measured at, and the whole
fence reconstruction depends on the answer. Column H settles it: integrating
1/2 r^2 dtheta between the foul lines over the five samples reproduces the
listed fair territory to within a couple of percent for all 32 parks, and the
residual is a consistent small undercount rather than scatter. Sampled at any
other angle the five numbers would not close on the listed area at all. So H is
not just carried through -- it is the check that the geometry emitted here is
right, and main() prints the per-park error for exactly that reason.

THE ANNOTATION GRAMMAR

The source marks cells up rather than keeping notes in a separate column:

    -410        a leading minus: the distance is NOT posted on the outfield
                wall -- it was read off a scale drawing. Camden's -400 and
                Kauffman's -410 are their real distances, so the sign is a
                confidence flag and not a different number. Kept as `est`.
    [ Name ]    park's current sponsor name
    *           a footnote in the source; nothing we can act on
    (R)         retired -- the park is no longer in use
    (?) ! ' +   qualifiers on capacity and lifetime, all decorative here
    13+12       a deck built in two separate tiers

Run it:

    python scripts/build_parks.py
"""

from __future__ import annotations

import json
import math
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
XLSX = ROOT / "assets" / "parks" / "stadium_dimensions.xlsx"
JS_OUT = ROOT / "src" / "data" / "parks.js"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

# The angle each outfield column is measured at, in the engine's convention:
# 0 is the center-field line, positive toward first base, foul lines at +/-45.
FENCE_ANGLES = [("O", -45.0), ("P", -22.5), ("Q", 0.0), ("R", 22.5), ("S", 45.0)]

# Compass bearing -> degrees clockwise from north. The sheet uses the 16-point
# compass and no park needs finer than that.
COMPASS = {
    "N": 0.0, "NNE": 22.5, "NE": 45.0, "ENE": 67.5,
    "E": 90.0, "ESE": 112.5, "SE": 135.0, "SSE": 157.5,
    "S": 180.0, "SSW": 202.5, "SW": 225.0, "WSW": 247.5,
    "W": 270.0, "WNW": 292.5, "NW": 315.0, "NNW": 337.5,
}

# Club nickname -> abbreviation. Matched longest-first against the team cell, so
# "White Sox" cannot be swallowed by "Sox". Includes the names the sheet uses
# for clubs that have since been renamed or moved; `None` means the franchise no
# longer exists and no live game will ever key on it.
TEAM_ALIASES = {
    "diamondbacks": "AZ", "blue jays": "TOR", "white sox": "CWS",
    "red sox": "BOS", "athletics": "ATH", "guardians": "CLE",
    "indians": "CLE", "nationals": "WSH", "phillies": "PHI",
    "cardinals": "STL", "dodgers": "LAD", "brewers": "MIL",
    "mariners": "SEA", "rangers": "TEX", "yankees": "NYY",
    "pirates": "PIT", "rockies": "COL", "marlins": "MIA",
    "orioles": "BAL", "padres": "SD", "angels": "LAA",
    "astros": "HOU", "royals": "KC", "braves": "ATL",
    "giants": "SF", "tigers": "DET", "twins": "MIN",
    "cubs": "CHC", "reds": "CIN", "mets": "NYM", "rays": "TB",
    "expos": None,
}

# Venues the MLB feed names differently from the sheet, normalised on both
# sides: what the feed may send -> the key the sheet's own name produces. Only
# renames the feed has already adopted belong here.
#
# Applied at LOOKUP time, not here -- the sheet spells these the old way, so
# rewriting keys as they are generated would fire on nothing. The table is
# emitted into the module and venueKey() consults it.
VENUE_ALIASES = {
    "ratefield": "guaranteedratefield",
}


# --- Reading the sheet ---------------------------------------------------


def read_sheet(path):
    """Rows of {column letter: cell text}, in sheet order.

    Parsed straight out of the zip rather than through openpyxl: the file is one
    flat sheet of text and numbers, and the server currently depends on nothing
    but `requests`. Adding a build-only dependency to read 32 rows is not a
    trade worth making.
    """
    with zipfile.ZipFile(path) as z:
        shared = [
            "".join(t.text or "" for t in si.iter(NS + "t"))
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(NS + "si")
        ]
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))

    rows = []
    for row in sheet.iter(NS + "row"):
        cells = {}
        for c in row.findall(NS + "c"):
            column = "".join(ch for ch in c.get("r") if ch.isalpha())
            value = c.find(NS + "v")
            if c.get("t") == "s" and value is not None:
                cells[column] = shared[int(value.text)]
            elif c.get("t") == "inlineStr":
                cells[column] = "".join(t.text or "" for t in c.iter(NS + "t"))
            elif value is not None:
                cells[column] = value.text
        if cells:
            rows.append(cells)
    return rows


# --- Cell parsing --------------------------------------------------------


def measure(cell):
    """A marked-up measurement -> (value, estimated). Both None if unreadable.

    The leading minus is the source's "not posted on the wall" flag, so it is
    stripped off the magnitude and returned separately rather than producing a
    negative distance.
    """
    text = str(cell or "").strip()
    if not text:
        return None, False
    estimated = text.startswith("-")
    digits = re.sub(r"[^0-9.]", "", text.lstrip("-"))
    if not digits or digits == ".":
        return None, False
    return float(digits), estimated


def integer(cell):
    """First run of digits in a cell, commas ignored. None if there is none."""
    match = re.search(r"\d[\d,]*", str(cell or ""))
    return int(match.group().replace(",", "")) if match else None


def deck_rows(cell):
    """Rows in a seating deck, as a list -- a deck built in two tiers gives two.

    "13+12" and "21,7" are two tiers; "[40]" and "-52" are single decks the
    source qualified. A deck the sheet leaves as "-" is absent, not zero.
    """
    numbers = re.findall(r"\d+", str(cell or ""))
    return [int(n) for n in numbers]


def clean_name(cell):
    """Park name with the source's markup removed.

    The sponsor brackets, footnote asterisks and "(R)" all go. So does a trailing
    roman numeral: the sheet distinguishes Busch Stadium III from its
    predecessors, the feed just says "Busch Stadium", and there is only ever one
    of them in service at a time.
    """
    text = re.sub(r"\([^)]*\)", " ", str(cell or ""))
    text = text.replace("[", " ").replace("]", " ").replace("*", " ")
    text = re.sub(r"\s+(I{2,}|IV|V|VI{0,3})\s*$", "", text.strip())
    return re.sub(r"\s+", " ", text).strip()


def venue_key(name):
    """Normalised venue key, for matching the name the feed sends.

    Punctuation and spacing are dropped entirely, which is what makes
    "Great American Ball Park" and "Great American Ballpark", or "loanDepot
    park" and "Loan Depot Park", land on the same record.
    """
    return re.sub(r"[^a-z0-9]", "", clean_name(name).lower())


def team_abbr(cell):
    """Club abbreviation for a team cell, or None for a defunct franchise.

    Co-tenants in parentheses are dropped first -- "Boston Red Sox (& Braves)"
    is a Red Sox park, and matching the parenthesised half would file Fenway
    under Atlanta.
    """
    text = re.sub(r"\([^)]*\)", " ", str(cell or "")).lower()
    for alias in sorted(TEAM_ALIASES, key=len, reverse=True):
        if alias in text:
            return TEAM_ALIASES[alias]
    return None


# --- The fair-territory check --------------------------------------------


def fence_distance(theta, fence):
    """Wall distance at any angle, smoothstepped between samples.

    Deliberately the same interpolation the engine uses, because the point of
    the check below is to measure the geometry that will actually be built --
    not a tidier curve through the same points.
    """
    theta = max(-45.0, min(45.0, theta))
    for a, b in zip(fence, fence[1:]):
        if a["theta"] <= theta <= b["theta"]:
            u = (theta - a["theta"]) / (b["theta"] - a["theta"])
            return a["distance"] + (b["distance"] - a["distance"]) * u * u * (3 - 2 * u)
    return fence[-1]["distance"]


def fair_area(fence, steps=2000):
    """Fair territory enclosed by the wall, in sq ft: 1/2 r^2 dtheta, -45 to 45."""
    span = math.radians(90.0)
    total = 0.0
    for i in range(steps):
        theta = math.degrees(-span / 2 + span * (i + 0.5) / steps)
        total += 0.5 * fence_distance(theta, fence) ** 2 * (span / steps)
    return total


# --- Assembly ------------------------------------------------------------


def build_park(row):
    """One sheet row -> one park record, or None if it has no usable geometry."""
    name = clean_name(row.get("A"))
    if not name:
        return None

    fence = []
    for column, theta in FENCE_ANGLES:
        distance, estimated = measure(row.get(column))
        if distance is None:
            return None
        point = {"theta": theta, "distance": distance}
        if estimated:
            point["est"] = True
        fence.append(point)

    heights = {}
    for column, side in (("J", "left"), ("K", "center"), ("L", "right")):
        value, _ = measure(row.get(column))
        if value is not None:
            heights[side] = value

    backstop, _ = measure(row.get("N"))
    listed_fair, _ = measure(row.get("H"))
    listed_foul, _ = measure(row.get("I"))
    bearing = re.sub(r"[^A-Z]", "", str(row.get("M") or "").upper())

    return {
        "key": venue_key(row.get("A")),
        "name": name,
        "team": team_abbr(row.get("B")),
        "retired": "(R)" in str(row.get("A") or ""),
        "capacity": integer(row.get("D")),
        "decks": [deck_rows(row.get(c)) for c in ("E", "F", "G")],
        # The sheet gives both areas in thousands of square feet; the engine
        # works in plain feet everywhere, so convert once, here.
        "fairArea": round(listed_fair * 1000) if listed_fair else None,
        "foulArea": round(listed_foul * 1000) if listed_foul else None,
        "backstop": backstop,
        "bearing": bearing or None,
        "azimuth": COMPASS.get(bearing),
        "fence": fence,
        "wallHeight": heights,
    }


def main():
    if not XLSX.exists():
        print("missing input: %s" % XLSX.relative_to(ROOT))
        return 1

    rows = read_sheet(XLSX)
    parks = {}
    duplicates = []
    for row in rows[1:]:  # row 1 is the header
        park = build_park(row)
        if park is None:
            continue
        if park["key"] in parks:
            duplicates.append(park["name"])
            continue
        parks[park["key"]] = park

    # A club's abbreviation points at the park it plays in now, so a live game
    # can be resolved from the team alone when the venue name does not match.
    # Retired parks never claim one -- the Coliseum must not answer for the
    # Athletics.
    by_team = {}
    for key, park in parks.items():
        if park["team"] and not park["retired"]:
            by_team.setdefault(park["team"], key)

    header = (
        "/* GENERATED FILE - do not edit by hand.\n"
        "   Run `python scripts/build_parks.py` after changing\n"
        "   assets/parks/stadium_dimensions.xlsx.\n\n"
        "   One record per ballpark, keyed by its venue name stripped to letters\n"
        "   and digits -- which is how the name the MLB feed sends resolves to a\n"
        "   park without string-matching punctuation it may or may not include.\n\n"
        "     fence       wall distance at -45, -22.5, 0, +22.5, +45 degrees,\n"
        "                 0 being the center-field line and + toward first base.\n"
        "                 `est` marks a distance not posted on the wall.\n"
        "     wallHeight  fence height at the two lines and at center, in feet\n"
        "     fairArea    fair territory in sq ft, as listed. NOT derived from\n"
        "                 `fence` -- it is the independent number the built\n"
        "                 geometry is checked against.\n"
        "     foulArea    foul territory in sq ft; the side walls are placed to\n"
        "                 enclose it (see replay/field/park.js)\n"
        "     backstop    home plate to the backstop, in feet\n"
        "     azimuth     compass bearing to center field, degrees clockwise\n"
        "                 from north -- this is what aims the sun\n"
        "     decks       seating rows in the 1st, 2nd and upper decks; a deck\n"
        "                 built in two tiers has two entries\n"
        "*/\n\n"
    )

    JS_OUT.parent.mkdir(parents=True, exist_ok=True)
    JS_OUT.write_text(
        header
        + "export const PARKS = " + json.dumps(parks, indent=2, sort_keys=True) + ";\n\n"
        + "/* Abbreviation -> the park that club plays in now. */\n"
        + "export const PARK_BY_TEAM = " + json.dumps(by_team, indent=2, sort_keys=True) + ";\n\n"
        + "/* Names the feed sends that the sheet spells differently. */\n"
        + "export const VENUE_ALIASES = "
        + json.dumps(VENUE_ALIASES, indent=2, sort_keys=True) + ";\n\n"
        + "/** Normalise a venue name the way the keys above were built. */\n"
        + "export function venueKey(name) {\n"
        + "  const key = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');\n"
        + "  return VENUE_ALIASES[key] || key;\n"
        + "}\n\n"
        + "/**\n"
        + " * The key for a venue name, or null.\n"
        + " *\n"
        + " * Exact match first. Failing that, a park whose key the venue CONTAINS:\n"
        + " * the feed sells naming rights inside the name, and sends things like\n"
        + " * \"UNIQLO Field at Dodger Stadium\", which normalises to nothing on its\n"
        + " * own but has \"dodgerstadium\" sitting in it. Longest match wins, and\n"
        + " * short keys are not eligible, so this cannot latch onto a fragment.\n"
        + " */\n"
        + "export function venueMatch(venue) {\n"
        + "  const key = venueKey(venue);\n"
        + "  if (!key) return null;\n"
        + "  if (PARKS[key]) return key;\n"
        + "  let best = null;\n"
        + "  for (const candidate of Object.keys(PARKS)) {\n"
        + "    if (candidate.length < 8 || !key.includes(candidate)) continue;\n"
        + "    if (!best || candidate.length > best.length) best = candidate;\n"
        + "  }\n"
        + "  return best;\n"
        + "}\n\n"
        + "/**\n"
        + " * The park a game is played in: by venue name, falling back to the home\n"
        + " * club's current park, and null if neither is known.\n"
        + " *\n"
        + " * Venue before club on purpose -- the venue is what the feed states about\n"
        + " * THIS game, and the club's own park is only a good guess. A neutral-site\n"
        + " * game is exactly the case where the guess is wrong.\n"
        + " */\n"
        + "export function parkFor(venue, teamAbbr) {\n"
        + "  const matched = venueMatch(venue);\n"
        + "  if (matched) return PARKS[matched];\n"
        + "  const key = teamAbbr && PARK_BY_TEAM[teamAbbr.toUpperCase()];\n"
        + "  return (key && PARKS[key]) || null;\n"
        + "}\n",
        encoding="utf-8",
    )

    # --- Report ----------------------------------------------------------

    active = [p for p in parks.values() if not p["retired"]]
    print("parks:   %d (%d active, %d retired)"
          % (len(parks), len(active), len(parks) - len(active)))
    print("teams:   %d/30 clubs mapped to a current park" % len(by_team))
    print("module:  %s" % JS_OUT.relative_to(ROOT))
    if duplicates:
        print("SKIPPED duplicate venue keys: %s" % ", ".join(duplicates))

    missing = sorted(set(TEAM_ALIASES.values()) - set(by_team) - {None})
    if missing:
        print("no current park for: %s" % ", ".join(missing))

    # The check the module docstring is about: rebuild fair territory from the
    # five samples and compare it with the number the sheet lists. A park that
    # misses by more than a couple of percent has a wall the samples cannot
    # describe, and wants a hand-authored outline.
    print("\nfair territory, listed vs rebuilt from the five samples:")
    errors = []
    for park in sorted(parks.values(), key=lambda p: p["name"]):
        if not park["fairArea"]:
            continue
        built = fair_area(park["fence"])
        error = (built - park["fairArea"]) / park["fairArea"] * 100
        errors.append((abs(error), park["name"], park["fairArea"], built, error))
    for magnitude, name, listed, built, error in sorted(errors, reverse=True):
        flag = "  <-- needs a hand-authored outline" if magnitude > 4 else ""
        print("  %-30s %7.1f  %7.1f  %+6.1f%%%s"
              % (name, listed / 1000, built / 1000, error, flag))
    median = sorted(e[4] for e in errors)[len(errors) // 2]
    print("  median %+.1f%%" % median)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
