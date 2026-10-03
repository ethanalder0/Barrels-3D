"""Turn assets/ into things the frontend can use.

Inputs (dropped in by hand, not generated):
    assets/colors/team_colors.csv                official club colours, by team name
    assets/audios/*.mp3                          sound effects

Outputs:
    public/audio/<name>.mp3         sounds, served statically
    src/data/teams.js               colours + logo URLs, keyed by abbreviation

Keyed by abbreviation because that is what the MLB feed sends on every game
(gameData.teams.away.abbreviation), so the UI never has to string-match names.

Logos are not shipped. They are MLB's own SVGs, loaded from its CDN by team id
-- the same servers the player headshots come from:

    logo       team-logos/<id>.svg              the club mark, for light grounds
    logoDark   team-cap-on-dark/<id>.svg        the cap mark recoloured for dark
                                                grounds (white Braves "A", white
                                                Yankees "NY")

Each is 0.5-1.5 KB, vector so crisp at any size, and served with a two-week
cache. When one cannot load, TeamLogo falls back to a monogram in the club's
colours.

    python scripts/build_team_assets.py
"""

from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
AUDIO_SRC = ASSETS / "audios"
AUDIO_OUT = ROOT / "public" / "audio"
JS_OUT = ROOT / "src" / "data" / "teams.js"

LOGO_CDN = "https://www.mlbstatic.com/team-logos"

# Canonical MLB abbreviations -> (team id, full name, short name). Matches the
# statsapi /v1/teams payload; kept here so the build needs no network.
TEAMS = [
    ("ATH", 133, "Athletics", "Athletics"),
    ("ATL", 144, "Atlanta Braves", "Braves"),
    ("AZ", 109, "Arizona Diamondbacks", "D-backs"),
    ("BAL", 110, "Baltimore Orioles", "Orioles"),
    ("BOS", 111, "Boston Red Sox", "Red Sox"),
    ("CHC", 112, "Chicago Cubs", "Cubs"),
    ("CIN", 113, "Cincinnati Reds", "Reds"),
    ("CLE", 114, "Cleveland Guardians", "Guardians"),
    ("COL", 115, "Colorado Rockies", "Rockies"),
    ("CWS", 145, "Chicago White Sox", "White Sox"),
    ("DET", 116, "Detroit Tigers", "Tigers"),
    ("HOU", 117, "Houston Astros", "Astros"),
    ("KC", 118, "Kansas City Royals", "Royals"),
    ("LAA", 108, "Los Angeles Angels", "Angels"),
    ("LAD", 119, "Los Angeles Dodgers", "Dodgers"),
    ("MIA", 146, "Miami Marlins", "Marlins"),
    ("MIL", 158, "Milwaukee Brewers", "Brewers"),
    ("MIN", 142, "Minnesota Twins", "Twins"),
    ("NYM", 121, "New York Mets", "Mets"),
    ("NYY", 147, "New York Yankees", "Yankees"),
    ("PHI", 143, "Philadelphia Phillies", "Phillies"),
    ("PIT", 134, "Pittsburgh Pirates", "Pirates"),
    ("SD", 135, "San Diego Padres", "Padres"),
    ("SEA", 136, "Seattle Mariners", "Mariners"),
    ("SF", 137, "San Francisco Giants", "Giants"),
    ("STL", 138, "St. Louis Cardinals", "Cardinals"),
    ("TB", 139, "Tampa Bay Rays", "Rays"),
    ("TEX", 140, "Texas Rangers", "Rangers"),
    ("TOR", 141, "Toronto Blue Jays", "Blue Jays"),
    ("WSH", 120, "Washington Nationals", "Nationals"),
]

PAGE_BG = "#FBF7F0"        # --c-bg in the light theme
PANEL_BG_DARK = "#1F1A15"  # --c-surface in the dark theme


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


# --- colour helpers ---------------------------------------------------------

def to_rgb(hex_str):
    h = hex_str.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def to_hex(rgb):
    return "#" + "".join("%02X" % max(0, min(255, int(round(c)))) for c in rgb)


def relative_luminance(rgb):
    def channel(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = relative_luminance(a), relative_luminance(b)
    lo, hi = sorted((la, lb))
    return (hi + 0.05) / (lo + 0.05)


def darken(rgb, amount):
    return tuple(c * (1 - amount) for c in rgb)


def lighten(rgb, amount):
    return tuple(c + (255 - c) * amount for c in rgb)


def readable_ink(primary_hex, secondary_hex, bg_hex=PAGE_BG, direction="darken"):
    """A team colour that clears 4.5:1 against the given background.

    Several clubs' primaries fail contrast on cream (Orioles orange, Marlins
    red). On the dark theme the opposite set fails -- the navies. Either way:
    try the primary, then the secondary (usually the other end of the club's
    pair, and still unmistakably theirs), and only then push the primary toward
    the readable end. Never fall back to a generic grey, which would throw the
    team identity away entirely.
    """
    bg = to_rgb(bg_hex)
    for candidate in (primary_hex, secondary_hex):
        if candidate and contrast(to_rgb(candidate), bg) >= 4.5:
            return candidate.upper()

    base = to_rgb(primary_hex)
    shift = lighten if direction == "lighten" else darken
    for step in range(1, 21):
        shade = shift(base, step * 0.05)
        if contrast(shade, bg) >= 4.5:
            return to_hex(shade)
    return "#F4EDE3" if direction == "lighten" else "#33291F"


def on_color(hex_str):
    """Text colour for a chip filled with this colour."""
    return "#FFFFFF" if contrast(to_rgb(hex_str), (255, 255, 255)) >= 4.5 else "#1A1A1A"


# --- inputs -----------------------------------------------------------------

def read_colors():
    path = ASSETS / "colors" / "team_colors.csv"
    out = {}
    # utf-8-sig: the file carries a BOM, which would otherwise glue itself to
    # the first header cell and hide the first team.
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh):
            name = (row.get("Team") or "").strip()
            if not name:
                continue
            colors = [(row.get("Color %d" % i) or "").strip().upper()
                      for i in range(1, 5)]
            out[slugify(name)] = [c for c in colors if c]
    return out


# --- build ------------------------------------------------------------------

def copy_audio():
    """Publish assets/audios/* so the app can fetch them.

    Copied rather than referenced because Vite only serves what is under
    public/. Without this step, replacing a sound in assets/ would silently
    leave the old one playing.
    """
    if not AUDIO_SRC.is_dir():
        return []
    AUDIO_OUT.mkdir(parents=True, exist_ok=True)
    copied = []
    for src in sorted(AUDIO_SRC.iterdir()):
        if src.is_file() and src.suffix.lower() in (".mp3", ".wav", ".ogg", ".m4a"):
            (AUDIO_OUT / src.name).write_bytes(src.read_bytes())
            copied.append("%s (%.1f KB)" % (src.name, src.stat().st_size / 1024))
    return copied


def main():
    colors = read_colors()

    entries, problems = {}, []

    for abbr, team_id, full_name, short_name in TEAMS:
        slug = slugify(full_name)

        palette = colors.get(slug)
        if not palette:
            problems.append("%s: no colours for '%s'" % (abbr, full_name))
            continue

        primary = palette[0]
        secondary = palette[1] if len(palette) > 1 else primary

        entries[abbr] = {
            "abbr": abbr,
            "name": short_name,
            "fullName": full_name,
            "primary": primary,
            "secondary": secondary,
            "palette": palette,
            "ink": readable_ink(primary, secondary),
            "inkDark": readable_ink(primary, secondary, PANEL_BG_DARK, "lighten"),
            "onPrimary": on_color(primary),
            "id": team_id,
            "logo": "%s/%d.svg" % (LOGO_CDN, team_id),
            "logoDark": "%s/team-cap-on-dark/%d.svg" % (LOGO_CDN, team_id),
        }

    if problems:
        print("UNMATCHED:")
        for p in problems:
            print("  " + p)
        return 1

    header = (
        "/* GENERATED FILE - do not edit by hand.\n"
        "   Run `python scripts/build_team_assets.py` after changing anything in\n"
        "   assets/. Source: assets/colors/team_colors.csv.\n\n"
        "   Keyed by the abbreviation the MLB feed sends on every game, so the UI\n"
        "   never string-matches team names.\n\n"
        "     primary/secondary  official club colours, as given\n"
        "     ink                a team colour guaranteed >=4.5:1 on the cream page\n"
        "     onPrimary          text colour for a chip filled with `primary`\n"
        "     id                 MLB team id\n"
        "     logo / logoDark    MLB's SVG mark for light / dark grounds, from its CDN\n"
        "*/\n\n"
    )
    body = json.dumps(entries, indent=2, sort_keys=True)
    JS_OUT.parent.mkdir(parents=True, exist_ok=True)
    JS_OUT.write_text(
        header
        + "export const TEAMS = " + body + ";\n\n"
        + "/** Team record for an abbreviation, or null if we do not have one. */\n"
        + "export function teamFor(abbr) {\n"
        + "  return (abbr && TEAMS[abbr.toUpperCase()]) || null;\n"
        + "}\n",
        encoding="utf-8",
    )

    audio = copy_audio()
    print("audio:  %s" % (", ".join(audio) if audio else "none"))
    print("teams:  %d/30" % len(entries))
    print("module: %s" % JS_OUT.relative_to(ROOT))

    low = [a for a, e in entries.items()
           if contrast(to_rgb(e["primary"]), to_rgb(PAGE_BG)) < 4.5]
    dark_low = [a for a, e in entries.items()
                if contrast(to_rgb(e["primary"]), to_rgb(PANEL_BG_DARK)) < 4.5]
    print("")
    print("primaries needing an adjusted ink:")
    print("  light theme: %2d  %s" % (len(low), ", ".join(sorted(low))))
    print("  dark theme:  %2d  %s" % (len(dark_low), ", ".join(sorted(dark_low))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
