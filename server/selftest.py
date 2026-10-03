"""Offline logic check for game_state.extract_new_events.

No network: runs a hand-built GUMBO-shaped feed through the extractor and
asserts the pitch/result emits and the change-detection sets behave. Doubles
as documentation of the feed shape we depend on.

    python selftest.py
"""

import copy
import json

import game_state

FEED = {
    "gameData": {"status": {"abstractGameState": "Live", "detailedState": "In Progress"}},
    "liveData": {
        "linescore": {
            "currentInning": 3, "inningState": "Top",
            "teams": {"away": {"runs": 2}, "home": {"runs": 1}},
            "offense": {"first": {"fullName": "Jose Ramirez"}, "second": None, "third": None},
        },
        "plays": {
            "allPlays": [{
                "atBatIndex": 0,
                "about": {"halfInning": "top", "inning": 3, "isComplete": True},
                "count": {"balls": 1, "strikes": 3, "outs": 1},
                "matchup": {"batter": {"fullName": "Steven Kwan"},
                            "pitcher": {"fullName": "Tarik Skubal"}},
                "result": {"event": "Strikeout",
                           "description": "Steven Kwan strikes out swinging.", "rbi": 0},
                "playEvents": [
                    {"index": 0, "isPitch": True, "count": {"balls": 0, "strikes": 1, "outs": 1},
                     "details": {"description": "Called Strike",
                                 "call": {"description": "Called Strike"},
                                 "type": {"code": "FF", "description": "Four-Seam Fastball"}},
                     "pitchData": {"startSpeed": 97.1}},
                    {"index": 1, "isPitch": True, "count": {"balls": 0, "strikes": 2, "outs": 1},
                     "details": {"description": "Swinging Strike",
                                 "call": {"description": "Swinging Strike"},
                                 "type": {"code": "SL", "description": "Slider"}},
                     "pitchData": {"startSpeed": 88.4}},
                    # non-pitch action -> marked seen, never emitted
                    {"index": 2, "isPitch": False, "type": "action",
                     "details": {"description": "Mound Visit"}},
                    {"index": 3, "isPitch": True, "count": {"balls": 1, "strikes": 3, "outs": 1},
                     "details": {"description": "Swinging Strike",
                                 "call": {"description": "Swinging Strike"},
                                 "type": {"code": "SL", "description": "Slider"}},
                     "pitchData": {"startSpeed": 89.0}},
                ],
            }],
            "currentPlay": {
                "atBatIndex": 1,
                "about": {"halfInning": "top", "inning": 3, "isComplete": False},
                "count": {"balls": 0, "strikes": 0, "outs": 1},
                "matchup": {"batter": {"fullName": "Jose Ramirez"},
                            "pitcher": {"fullName": "Tarik Skubal"}},
                "result": {},
                "playEvents": [
                    {"index": 0, "isPitch": True, "count": {"balls": 0, "strikes": 0, "outs": 1},
                     "details": {"description": "In play, run(s)",
                                 "call": {"description": "In play, run(s)"},
                                 "type": {"code": "FF", "description": "Four-Seam Fastball"}},
                     "pitchData": {"startSpeed": 96.5},
                     "hitData": {"launchSpeed": 104.2, "launchAngle": 24.0,
                                 "totalDistance": 402, "trajectory": "fly_ball",
                                 "coordinates": {"coordX": 126.5, "coordY": 92.3}}},
                ],
            },
        },
    },
}


def kinds(events):
    return [e["type"] for e in events]


seen_e, seen_r = set(), set()

# --- poll 1: fresh feed -----------------------------------------------------
evs = game_state.extract_new_events(FEED, 745804, seen_e, seen_r)
print("poll 1 emitted:")
for e in evs:
    print("  ", json.dumps(e, ensure_ascii=False))

pitches = [e for e in evs if e["type"] == "pitch"]
results = [e for e in evs if e["type"] == "play_result"]
assert len(pitches) == 4, f"expected 4 pitches (3 K + 1 in-play), got {len(pitches)}"
assert len(results) == 1, f"expected 1 result, got {len(results)}"
assert results[0]["event"] == "Strikeout"
# the in-play pitch must carry hit data; the others must not
inplay = [p for p in pitches if p["hit"]]
assert len(inplay) == 1 and inplay[0]["hit"]["launch_speed"] == 104.2
assert inplay[0]["hit"]["coordinates"] == {"x": 126.5, "y": 92.3}
# action event (index 2) was marked seen but not emitted
assert (0, 2) in seen_e

# --- poll 2: identical feed -> nothing new ----------------------------------
evs2 = game_state.extract_new_events(FEED, 745804, seen_e, seen_r)
assert evs2 == [], f"expected no new events on identical poll, got {kinds(evs2)}"
print("\npoll 2 emitted: (nothing) OK")

# --- poll 3: a new pitch lands on the current at-bat ------------------------
feed3 = copy.deepcopy(FEED)
feed3["liveData"]["plays"]["currentPlay"]["playEvents"].append(
    {"index": 1, "isPitch": True, "count": {"balls": 0, "strikes": 1, "outs": 1},
     "details": {"description": "Called Strike", "call": {"description": "Called Strike"},
                 "type": {"code": "CU", "description": "Curveball"}},
     "pitchData": {"startSpeed": 82.3}}
)
evs3 = game_state.extract_new_events(feed3, 745804, seen_e, seen_r)
assert kinds(evs3) == ["pitch"], f"expected one new pitch, got {kinds(evs3)}"
assert evs3[0]["pitch"]["type"] == "Curveball"
print("poll 3 emitted:", kinds(evs3), "OK")

# --- poll 4: the current at-bat completes -----------------------------------
feed4 = copy.deepcopy(feed3)
cur = feed4["liveData"]["plays"]["currentPlay"]
cur["about"]["isComplete"] = True
cur["result"] = {"event": "Home Run",
                 "description": "Jose Ramirez homers (12) to right field.", "rbi": 1}
evs4 = game_state.extract_new_events(feed4, 745804, seen_e, seen_r)
assert kinds(evs4) == ["play_result"], f"expected one result, got {kinds(evs4)}"
assert evs4[0]["event"] == "Home Run" and evs4[0]["rbi"] == 1
print("poll 4 emitted:", kinds(evs4), "OK")

print("\nAll assertions passed.")
