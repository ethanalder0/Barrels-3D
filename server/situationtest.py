"""Offline check of projection._situations: the game as it stood around each
at-bat, which the replay HUD shows for a play picked from the list.

No network: a hand-built GUMBO-shaped half-inning and a bit, covering the cases
that are easy to get wrong -- runner movements DURING an at-bat (a double steal,
listed trail runner first), the reset at a new half-inning, strike three on the
count, and an automatic intentional walk with no pitch in it.

    python situationtest.py
"""

from projection import _situations


def pitch(balls, strikes, outs, **extra):
    return {"isPitch": True, "count": {"balls": balls, "strikes": strikes, "outs": outs}, **extra}


def runner(name, start, end, at, out=False):
    return {"movement": {"start": start, "end": end, "isOut": out},
            "details": {"runner": {"fullName": name}, "playIndex": at}}


def play(idx, half, inning, events, runners, count, score, post=None):
    matchup = {f"postOn{b}": {"fullName": n} for b, n in (post or {}).items()}
    return {
        "atBatIndex": idx,
        "about": {"halfInning": half, "inning": inning, "isComplete": True},
        "result": {"eventType": "x", "awayScore": score[0], "homeScore": score[1]},
        "count": count, "matchup": matchup,
        "playEvents": events, "runners": runners,
    }


PLAYS = {
    # Top 1. A single puts Adams on first.
    0: play(0, "top", 1, [pitch(0, 0, 0)], [runner("Adams", None, "1B", 0)],
            {"balls": 0, "strikes": 0, "outs": 0}, (0, 0), {"First": "Adams"}),
    # A walk puts Baker on; Adams to second.
    1: play(1, "top", 1, [pitch(1, 0, 0), pitch(2, 0, 0), pitch(3, 0, 0), pitch(4, 0, 0)],
            [runner("Baker", None, "1B", 3), runner("Adams", "1B", "2B", 3)],
            {"balls": 4, "strikes": 0, "outs": 0}, (0, 0), {"First": "Baker", "Second": "Adams"}),
    # Double steal on the second pitch (event 2, an action) -- trail runner
    # listed FIRST, which is the order that breaks a one-by-one apply -- then a
    # three-run homer on pitch 3.
    2: play(2, "top", 1,
            [pitch(1, 0, 0), pitch(1, 1, 0), {"type": "action", "count": {"balls": 1, "strikes": 1, "outs": 0}},
             pitch(1, 1, 0)],
            [runner("Baker", "1B", "2B", 2), runner("Adams", "2B", "3B", 2),
             runner("Adams", "3B", "score", 3), runner("Baker", "2B", "score", 3),
             runner("Cole", None, "score", 3)],
            {"balls": 1, "strikes": 1, "outs": 0}, (3, 0)),
    # Strikeout. The feed's final count is 2-3.
    3: play(3, "top", 1, [pitch(1, 0, 0), pitch(2, 0, 0), pitch(2, 1, 0), pitch(2, 2, 0), pitch(2, 3, 1)],
            [runner("Diaz", None, None, 4, out=True)],
            {"balls": 2, "strikes": 3, "outs": 1}, (3, 0)),
    # Advisory between plays: ignored.
    4: {"atBatIndex": 4, "result": {"eventType": "game_advisory"}, "about": {}},
    # Bottom 1: a fresh half -- no outs, nobody on, the score carried over.
    5: play(5, "bottom", 1, [pitch(0, 1, 0), pitch(0, 1, 0)],
            [runner("Ellis", None, "2B", 1)],
            {"balls": 0, "strikes": 1, "outs": 0}, (3, 0), {"Second": "Ellis"}),
    # Automatic intentional walk: no pitch at all.
    6: play(6, "bottom", 1, [{"type": "action", "count": {"balls": 4, "strikes": 0, "outs": 0}}],
            [runner("Ford", None, "1B", 0)],
            {"balls": 4, "strikes": 0, "outs": 0}, (3, 0), {"First": "Ford", "Second": "Ellis"}),
}

S = _situations(PLAYS)
EMPTY = {"first": None, "second": None, "third": None}


def check(label, got, want):
    assert got == want, f"{label}:\n  got  {got}\n  want {want}"
    print(f"  ok    {label}")


check("first play starts 0-0, nobody on", S[0]["before"],
      {"away": 0, "home": 0, "outs": 0, "balls": 0, "strikes": 0, "bases": EMPTY})
check("a play starts where the last one ended", S[1]["before"]["bases"],
      {"first": "Adams", "second": None, "third": None})
check("the count before ball four is 3-0", (S[1]["before"]["balls"], S[1]["before"]["strikes"]), (3, 0))
check("a double steal during the at-bat is on the bases before the homer", S[2]["before"],
      {"away": 0, "home": 0, "outs": 0, "balls": 1, "strikes": 1,
       "bases": {"first": None, "second": "Baker", "third": "Adams"}})
check("after the homer: three runs in, bases empty", S[2]["after"],
      {"away": 3, "home": 0, "outs": 0, "balls": 1, "strikes": 1, "bases": EMPTY})
check("strike three reads 2-2 with the out up, not 2-3",
      (S[3]["after"]["balls"], S[3]["after"]["strikes"], S[3]["after"]["outs"]), (2, 2, 1))
check("advisories are skipped", 4 in S, False)
check("a new half-inning starts with no outs and nobody on", S[5]["before"],
      {"away": 3, "home": 0, "outs": 0, "balls": 0, "strikes": 1, "bases": EMPTY})
check("an intentional walk with no pitch starts as the at-bat began", S[6]["before"],
      {"away": 3, "home": 0, "outs": 0, "balls": 0, "strikes": 0,
       "bases": {"first": None, "second": "Ellis", "third": None}})
check("and ends with the batter on first", S[6]["after"]["bases"],
      {"first": "Ford", "second": "Ellis", "third": None})

print("\nall checks passed")
