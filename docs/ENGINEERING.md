# Barrels 3D — engineering notes

The long-form design record: how each part works, why it is built the way it
is, and the traps hit along the way. For what the project is and how to run
it, see the [README](../README.md).

## Using the app

### Browsing other days

The **Games** screen has a date picker — arrows for a day either way, a date
field, and a Today button. Pick any past date and the scoreboard, the box score,
the at-bat list and the 3D replay all follow it. Going forward past today is
disabled: it could only ever show an empty board.

A finished game is fetched **once over REST** rather than streamed. The backend
stops polling a game the moment it goes Final, so a subscription would be an
open connection waiting on events that can never arrive; one snapshot carries
the whole game's at-bats, which is all the replay engine wants from a game that
is already over. An explicit `?gamePk` still streams, because that is how replay
mode re-runs a completed game as though it were live.

Changing the day clears the selected game. It belonged to the old date, and
keeping it would leave the scorebug showing one game while the list shows
another day's.

### Watching a game when nothing is live

Replay mode re-runs a completed game from its recorded GUMBO snapshots as though
it were happening now — the same pitch-by-pitch stream a live game produces:

```
http://localhost:5173/?replay=1&speed=12&gamePk=822940&date=2026-08-16
```

| param | meaning |
|-------|---------|
| `replay=1` | walk a finished game's timecodes instead of polling for the latest state |
| `speed=N` | timecodes consumed per tick — 12 replays a full game in a couple of minutes |
| `gamePk=N` | stream this game specifically, even from another date |
| `date=YYYY-MM-DD` | which day's scoreboard to browse |

## Architecture

```
browser  ──/api/stream/<gamePk>──▶  app.py  ──▶  feed_hub  ──▶  mlb_api ──▶ statsapi.mlb.com
   ▲            (SSE)                                │
   │                                                 ├─ game_state.py  → "what just happened"
   └──── snapshot / play / status events ────────────┴─ projection.py  → "what is true now"
```

One poller per game, shared by every subscriber. Each tick emits both a full
snapshot and the individual new events, because the UI needs both: panels render
state, the pitch feed renders the event stream.

### Backend (`server/`)

| file | role |
|------|------|
| `app.py` | HTTP + SSE endpoints (stdlib only) |
| `feed_hub.py` | one poll loop per game, subscriber fan-out, adaptive interval, replay mode |
| `projection.py` | GUMBO → the view models the frontend renders |
| `leaders.py` | advanced-stat league leaders (WAR, wRC+, wOBA, FIP, ERA-) |
| `statcast.py` | Baseball Savant season leaderboards (xBA, xERA, sprint speed, OAA, arsenal) |
| `ratings.py` | percentile ability ratings for the player card |
| `mlb_api.py` | HTTP client (schedule, feed/live, timestamps) |
| `game_state.py` | pitch/at-bat change detection — from the live_score prototype, unchanged |
| `formatter.py` | terminal view of events — from the prototype, unchanged |
| `selftest.py` | offline check of the extractor (no network) |
| `ratingstest.py` | offline check of the percentile engine (no network) |
| `situationtest.py` | offline check of the game state around each at-bat, for picked replays (no network) |
| `smoketest.py` | live check of the projection, the engine payload, and feed lifecycle |

`game_state.py`, `formatter.py` and `selftest.py` came from the `live_score`
prototype as-is. `mlb_api.py` gained schedule hydration and timecode support.
Everything else is new.

Polling is state-aware: 8s while a game is live, 45s before first pitch, and it
stops once a game is Final.

#### Endpoints

```
GET /api/health
GET /api/games?date=YYYY-MM-DD     scoreboard
GET /api/leaders?season=YYYY       advanced-stat league leaders
    &per=50                        names per category (default 5, max 50)
GET /api/player/<personId>         one player card: bio, season line,
                                   ability ratings, season Statcast, arsenal
GET /api/game/<gamePk>             one snapshot, no streaming
GET /api/stream/<gamePk>           SSE: snapshot / play / status
    ?replay=1&speed=6
```

SSE rather than WebSockets: data flows one way, `EventSource` reconnects on its
own, and it adds no dependency on either end.

### Frontend (`src/`)

```
main.jsx                   root + providers
App.jsx                    auth gate and screen switch
state/
  AppState.jsx             UI state (screen, auth, selection, settings)
  LiveDataProvider.jsx     the backend connection; falls back to stubs
  connectionLabel.js       feed state → header chip
data/
  liveClient.js            REST + EventSource client
  headshots.js             player id → MLB headshot URL
  stubs.js                 placeholder data / offline fallback
screens/
  SplashScreen.jsx         splash → swing animation → login card
  HomeScreen.jsx           landing page: intro, today's slate, league leaders
  LiveGameScreen.jsx       scorebug + viewport + box score + rail
  GameListScreen.jsx       game picker
  LeaderboardScreen.jsx    one leaderboard, fifty deep
  SettingsScreen.jsx       preferences
components/
  Scorebug.jsx             line score, count, outs, real base runners
  ReplayViewport.jsx       ← the engine mount point and its contract
  StrikeZone.jsx           2D pitch-location plot for the selected at-bat
  AtBatList.jsx            at-bat feed, follows the live at-bat
  PitchFeed.jsx            the raw event stream (formatter.py, on screen)
  PlayerCard.jsx           the flippable card, in a modal over the game
  PlayerCardFront.jsx      portrait, overall, four ability ratings
  PlayerCardBack.jsx       bio, season line, Statcast, pitch arsenal
  PlayerHeadshot.jsx       MLB headshot from a player id, with fallback
  PlayerName.jsx           any player name → their card
  CardEdges.jsx            the stamp's perforated edge and inner frame
  BoxScore.jsx  AppHeader.jsx  Icons.jsx
styles/
  tokens.css               every colour, space, radius, duration
  fonts.css                self-hosted card typefaces
  base.css  splash.css  app.css
```

Two providers, deliberately separate: `AppState` is what the user is looking at,
`LiveDataProvider` is what the feed says. The backend's projection emits the same
field names as `stubs.js`, so live and placeholder data render through identical
components rather than two code paths.

## The replay engine

```
replay/
  index.js                 watches for the mount, attaches, follows app events
  engine.js                renderer, camera, loop, quality tiers
  field/
    spec.js                every field dimension, in feet — one source
    layout.js              the playing surface, painted top-down on a canvas
    field.js               ground, mound, plate, bases, walls, lighting
  strikezone.js            the zone box, the batter's fixed ABS zone
  play.js                  pitch + batted ball composed onto one clock
  follow.js                following live: which new pitches to play, and when
  interlude.js             between innings, or over? from the game's own state
  follow.selftest.js       offline check of both (npm run selftest:follow)
  pitch/
    trajectory.js          the pitch fit — release assumed, plate crossing exact
  ball/
    trajectory.js          the flight solver — drag, lift, bounce, roll
    fromAtBat.js           at-bat payload -> solver parameters
    ball.js                the ball mesh, its trail and landing marker
    fixtures.js            live-shaped at-bats, for the lab and the selftest
    selftest.js            offline check of the above (npm run selftest)
```

Loaded from `main.jsx` with a dynamic `import()`, so Three.js gets its own chunk
and never lands in the main bundle — the splash, home and leaderboard screens
have no use for it.

**Units are feet, everywhere.** Home plate's back point is the origin, `+Y` is
up, `-Z` is center field, `+X` is the first-base side. That puts a camera behind
home looking down its own `-Z` (the broadcast shot) and makes MLB's hit grid a
direct conversion. The full statement is at the top of `field/spec.js`, and no
dimension is written anywhere else.

### Why the surface is painted, not modelled

Grass, dirt, chalk and the warning track are not separate objects on a real
field — they are one graded plane with different material on top. Modelled as
overlapping coplanar meshes they bring z-fighting on every boundary, seams where
two arcs tessellate differently, and a CSG problem at the base cutouts. Painted
top-down in real feet they are just fills in the right order, and every boundary
is exact by construction:

```
beyond → grass + mow → warning track → infield skin → infield grass
       → base paths → home circle → mound circle → on-deck → chalk → noise
```

The one thing that is genuinely not flat is the mound, and that is real geometry
driven by `spec.moundHeight()`. Rule 2.01 gives the front of a mound as 1 inch
per foot starting 6 inches ahead of the rubber; extended at that grade it hits
field level at exactly 10 feet, which is precisely the front rim of the 18-foot
circle. So the front of a mound is a single 1:12 plane — not an approximation.

Two consequences of the layout worth knowing before changing it, because both
look like bugs and are not: the geometric center of the mound circle sits **9**
inches high, not 10, because the level table starts a foot behind it; and the
infield grass is the 90-foot square inset by 3 feet, with no corner at home,
because the 26-foot home circle eats it.

### Players

The batter and the pitcher are in. One character, one 65-bone `mixamorig`
skeleton, seven clips, all in `public/models/player.glb` (4.0 MB with the cloth) — built from the
Mixamo FBX files in `assets/animations/` by the Blender session saved
alongside them as `player_build.blend`. The FBX files are not in the public
repository, because Adobe's terms don't allow sharing raw Mixamo downloads.
The blend already contains everything they contributed, so you only need them
to rebuild the character from scratch.

All five exports contained the **same character**: identical 14,232-vertex body,
identical 10,514-vertex joint shells, identical rig. Only the clip differed. So
the model is taken from one of them and the other four contribute nothing but
their action, which is what turns 10.4 MB of duplicated FBX into one mesh and
six animations.

| clip | frames @30fps | measured moment |
|------|---------------|-----------------|
| `batter_idle` | 46 | — (loops) |
| `batter_hit` | 60 | contact at 1.000 s |
| `batter_homerun` | 118 | contact at 1.467 s |
| `batter_swing_miss` | 209 | contact at 1.300 s |
| `pitcher_pitch` | 119 | release at 1.633 s |
| `pitcher_idle` | 61 | — (derived, loops) |
| `batter_hit_lefty` | 40 | contact at 1.073 s (as `batter_hit`) |

**`batter_hit_lefty` is `batter_hit` stopped before the run** (`lefty_hit.fbx`,
identical to `batter_hit` through all 40 of its frames). `batter_hit` ends in the
first strides toward first base, and a left-hander is a *mirrored* right-hander —
so mirrored, those strides went up the third-base line. Left-handed hits and
every foul (nobody runs on a foul) play this one instead; the batter finishes in
his follow-through, in his own box. It was added to the blend as its own NLA
track and re-exported; the rest of the GLB came out identical — same nodes,
materials, mesh data, skin and six existing clips. The blend has a stray `Cube`
in it that is not part of the character — leave it out of the export.

**There was no pitcher idle and none was downloaded.** A pitcher at the set is
nearly motionless, and the first frame of the windup *is* the set, so the idle
is built from that pose with a 2-second breathing loop keyed over it. Deriving
it rather than fetching one guarantees the stance matches the windup's first
frame, so idle → pitch cannot pop; a downloaded idle would land in a different
stance and snap on every pitch.

#### The swing has to land on the ball

Everything on the play's clock is an absolute time — release at
`path.releaseTime`, contact at `path.contactTime` — so each clip is **pinned by
its own moment** and otherwise plays at its own rate:

```
clipTime = moment + (playhead - theInstantThatMomentIs)
```

The pitching clip is pinned at release, the swing at contact. Nothing is
stretched, because the play's clock now gives both ends room (see **The play is
longer than the ball** below). Until a swing's clip time reaches zero the batter
is in his idle stance — a hitter cannot hold the first frame of a swing for a
second and a half — and from there the swing runs at its own speed, which puts
his load in the wind-up where a hitter's load actually is.

They still slow down **together**, because the rate is a property of the clock
and not of any one of them: a pitch in slow motion is a swing in slow motion,
which is what makes the two read as one event.

Both players are driven by **seeking on absolute time**, never by advancing a
mixer, for the same reason the ball is: the pitch runs in slow motion and the
transport can be scrubbed, and anything integrating its own `dt` drifts out of
the play within a pitch.

##### Measuring contact off the bat, not the hands

The first measurement of these moments took the **peak speed of the right
hand**, which is wrong for a swing and right for a pitch. A ball is released at
the top of the hand's speed, so the pitch was fine. A bat is not: the hands peak
*after* contact — the barrel is still accelerating through the ball while they
begin to slow — so taking the hands put `batter_hit` 73 ms early, and on screen
that is the ball leaving before the bat arrives. It was visible as a lag.

With the bat as real geometry it can be measured properly. Each swing is stepped
at 240 Hz and the moment taken where the **sweet spot** — six inches in from the
end of the barrel — passes closest to the plate. Nearest in three dimensions and
nearest in plan agree to within 4 ms, which is one frame at 240 Hz:

| clip | contact | sweet spot passes | was (hand speed) |
|------|---------|-------------------|------------------|
| `batter_hit` | 1.073 s | 0.34 ft from the plate | 1.000 s |
| `batter_homerun` | 1.412 s | 0.07 ft | 1.467 s |
| `batter_swing_miss` | 1.179 s | 0.12 ft | 1.300 s |
| `pitcher_pitch` | 1.633 s | (peak hand speed = release) | 1.633 s |

Re-measure if a clip is replaced.

#### The play is longer than the ball

A pitch is 0.4 s of ball. A **play** is longer than that at both ends, and those
two ends are the difference between watching a pitcher pitch and watching a ball
appear: the wind-up and the leg kick happen before the release, and the
follow-through happens after the ball has stopped mattering.

So `t = 0` on the play's clock is the first frame of the wind-up, not the
release. `play.js` shifts the ball's samples, the crossing, contact and hang
onto that clock together — one shift, in one place, because a camera cutting on
contact while the ball flies on an unshifted clock is a whole wind-up out of
step. Both ends are knobs in `replay/tuning.js`:

| knob | default | why |
|------|---------|-----|
| `WINDUP_LEAD_IN` | 1.633 s | the pitching clip's own time from first frame to release; less starts the wind-up part-way through |
| `FINISH_TAIL` | 2 s | without it the picture freezes the instant the ball lands, halfway through a follow-through |

**The wind-up is not slowed.** Pitch slow motion exists because the break
happens in the last third of the flight and is otherwise unreadable; a leg kick
has no such problem, and at 0.7x it looks like an injury. So the clock runs at
life speed until the ball is released and the slow motion starts with the pitch.

That makes play time to wall time an integral rather than a division, which
matters in exactly one place: the crack of the bat is scheduled ahead on the
audio clock, so `wallSecondsBetween()` integrates the rate curve instead of
dividing by it. Getting that wrong would put the sound a whole wind-up early.
Measured against the running engine: 1.633 s of wind-up at life speed plus
0.399 s of pitch at 0.7x is a **2.203 s** cue, which is what the engine cues.

The ball is hidden until release. Before it, the ball would hang in mid-air at
the release point for the whole wind-up, which is worse than nothing — the
pitcher has it, and his hand is where you are looking.

#### Following live plays new pitches, once each

Following a live game used to mean "play whatever the newest at-bat is", and
that was the wrong unit. The newest at-bat is re-sent on every poll and changes
as you watch — a pitch lands, then its result fills in, then the next batter
steps in with no pitch at all. Played as a stream of at-bats, opening a live game
replayed the last play, then the middle of the current at-bat, then (from a
jammed queue and a park change that restarted the play) repeats of pitches
already shown.

Now the unit is the **pitch**, and `replay/follow.js` decides what plays:

* **Opening the viewer plays nothing.** Everything already in the feed is taken
  as a baseline. The current batter is shown standing in (`barrels:stage`) and
  the HUD card says it is waiting for the next pitch. The first thing that plays
  is the first pitch thrown after you arrived. This holds every time the viewer
  opens, and opening the game screen always turns Follow live back on.
* **Each new pitch plays exactly once**, as the at-bat cut off at that pitch —
  so pitch two of a seven-pitch at-bat shows pitch two, not how the at-bat
  ended. Re-sends of the same pitch with more detail never replay it.
* **Only once its data is all there.** A ball in play waits for the at-bat to
  close (the trap in `isAwaitingDetail`); any other pitch waits for its plate
  location. A pitch that never gets tracked is skipped as soon as a later one
  is ready, so it cannot hold up the game.
* **Pitches that land in one poll play in order**, across a change of batter.

A hand-picked play is unchanged: it plays at once. Every at-bat the engine is
handed carries an `eventId`, echoed back on its moments, so the HUD always
describes the play actually on screen.

#### The HUD does not get ahead of the picture

The feed knows how a pitch ended the moment it is in; the picture does not
until the ball has been thrown. So while following, as soon as the feed has a
pitch the picture has not shown, the HUD's score, inning, count, outs, runners
and matchup are **held** at how they stood before it. Each play moves them on
when it reaches its result on screen, and they go back to live once nothing is
playing, queued or waiting on data. A run goes on the board when it crosses,
not when the feed hears about it.

The play card waits the same way. Nothing at all is shown while a ball in play
is waiting on its detail; exit velocity and launch appear at contact, distance
and the result when it lands. The umpire's call on a ball in play reads only
"In play" until then — "In play, run(s)" is the result in disguise. Batted-ball
numbers are only ever shown for the pitch that was put in play: mid at-bat the
at-bat's hit data can belong to an earlier foul.

The rest of the page — the scorebug above the replay, the box score, the play
list — is still live and can run ahead of the replay.

**A play picked from the list shows the game as it stood then.** An old play
under a HUD reading "Final" tells you nothing, so every at-bat carries a
`situation` built by `_situations()` in `projection.py`. It holds two
snapshots of score, outs, count and runners. `before` is the moment before the
replayed (final) pitch, and `after` is once the play is over. The HUD shows
`before` while the pitch is on its way and switches to `after` when the play
reaches its result, the same rule as following live. Scrubbing back past the
landing returns to `before`. The matchup strip names that at-bat's batter and
pitcher, and on deck is whoever actually batted next for that side.

GUMBO records how each play *ended*: `result.awayScore`/`homeScore`, `count`,
`matchup.postOnFirst/Second/Third`. It says nothing direct about how a play
began. So `before` is built by carrying the previous play's end state forward
(reset to no outs and empty bases at each new half-inning), then applying any
runner movements that happened during this at-bat before its last pitch.
Those are the `runners[]` entries whose `playIndex` comes before it: a stolen
base, a wild pitch, a pickoff. Chase Meidroth's home run on 2026-09-30 came
straight after a double steal, and it shows runners on second and third, not
first and second.

Three details that each broke a first attempt:

* **A double steal lists its runners in no fixed order.** Applied one at a
  time, 1B→2B followed by 2B→3B clears the runner who just arrived. Every
  starting base in an event is cleared before any ending base is filled.
* **The feed's count after strike three is "2-3", and after ball four "4-1".**
  `after` caps it at 3 balls and 2 strikes, because a scorebug shows the out
  going up, not a third strike.
* **An automatic intentional walk has no pitch.** Nothing is replayed, so
  `before` is the at-bat's starting state rather than one with the batter
  already on first.

`server/situationtest.py` checks all of it offline. It was also checked
against three complete games: every final score matches the line score, and
each play starts exactly where the previous one ended unless something
happened during the at-bat.

#### Before the game, between innings, and when it is over

**Before the first pitch** — a scheduled game, and one that is Live in the feed
for its warm-up or a delayed start — the screen shows the two clubs and their
records ("@" where the score will go) and "First pitch at 8:00 PM", "Warming up"
or "Delayed start". A 0-0 record is left off: it is what the postseason resets
every club to, and it says nothing. It comes down when the first pitch plays,
the same way a break does. A **postponed or cancelled** game gets its own screen
rather than the "Final, 0-0" the feed files it as. With nobody named yet, the
batter's box is empty rather than holding the model's un-uniformed placeholder.

Between half innings a live game is two minutes of nothing, and a replay sitting
on an empty zone that long looks frozen. So, while following, the replay puts up
a screen over the dimmed scene in place of the HUD: the score, "Middle of the
5th", and "Waiting for the bottom of the 5th to begin" (or "…for the 6th inning
to begin" after a bottom half), with a spinning ball so it reads as a live wait.
When the game is over, a separate screen shows "Final" (or "Final/11"), the
score with the winner lit, and the R/H/E line.

What the feed does, measured from a real game and pinned down in
`replay/interlude.js` and its tests:

| moment | `inningState` | `outs` |
|--------|---------------|--------|
| third out of a top half | `Middle` — in the same update as the out | 3 |
| third out of a bottom half | `End` | 3 |
| ~2 minutes later, next batter steps in | `Top` / `Bottom` | 0 |
| the game's last out | `Middle` / `End` for ~30 s, **then** status `Final` | 3 |

The backend now passes `inningState` and `scheduledInnings` through on
`game.state`. The last row is why "over" is also worked out from the rules — top
of the 9th or later over with the home side ahead, a completed inning past the
9th that is not tied, or a walk-off — rather than waiting on the status: without
it the last out of a game said "waiting for the bottom of the 9th".

The timing rules:

* **The screen goes up only once the picture has caught up** — the pitch that
  made the third out has been played, nothing is queued or waiting on data, and
  the HUD is live again. Never over the out itself.
* **A break stays up until the next pitch actually plays**, not until the feed
  says the next half has started: the next batter's at-bat appears a minute
  before he sees a pitch. That pitch goes to an idle engine and plays the moment
  its data is complete; anything behind it queues as usual.
* Opening the viewer during a break, or on a finished game, shows the screen
  straight away. Picking a play by hand replaces it; Follow live brings it back.

#### Plays queue; they do not interrupt each other

Plays arrive on the feed's schedule and are watched on their own. A live game
polls every few seconds and a play now takes longer than that to run, so a
second pitch lands while the first is still in the air. Loading it there and
then cut the play off mid-swing, which is what made a live game look like a
slideshow of half-pitches.

So arrivals **queue**, and each play runs to its end — wind-up, pitch, swing,
follow-through, the hold on the result — before the next one starts.

Two things keep the queue honest:

* **It only queues while the app is following live.** Following, plays are
  coming off the feed by themselves. Not following, the viewer has picked a play
  out of the list and means *now*, so it replaces what is on screen and the
  queue is dropped. The app says which mode it is in with a `barrels:follow`
  event, sent before the at-bat it goes with.
* **The same play arriving twice replaces its own queue entry.** A picked play
  is re-sent as it changes, and the newer copy may carry more detail.
* **A play with nothing to show does not stall it.** An at-bat with no pitch in
  it starts, finds nothing, and hands straight on to the next one. It used to
  stop the queue dead, and the plays stranded behind it ran later, out of order.

The cap is four. If the animation ever falls behind the game by more than that,
the right thing is to skip to what is happening *now* rather than work through a
backlog of pitches that are already history — this is a live companion, and the
oldest waiting play is the one worth losing.

#### The batter leaves when his plate appearance does

A play ends, the screen holds on the result, and then it cuts back to the empty
strike zone waiting for the next pitch. If the plate appearance is over, the man
who was in the box has struck out or is standing on first — leaving him there is
the one thing that reads as a bug rather than as a replay, because the feed has
already said he is gone.

The feed says it directly, so nothing is inferred: an at-bat in progress carries
`kind: 'live'` and no outcome, and the moment it is over it carries what
happened instead. A strikeout, a walk and a double all take the batter off; the
fourth pitch of a seven-pitch at-bat leaves him standing there. The next play
puts whoever is up now back in the box.

#### Every swing swings: fouls, foul tips, swinging strikes

The swing is chosen from **the pitch being shown**, not from how the at-bat
ended (`swingOf()` in `play.js`, from the pitch's `outcome`). Keying it on the
result is what left the batter standing in his stance for every foul and every
swinging strike before strike three — mid at-bat the result is just "At bat".

| pitch | batter | ball | camera |
|-------|--------|------|--------|
| in play | contact swing (home-run swing if it left) | the tracked flight | follows it |
| foul | contact swing, no run | fouled back over the umpire | **holds on the zone** |
| foul tip, swinging strike | swing and miss | on past the plate, then gone | holds |
| ball, called strike, HBP | no swing | on past the plate, then gone | holds |

There is no catcher, so a pitch not put in play would otherwise come to rest in
mid-air where the mitt should be and hang there, spinning, through the
follow-through and the hold on the result. It vanishes there instead
(`vanishTime` in `play.js`); a foul vanishes at the backstop. The trail stays, so
the break can still be read. A ball in play stays on the field, and stops spinning
when it stops moving.

A foul has no flight in the feed worth rebuilding, so `ball/foul.js` flies a
generic one on the same physics as every other ball: 62–82 mph, 0–5° either side
of straight back, stopped at the backstop. The launch angle is **solved, not
drawn**: picture a 6 ft umpire standing straight up 4.5 ft behind the plate, and
the ball goes back 3–11 inches over his head. The variation is
seeded from the at-bat id and pitch number, so the same foul replays the same
way. Contact sounds take their foul tier (`contactVariantFor({ isFoul })`).

A foul tip is scored as a swinging strike and plays as one — the bat barely
touched it and the catcher held it.

Only a batted ball the **shown pitch** put in play is flown. Mid at-bat the
payload's `hit` is the latest event with hit data, which can be an earlier
tracked foul; before this a called strike after one replayed as a ball flying
into the outfield. A payload with no pitch outcome at all (the offline stubs)
keeps the old rule, including "a strikeout is a swinging one".

#### The bat

A bat is a solid of revolution, so it is **turned from a profile** in
`replay/player/bat.js` rather than shipped as an asset — the same reasoning that
makes the mound real geometry and the playing surface painted. The dimensions
are the description, and a lathe reproduces them exactly where a modelled bat
would be somebody's recollection of one.

Defaults are an ordinary big-league bat: 34 in long, 2.5 in barrel, 0.94 in
handle. The rulebook's ceilings are 42 in and 2.61 in and nobody swings them.
The profile, the wood colour and the grip are all constants at the top of the
file.

**It is parented to the top hand's bone**, so it follows the swing with no
per-frame work at all — and because it hangs inside the model, a left-hander's
mirrored scale mirrors the bat along with him for free.

The grip was **measured, not guessed** — twice, because the first measurement
was of the wrong thing. Both halves of it live in the top hand's own local
space, where they are constants rather than curves.

**Which way it points** is the *knuckle row*, not the line between the wrists.
A wrist bone sits at the base of the hand while the bat runs through the
fingers, so the wrist line is about 70 degrees off and the bat sat across the
forearms. With a fist closed round a shaft the four metacarpal heads lie along
it, and the two fists' knuckle rows come out parallel to within **1.3 degrees**
in every clip at every frame sampled — which is what you get when both hands
hold one straight object.

**Where it crosses the hand** was fitted rather than eyeballed: all 32 finger
joints of both hands projected onto the plane across that axis, and a
least-squares circle taken through them. The centre lands **2.5 in into the
hand** from the wrist and moves by less than a third of an inch across a swing.

Projected onto the axis, the top fist then spans -1.2 to +2.5 in about that seat
and the bottom fist -4.5 to -1.1 in: adjacent and not overlapping, which is a
proper two-handed grip, and the knob goes just past the bottom of the lower
fist. Checked against the running engine: 34.0 in end to end with the knob
0.2-0.7 in below the lowest joint of the bottom hand.

Bone space carries Mixamo's centimetres — one bone-local unit is 0.0328 ft — so
the bat is built in feet at true size and divided by the bone's own world scale,
read off the matrix rather than assumed, so rescaling the character cannot
silently resize the bat.

#### Moving a player: `replay/player/stance.js`

Every position and angle a player has lives in that one file, in **degrees and
feet**, with nothing else holding a copy. It is meant to be edited:

| knob | what it does |
|------|--------------|
| `BATTER.distanceFromPlate` | ft from the middle of the plate; larger = further off |
| `BATTER.depth` | fore/aft in the box; negative is toward the pitcher |
| `BATTER.facingRight` / `facingLeft` | degrees; open or close the stance |
| `PITCHER.alongRubber` | ft along the rubber from its middle |
| `PITCHER.depthOffset` | ft from the rubber; negative is toward second |
| `PITCHER.facing` | degrees |

`facing` is a rotation about Y and the models face **+Z** unrotated, which
points from centre field back toward home:

```
   0   toward home plate    (+Z)      90   toward first base  (+X)
 180   toward centre field  (-Z)     -90   toward third base  (-X)
```

So the pitcher is 0 — out at z = -60, looking in. A batter is side-on rather
than facing the pitcher, so a right-hander (third-base side, -X) is +90.

#### Left-handers are mirrored, their numbers are not

Every batting clip is a right-handed swing. Rotating one 180 degrees puts the
batter in the correct box but has him swinging **away** from the plate, because
rotation preserves handedness and a swing direction *is* handedness. So a
left-hander is drawn as a true mirror: `mirror: true` negates the model's X
scale.

The reflection is applied to the MODEL, inside the root's rotation. The
transform chain is translate x rotate x scale, and reflecting after the rotation
is the same as reflecting the finished right-hander across the plate's centre
line. Reflecting the root instead would mirror his position too and put him back
in the box he came from.

Three.js handles the rest of a negative scale on its own — it flips the winding
order at draw time and the normal matrix is an inverse transpose, so culling and
lighting stay correct.

**The number is the one thing a mirror gets wrong**, so `paintNumberPanel()`
takes a `mirrored` flag and draws the digits **backwards**; the model's own
mirror then turns them the right way round. Flipped twice is forwards. Verified
by comparing the two panels pixel for pixel: the mirrored one is an exact
horizontal flip of the normal one, 0 pixels differing.

Lefty pitchers get the same treatment from `PITCHER.mirrorLefties`. Set either
`mirrorLefties` to `false` if genuinely left-handed clips are ever supplied — the
stance then becomes a plain rotation and the number needs no pre-flip.

#### Uniforms are materials, not textures

The kit comes from `teams.js` — `primary`, `secondary` and `ink` — with home in
white, away in grey, and the club's colour on the cap, sleeves and socks, which
is both accurate and the only thing that reads at the distances this engine
uses.

It is painted as **one material per region** (11 of them, assigned per face in
Blender off the bone weights that drive that face) rather than as a texture, and
that is not a stylistic choice. **This character's UV atlas is stacked.**
Measured on the exported mesh: the hand islands alone cover 92% of the atlas and
collide with every other region at 93–100%, and even the jersey and the trousers
share 42% of their texels — solo coverages sum to 181% of the available space.
Two regions sharing a texel cannot be given two colours, so a per-texel kit was
never possible here. A material needs no UVs at all, which makes the question
moot.

A first attempt did bake a per-texel region mask, and it failed twice in ways
worth recording: Blender's image save runs the buffer through colour management,
which turns an id of `1/255` into `0` (the PNG came back 100% zeros, so the mask
had to be written byte-by-byte by hand), and even once the ids survived, the
stacked atlas meant `hand` claimed 73% of the texels and painted over the torso.

**The number** is the one thing that genuinely needs a texture, and therefore the
one thing that needed usable UVs. The back-of-jersey faces get their own
projection — straight on from behind, normalised over that panel's own extent —
exported as `TEXCOORD_1` and read only by the `jersey_back` material. The panel
is the 182 faces between Spine1 and the neck; defining it by surface normal
alone put it across the small of the back, because that is where this mesh's
most strongly rearward faces are.

Numbers are **real**: the snapshot's `players` map is keyed by the same ids the
at-bat names, so `LiveGameScreen` joins them on and no request is added. A
player the map has not got yet leaves the jersey blank, which is the right
answer — a wrong number on a real player's back is worse than no number.

#### The uniform is cloth, not paint

The kit used to be colour on the body segments, which read as coloured skin.
It is now real geometry over the body: `Jersey` (short sleeves, crew neck,
tucked in), `Pants` (knickers, bloused over a cuff below the knee, high socks
showing), `Belt`, and two pieces of headwear — `Cap` and `Helmet` — all
skinned to the same 65-bone rig and exported in the same `player.glb`.
`player.js` shows the cap on the pitcher and the helmet on the batter. The
home side is white top and bottom and the road side grey (`#9fa4ab` — a
lighter grey read as white under the stadium light, so both teams looked like
the home team). The helmet's ear flap is on the model's left, which faces the pitcher for a
right-hander; a left-hander is a mirror image, so the flap follows.

How the cloth was built, in `player_build.blend`, so it can be rebuilt:

* **Shape.** Each garment is tubes lofted along bone axes (torso + two
  sleeves; pelvis + two legs). Each tube's radius at every station and angle
  is the body's own outer surface, found by raycasting inward against just
  that limb's faces, plus an ease — e.g. pants 1.6 cm at the waist, 3.3 at the
  knee, 0.9 at the cuff; jersey 0.8 where it tucks in, 2.6 through the body.
  The thigh and the torso are then **straightened** between hip and knee and
  between chest and belt, because this mannequin is hourglass-shaped and cloth
  that follows it looks sprayed on. Inner-thigh ease is capped at 1 cm so the
  legs do not web together.
* **Merge.** The tubes of a garment are joined with a voxel remesh (1.2 cm),
  Laplacian-smoothed, then Taubin-relaxed to take out voxel terracing.
* **Openings.** Waist, cuffs, hem and sleeves are cut with planes (clean
  hems); the neck is an elliptical hole with its boundary relaxed.
* **Weights.** Copied from the nearest point on the original body, then
  smoothed over the garment's own edges. The body is almost entirely rigid
  segments, so unsmoothed weights tear the cloth at every joint. The belt and
  the pants waistband are pinned to `Hips` so the belt stays level through a
  stride; cap and helmet are 100% `Head`.
* **The helmet is built by a script, `build_helmet.py`, stored as a text
  block in the blend.** Run it from Blender's Text Editor to rebuild `Helmet`
  in place. Two earlier versions failed. The first was the head grown outward,
  which came out a tall egg with a rim. The second was a superellipsoid
  (exponent 2.2) set high on the head, which read as bulbous. It had
  near-vertical walls, a pointed crown and a flat plank of a bill. The shell
  is now a true ellipsoid crown (exponent 2, so a steady curve; 11 cm up from
  172 cm) over a plan ellipse 22.4 cm wide and 28.8 cm long. The plan is
  egg-shaped (7%), so it is fuller behind than in front, like a real shell.
  Below 172 cm it drops as a barely tapering skirt to a rim. The rim is one
  smooth periodic spline in azimuth: the brow at 170.5, an arch over the ear
  on the open side, and down to 162.5 over the occiput with a small outward
  lip. On the pitcher's side it drops to the jaw at 157.5, and the flap curls
  in under the cheek. The bill is a crescent grown out of the front, 5 cm at
  the centre and tapering to nothing at ±62°. It follows the shell's plan
  curve, tilts down 20° and is cambered. The shell is 0.8 cm thick and the
  bill 0.6, both bevelled. The inside clears the head by at least 0.6 cm
  (1.4 cm to the outer surface), checked by nearest-point distance in rest
  pose; the script prints it. Both UV layers are seam-free (planar `map1`,
  constant `num_uv`), so the 6,154 vertices export as 6,154.
* **Export with only the active scene.** The blend's second scene holds the
  stray `Cube`, and the glTF exporter includes every scene unless told not
  to. Use `use_selection` on `Player` and its children, `use_active_scene`,
  and `export_animation_mode='NLA_TRACKS'`. Re-exported that way, every other
  mesh and all seven clips come out byte-identical.
* **Give new UV layers real coordinates.** A fresh layer starts with every
  face unwrapped to its own square, which splits every vertex on export — the
  helmet went out at four times its vertex count until its UVs were set.
* **Under the clothes the body is gone.** The torso, thighs, hip, knee and
  shoulder joint shells, and the upper arm and shin where a sleeve or cuff
  covers them are deleted, so nothing pokes through in a swing. The head's
  painted cap faces are skin now that there is a real cap.
* **The number** moved to the new jersey: faces facing backward between
  x = ±13.5 cm and y = 124.5–148.5 cm take `region_jersey_back`, with the same
  `num_uv` projection as before (u right-to-left, v up, over 0.1–0.9).

Cloth is one sheet with open hems, so `CLOTH` regions render double-sided — and
cast shadows from their back face only, or they shadow themselves in contour
rings. The pre-cloth file and GLB are kept as
`assets/animations/player_build_pre_uniforms.blend` and
`player_pre_uniforms.glb`.

#### Still rough

* The joint shells are the Beta character's articulation pieces. They are
  coloured to match whatever they join, so they read as part of the body rather
  than as black spheres, but hiding them leaves gaps at the elbow and knee.
* No glove yet. The bat is in (see above).
* The cloth is skinned, not simulated: it bends with the body but does not
  swing or wrinkle. The belt can lift off the waistband a little at the top of
  the pitcher's leg kick.
* The clips carry their root motion, including `batter_homerun`, which walks
  about 1.5 m out of the box. Fine under a camera that cuts to follow the ball,
  wrong if you ever lock on the plate.
* Only the batter and the pitcher exist. No fielders, no runners.

### Wall heights step, they never slope

A park's outfield wall height used to be interpolated between the numbers the
sheet lists — at the two foul lines and at centre — which drew a wall ramping
continuously from one to the next: 8 ft in centre easing up to 25 at the
right-field pole across the whole of right-centre. Almost no ballpark is built
that way. A real wall is a run of flat panels, and where the height changes it
changes at a seam, all at once — the Monster ends and the centre-field wall
starts, a bullpen fence begins. The step *is* the landmark, and sloping it away
invents a shape the park does not have.

So `park.js` holds height as **zones**, each a span of angle at one height, and
`heightSteps` records the angles between them:

* **Hand-authored parks** (`outlines.js`) take a zone per wall run, and a
  corner's height is the height of the run that *arrives* at it. That is how the
  outlines are written — Fenway's −7.5° corner is where the Monster ends, and its
  37 ft belongs to everything back to the pole, not to the wall beyond it.
* **Every other park** gets three zones from its three listed heights, stepping
  at the power alleys (±22.5°). Nothing in three numbers says where a seam is,
  and ±22.5 is the one choice the data itself suggests: it is where the other
  numbers are measured.
* A park of one height all the way round has **no seams at all**, and must not
  get one drawn at a power alley just because zones meet there.

The seam has to reach the *mesh*, not just the height function: the wall is a
ribbon joining consecutive boundary samples, so two samples half a degree apart
at different heights would be joined by a quad that ramps between them — a 3 ft
slope at 400 ft, which is the gradual change this is meant to remove. So the
boundary carries a **pair** of samples either side of every seam (`STEP_EPS`),
putting the whole change into one quad a couple of inches wide: Oracle Park's
17 ft step in right field comes out 1.7 in across, vertical from anywhere a
camera goes, and still real geometry rather than the degenerate zero-width quad
that sharing one sample would give.

`npm run selftest:parks` asserts all of it: that no park's height changes
anywhere but at a declared seam, that Fenway's Monster ends in one step rather
than a ramp, and that the seam is bracketed by two samples in the built
boundary.

### Rebuilding the ball

Not a replay of a recorded path — MLB gives four numbers and the flight is
reconstructed from them. A drag-free parabola is nowhere near: 108.4 mph at 27°
has a vacuum range of 635 ft against a tracked 428, so drag and lift account for
a third of the flight and a real integration is unavoidable.

**`distance` does not mean the same thing on every batted ball**, which is the
trap the whole solver is built around. It is a landing point on a home run, the
fielder's position on a lineout, and bounce-and-roll on a chopper. So the solver
decides which it is looking at from the physics, never from the label — a
mislabelled `trajectory` then cannot produce a broken replay:

| | when | what it does |
|---|---|---|
| **intercept** | the ball outflies `distance` even with zero lift | fly the natural arc, stop there — that height *is* the catch |
| **carry** | `distance` is inside the spin bracket | solve backspin so it lands exactly on the number |
| **caught** | the feed says it was caught, but the fielding coordinate is out of reach | fly the arc that was measured and report the disagreement |
| **ground** | no backspin could carry that far | fly to first contact, then solve rolling friction |

`caught` exists because of real data. Across three real games every pop-up fell
through to `ground` and was rolled across the infield to reach a fielder's
coordinate — one of them a 67.7 mph ball hit at 80 degrees, straight up, skidding
sixty-five feet over twelve seconds. A caught ball never touches the ground, so
it must never reach that branch. `solved` then only flags a miss bigger than the
greater of 10 ft and 5%, because most of these are off by four to nine feet,
which is coordinate noise on a ball nobody measured landing.

**The play does not end when the ball lands.** A `carry` ball keeps going after
touchdown — it bounces and rolls until friction stops it or it reaches the wall.
Ending the path at first contact made every fly ball stop dead on the grass,
which was the most unnatural thing the replay did. The landing point stays
exactly on the tracked number; the roll past it is simulated, because nothing in
the feed describes it, and that split is why the result carries `tracked` (what
the data pins down, and where the marker goes) separately from `rest` (where the
ball finally stops).

Two things bound the roll. Past the fence the ball is in the **seats**, where it
hits chairs and people, barely bounces and stops within a few feet — without
that a home run kept bouncing another ninety feet through the bleachers. And a
ball caught on the fly does not roll at all: `caught` is the one place an
outcome *label* is allowed to steer the reconstruction, because it is a fact the
feed states rather than a guess about physics, and without it every routine fly
out trundled thirty feet as though it had been dropped.

A 99 mph liner at 8° with distance 121 comes back as a catch 9.6 ft up at the
shortstop, and nothing told it there was a shortstop.

The solved backspin is the model's own honesty check. If the drag is wrong the
ball still lands in the right place — the solve hides the error by compensating
with lift — and the only symptom is a spin no bat produces. That is what caught
the original `Cd = 0.35`: a 428 ft home run needed just 995 rpm. At the
calibrated 0.385 it needs 1822, and 100 mph at 30° carries 393 ft.

Direction always comes from `hit.coordinates`. Magnitude is the **larger** of
`totalDistance` and the coordinate's own distance — not `totalDistance` on its
own, which is wrong on exactly the balls that never leave the ground.
`totalDistance` is a projected carry: meaningful for a fly ball, poor for a
chopper, where it comes back well short of where the ball was actually fielded.
The coordinate is not a projection — a fielder stood there and touched the ball,
so the ball reached at least that far. Preferring the stated number had ground
balls stopping dead in the middle of the infield, short of the fielder who threw
the runner out.

Sidespin is deliberately not modelled: nothing in the feed measures it, and a
hook nobody recorded would be invented data.

```bash
npm run selftest
```

Runs every stub at-bat end to end and prints mode, carry, catch height, hang
time, apex and solved spin, with the physics checks in front of it.

### Pitches

A weaker problem than the batted ball, and it matters that the difference is
stated. A batted ball comes with exit velocity, launch angle and a distance —
enough to pin a flight down. A pitch comes with two things: where it crossed the
front of the plate, and its release speed. No release point, no acceleration, no
spin; none of the nine parameters a full Trackman record carries.

So the pitch is a **fit, not a simulation**. The release point is assumed (6.4 ft
of extension, 5.8 ft high, offset toward the throwing arm) and the launch
direction is solved by shooting until the ball — flown under the same drag and
Magnus model as a batted ball — arrives exactly at the recorded plate location.
What is real is where it ends up and how long it took. What is assumed is where
it started and how it broke on the way.

Spin comes from a per-pitch-type table and is entirely invented, because the
feed has none. It is there because a curveball and a four-seamer arriving at the
same spot along identical paths look wrong, and the feed does say which is
which. It changes the *shape* of the path and nothing else: the solve adjusts
the release direction until the ball reaches the recorded location whatever the
spin does en route.

**The sign of `plate.x` is not guessed.** `server/projection.py` establishes it
empirically — 9 of 9 hit-by-pitches to right-handed batters had pX < 0, so
negative pX is the third-base side, which is this engine's `-X`. It maps
straight across with no flip, and `StrikeZone.jsx` already depends on the same
convention.

### A ball in play arrives twice

GUMBO sends two updates when a ball is put in play, and the first one is a trap.
Captured verbatim off the replay stream (Yandy Díaz, TB @ ATL, 2026-09-10):

| | first update | second update |
|---|---|---|
| `result` / `kind` | `"At bat"` / `live` | `"Single"` / `hit` |
| exit velo, launch angle, distance | 94, 8, 163 | 94, 8, 163 |
| `hit.coordinates` | `{ x: null, y: null }` | `{ x: 83.49, y: 119.57 }` |
| `hit.trajectory` | `null` | `"ground_ball"` |

The first update already carries everything the solver needs to build a
flight — and no landing coordinates. So it built a perfectly confident 163 ft
ground ball to **dead centre**, played it, and a second later the real update
landed and it played again, to left field where the ball actually went. Two
replays of two different plays, one of them fiction.

`isAwaitingDetail()` holds the engine back while the ball is in play and the
play is not closed out. `kind` is `"live"` for exactly as long as GUMBO has not
resolved it, and the outcome and the coordinates land together when it does, so
waiting on that is waiting for the whole truth rather than for one field. The
gate returns before `loadedKey` is touched, which is what makes the second
update register as new.

It is deliberately **not** keyed on the coordinates being absent: once a play is
complete, missing coordinates mean the ball genuinely was not tracked, and
holding out for data that will never come would mean never showing it.

Measured over one real game's stream: 143 loads without the gate, 123 with it,
and all 20 removed were balls in play being flown to dead centre. Every single
one — this was not intermittent.

### Reloading only when something changed

`engine.load()` compares a **content key** — at-bat id, result, pitch count, the
last pitch's plate location and velocity, and the batted-ball figures — and does
nothing when it matches what is already loaded.

Without it a live game replayed the same pitch on a loop. The app hands the
engine a fresh at-bat *object* on every backend poll, because the snapshot is
re-parsed JSON and nothing survives by identity, and a live game polls every
eight seconds — so the replay restarted from the top every eight seconds until
the next pitch arrived. Pitch count is in the key deliberately: during an at-bat
the id stays the same while pitches are appended, and a new pitch should replay.

One consequence worth knowing: re-selecting the at-bat you are already on will
not restart it. `play()` is the control for that.

### One clock

A pitch and a batted ball are the same ball on one timeline: it leaves the hand,
crosses the plate, and either finishes in the mitt or comes off the bat. `play.js`
splices them so the trail is continuous, the transport scrubs across contact, and
the camera has a real moment to cut on.

The clock starts before the ball does and runs on after it — `t = 0` is the
first frame of the wind-up, the ball is released at `path.releaseTime`, and the
tail leaves room for the follow-through. See **The play is longer than the
ball**.

Contact is the join, and the batted ball launches from the point the pitch
actually crossed — including its height, so a ball hit at the knees starts at
the knees. Distances are still measured from the world origin (the back point of
the plate, which is what MLB measures from), so moving the launch point does not
move the landing point the solver is aiming at.

### The strike zone

Drawn **flat**, on the plane where pX / pZ are measured — the front edge of home
plate — with MLB's 3x3 grid on it. The zone is a two-dimensional judgement: a
pitch is a strike on the strength of one crossing. Drawing it as a box invented
a depth the rule does not have and read as a floating crate from any angle off
the catcher's line.

When the pitch arrives it leaves a **temporary mark** where it actually crossed.
Temporary matters: a mark that stayed would still be sitting in the zone during
the next pitch, claiming to describe it. It holds for 1.5 s, fades over the next
1.2 s, and is cleared outright when the engine goes idle.

### Idle

The engine spends most of its life in `idle`: the strike zone, framed from the
catcher, nothing moving, waiting for the next pitch to arrive on the feed. A play
runs, holds on its result for a beat, then drops back to it — and if the plate
appearance ended, the batter comes off with the ball. A pitch that was never put
in play has no contact time, so the camera never leaves the plate — which is
right: a called strike is watched from behind the plate, not chased into the
outfield.

Going back to idle is also where the queue is drained: if a play arrived while
this one was running, it starts here instead.

### Cameras

`catcher` is the default and the only preset that is **locked**. Locked does not
mean parked: it hands the camera to a director that works the play the way a
broadcast does. It holds the catcher's view — behind the plate at a crouching
catcher's eye height, strike zone framed — through contact so you see the ball
leave the bat, then swings back to a high camera behind home and tracks the
ball, narrowing its field of view as the ball gets further out.

The zoom is a real zoom. The camera stops moving once it reaches its anchor and
changes focal length instead, which is what a camera operator does and what
keeps the shot stable; flying the camera alongside the ball looks like a video
game and destroys any sense of how far the ball actually went.

<kbd>L</kbd> cycles three camera modes: `catcher` and `centerfield` (both
driven by the director) and **free roam** (`src/replay/freeroam.js`), a fly
camera rather than an orbit — WASD/arrows move level with the ground, drag
looks (grab-the-world), Space/Shift+Space go up and down, the wheel zooms the
lens, and <kbd>B</kbd> keeps the camera turned on the ball from wherever it is
until a drag or another B. Free roam starts from wherever the director had the
camera, so switching never jumps; its input listeners only act while it is on,
so the director modes keep Space for play/pause and the page keeps its wheel.
The lab's lock checkbox is director (checked) vs free roam.

It aims at the strike zone, not down the field. Aiming at the rubber looks like
the right idea and is not: the camera sits above a zone only eight feet away, so
the two directions differ by about 12°, and framing the mound pushes the bottom
of the zone off the screen.

**Settings → Replay → Camera** picks the shot every play starts from: **Behind
the plate** (`catcher`) or **Broadcast** (`centerfield`) — the TV shot from out
past the centre-field wall, high, on a 2.6° lens, looking in over the pitcher's
shoulder at the batter. It sits a little to left-centre so the pitcher stands to
one side of the plate. Its near plane is 40 ft: through a lens that long at
440 ft, the default half-foot leaves the depth buffer too coarse to keep the
chalk off the dirt. On a ball in play the broadcast shot **cuts** to the same
high tracking camera the catcher's shot glides to, as television does — gliding
from centre field would fly the camera the length of the park.

The broadcast shot is the first camera to look back toward home. What it finds
there is the backstop wall and the plain dark ground beyond it, **and that's
deliberate**. A painted crowd once filled that space: a lower bowl of seats and
people rising behind the plate. From 440 ft through a 2.6° lens it read as
noise, not a crowd, and it cheapened the shot. The empty ground behind the
fence is cleaner, so the stands were removed. The walls carry a little light
of their own, because the backstop's field side faces away from the sun and
went black from centre field.

**Settings → Replay → Zoom** (0.6×–2×) is also a real zoom, of whichever shot is
chosen: the lens narrows or widens, the camera stays where it is.
**Day or night** is Auto by default: MLB marks every game `day` or `night`
(`dayNight`, passed through by the backend) and the park is lit to match — with
no such field, a start from 5 pm on counts as night. Day and Night force one for
every game. Night darkens the sky and fog and swaps the sun for the lights — a
key high over home plate, so shadows drop short, plus a shadowless fill from the
far side. The lights live on the field, so a new park is told again.

A change of ballpark re-solves the play on screen in place. It used to restart
it from the wind-up, so a venue that arrived after the play began showed it
twice.

Outside full screen the stage is never taller than the window can show under the
header (`max-height` on `.viewport__stage`). On a wide window it goes a little
wider than 16:9 rather than running off the bottom; the engine sizes from the
mount, so that is just more field at the sides.

The home-plate area carries a second, sharper copy of the surface —
2048 px over 64 ft, four times the base texture's 8 px per foot. From any other
camera the base is plenty; from the catcher's, the batter's-box chalk turns into
blocks without it. Its edges are alpha-faded so the join does not announce
itself, and it stops short of the mound, which samples the base texture.

### The replay lab

`field.html` runs the engine on its own, with no auth gate and no backend:

```bash
npm run dev
```

Then open `/field.html`. It has a transport with a scrub bar, the camera lock,
and a readout of what the solver decided — mode, landing point, catch height,
apex, hang time and solved spin.

**Real games.** Pick a date and a game and the lab pulls that game's at-bats
from the same backend the app uses, so an at-bat selected there is byte for byte
what the live feed would hand the engine — no fixture path, no special case.
Needs the backend up:

```bash
python server/app.py
```

Without it the picker says so and falls back to the built-in fixtures. Only
games that have been played carry tracked at-bats, so the list is filtered to
final and live ones. Markers in the at-bat list: **◆** has a batted ball, **·**
is a pitch only (a walk or a strikeout), **○** is a fixture with no coordinates.

<kbd>1</kbd>–<kbd>5</kbd> camera presets (2–5 start free roam there) ·
<kbd>space</kbd> replay · <kbd>L</kbd> next camera mode · <kbd>T</kbd> the raw painted layout texture, which is the
fastest way to check the field against a photograph since everything except the
mound is decided in that one image.

## Mounting the replay engine

Everything you need is in `src/components/ReplayViewport.jsx`; its header comment
is the authoritative version of this section.

```js
const mount = document.getElementById('replay-viewport');
mount.addEventListener('barrels:atbat', (e) => engine.load(e.detail));
engine.attach(mount);
window.BarrelsReplay.setEngineReady(true);
```

* The mount is **always empty on the React side** — React never renders children
  into it, so the engine can `appendChild` a canvas and own it outright.
* It is `position: absolute; inset: 0` inside a `16 / 9` stage with
  `overflow: hidden`. Size the renderer from a `ResizeObserver` on the mount; the
  surrounding layout never depends on the engine's size, so nothing reflows when
  it appears.
* `window.BarrelsReplay` exposes `getMount()`, `getStage()`, `getCurrentAtBat()`,
  `getStagedAtBat()`, `getCurrentPark()`, `isFollowingLive()`, `getView()` and
  `setEngineReady(bool)`.
* Selection changes arrive as bubbling DOM events on the mount: `barrels:atbat`
  (an at-bat to play, with an `eventId`), `barrels:stage` (following live: who
  is up, shown between plays and never played), `barrels:quality`
  (`'low' | 'medium' | 'high'`),
  `barrels:sound` (bool), `barrels:park` (`{ venue, home }`),
  `barrels:camera` (`'catcher' | 'centerfield'`), `barrels:zoom` (number,
  1 = stock), `barrels:night` (bool) and
  `barrels:follow` (bool). Camera, zoom and night are also readable from
  `window.BarrelsReplay.getView()`, which the engine reads on attach. So is the
  play or the stage: following, the engine stages the at-bat in progress and
  plays nothing; not following, it plays the picked at-bat.
* The engine answers with `barrels:moment` — `{ pitch, contact, landed,
  awaiting, id, busy }`: what the play on screen has revealed, its `eventId`,
  and whether anything is playing or waiting its turn.
* `barrels:follow` says whether the app is following the live game, and decides
  what an arriving at-bat means: queue it behind the play already running, or
  replace that play because the viewer picked this one by hand. It is sent
  before the at-bat it goes with — see **Plays queue**.

### What the engine receives

Real tracked data, live:

```json
{
  "id": "ab-23", "inningLabel": "T4",
  "batter": "Gunnar Henderson", "pitcher": "Freddy Peralta",
  "batSide": "L", "pitchHand": "R",
  "result": "Lineout", "kind": "out",
  "exitVelo": 87.6, "launchAngle": 25, "distance": 322,
  "hit": {
    "launchSpeed": 87.6, "launchAngle": 25, "totalDistance": 322,
    "trajectory": "line_drive", "hardness": "medium", "location": "8",
    "coordinates": { "x": 153.94, "y": 72.79 }
  },
  "pitches": [ { "type": "Four-Seam Fastball", "velo": 93,
                 "plate": { "x": 0.255, "z": 2.10, "szTop": 3.329, "szBottom": 1.68 } } ],
  "hasReplay": true
}
```

* `hit.coordinates` is MLB's landing grid: ~250×250, home plate near
  (125.4, 203.5), ≈2.29 ft per unit. `PlayerCard.jsx` converts it for the spray
  chart if you want a worked example.
* `pitch.plate` is the plate crossing in feet plus that batter's strike-zone
  bounds.
* `hasReplay` is true only when a batted ball has landing coordinates, so it is a
  safe gate for offering playback.

## Home screen

Signing in lands on **Home**, not on whichever game is next — a scorebug for an
arbitrary game is a poor first impression.

Home is a landing page, not a pitch. It used to open with a lede paragraph and
three cards explaining what the app does (how the poller works, what the
strike-zone plot is drawn from, that the replay engine was coming). Nobody who
has just signed in needs any of that — they know what they opened — and it
pushed the only thing they came for below the fold. Everything above the
leaderboards now answers one question: what is on right now, and how do I get
into it.

* a masthead — who is signed in, today's date, and the two ways in
* today's slate as three counts, live ones in the accent
* the games themselves as tiles, favourite clubs first, each one click from
  the game

`TILE_LIMIT` in `HomeScreen.jsx` caps the tiles at six — two rows of three on a
wide window — with an **All N games** link to the full schedule.

### Favourite teams

Settings → **Favorite teams**: all thirty clubs as logos, click to follow. This
is a question about which badge you recognise, so a dropdown of names would be
the wrong control even though it is less markup.

Favourites are the one piece of state that is **persisted** (`localStorage`,
under `barrels:favorites`, in `src/data/favorites.js`). Everything else here is
session-local by design; a set of favourite teams you have to re-pick on every
reload is not a feature, it is a chore.

* Stored as the feed's own abbreviations (`NYY`, `LAD`) — the same key `TEAMS`,
  the logos and the team colours already use, so a favourite needs no lookup
  table of its own.
* **Order is the user's.** Kept in pick order rather than sorted: for anyone
  with two or three it reads as a ranking, and the first is labelled *main*.
* Capped at `MAX_FAVORITES` (6). At the cap, picking another **drops the oldest**
  rather than refusing — refusing is the behaviour that needs explaining in the
  UI, dropping is what the person clicking a new club plainly meant.
* Every stored entry is re-checked against `TEAMS` on read. Storage outlives the
  code that wrote it, and a club that gets re-abbreviated (the A's have already
  done it once) would otherwise sit there forever matching no game.
* Reads and writes are wrapped: Safari in private mode *throws* on storage
  access rather than returning null, and an embedded frame can have it blocked.

They surface in two places: their games come first on the home page (a stable
partition, not a sort — the schedule arrives in a deliberate order and a
favourites-only comparator would scramble the rest of it), and they are starred
and lifted to the top of each section on the schedule.

### League leaders

Deliberately sabermetric. statsapi's `leagueLeaders` categories stop at OPS and
WHIP; `stats=sabermetrics` is the only place it exposes these:

| | hitting | pitching |
|---|---------|----------|
| | **WAR** wins above replacement | **WAR** |
| | **wRC+** park-adjusted offence, 100 = average | **FIP** strikeouts, walks and homers only |
| | **wOBA** weighted on-base average | **ERA-** park-adjusted, 100 = average |

Two things about that endpoint, both established by probing it rather than
assuming:

* **Its sort order cannot be trusted.** `war` and `eraMinus` come back
  descending while `fip` and `xfip` come back ascending. Taking the first rows
  of an `eraMinus` request produced a leaderboard of 131, 121, 111 — the three
  *worst* qualified pitchers, since lower is better and 100 is average.
  `leaders.py` pulls the whole pool and sorts by each stat's own polarity.
* **The pool is already qualified** — a 250-row request returns 54 pitchers, all
  135+ innings, so no two-inning reliever tops a rate board.

Values arrive as long floats (`war` 8.65609) and are formatted server-side, next
to each stat's definition: WAR to one decimal, FIP to two, wOBA as `.398`.

Cached for 10 minutes with the same stale-serving contract as the scoreboard —
these move once a day at most, and an upstream blip should not empty the page.

### Exploring a board in full

Each board carries a **See top 50** footer that opens that category as its own
page: fifty names, each with a headshot, each one click from their card.

`/api/leaders` takes `?per=` (default 5, clamped to 50). The board is always
*built* at fifty and sliced per request, so the home page's five and the full
page's fifty come out of one cache entry and one set of upstream calls —
expanding a board costs nothing upstream. The pitching pool is smaller than the
hitting one (statsapi qualifies ~54 pitchers against ~137 hitters), so a
pitching board can legitimately run out before fifty and the page says how many
it is showing.

The full page is a screen rather than an expand-in-place: at fifty rows, three
boards side by side stop being scannable. It is reached only from Home, so it
keeps Home's nav pill lit rather than leaving the header blank.

### Player cards from the leaderboards

Clicking a leader opens the same player card every other name in the app opens
— see [Player cards](#player-cards). Players in the current game come free with
the snapshot; anyone else is fetched from `/api/player/<id>`, so the name is
never a dead link. Those cards drop the batted-ball and spray-chart blocks,
which describe tracked contact in one specific game and have nothing behind
them here.

## Player cards

Any player name in the app opens their card: box score rows, both names on an
at-bat, the "at bat" line on the scorebug, and the league leaderboards. It is a
modal over whatever you were looking at — the feed keeps streaming behind the
scrim, nothing navigates, and closing returns focus to the name you clicked, so
you land back in the game exactly where you left it.

`PlayerName.jsx` is the single place a name becomes a card. Give it a
`playerId` and it renders the control; give it none and it degrades to plain
text, because a dead link is worse than a label.

The card has two faces. The front is deliberately thin — headshot, identity,
four ability bars, an overall — and everything statistical is on the back,
reached with one control in the footer. Both faces are always in the DOM, so
the hidden one carries `inert` and the focus trap skips it.

### The look

A perforated stamp, 388x606, navy and gold on cream — built to its own design
comp rather than to the app's own palette, and deliberately so. **The card does
not follow the theme.** It reads as a physical object laid on top of the app,
and a printed card is navy-and-gold in a dark room too, so every colour comes
from the `--card-*` tokens and there is no dark variant.

**Front.** A dark photo panel carries the cut-out portrait, with the club
abbreviation, position and season repeating on the diagonal behind it the way a
stamp's security tint runs under the image. The overall sits in a rotated
diamond; the season stacks as `20`/`26` down the right edge. Below, a navy plate
with the name and the four ability ratings as bare numerals — at this size a
number reads faster than a bar, and it leaves the photograph the whole card.

**Back.** A navy header repeats the diamond and the name, then gold-ruled
sections over cream: bio as label-and-value on one line, two pairs per row, hung
on a dotted rule like a printed form; stats as four-across tiles, filled for the
season line and outlined for the expected line so the two read as different
kinds of number. Tiles carry an optional third line for units — a card has no
room to write "89.2 mph" at 19px, and a label of "EV MPH" reads as one garbled
word.

The comp also lays out splits, career-by-year, contract and service time, and a
scouting note. **None of those are rendered**, because nothing in this app's
data flow supplies them and an invented scouting note is still an invention.
What is there — bio, season line, expected/plate-discipline, arsenal, speed and
defence, this game's batted balls — is all real.

### Typefaces

Two families, self-hosted from `public/fonts`:

| | |
|---|---|
| **Barlow Condensed** 700/800 | names, ratings, every stat value. Condensed is what lets a 32px name fit across a 388px card. |
| **Archivo** variable 100-900 | every uppercase, letter-spaced label. Holds its shape at 7.5px where most faces mush. |

Extracted from the design bundle rather than loaded from `fonts.googleapis.com`:
the rest of the app ships no external assets (see `Icons.jsx` — no icon font, no
CDN), and a card rendering in a fallback face while a third party is slow is a
card with the wrong *proportions*, not merely the wrong font. Archivo is a
variable font, so three weights cost one file. Both are split latin /
latin-ext, and the ext subset is not decoration — it carries the accents in
Díaz, Báez and Jesús. 142KB for six files.

### Two sizing traps, both hit in practice

* **`max-width: 100%` does not clamp a centred grid item.** The modal centres
  the card in an auto-sized track, the track grows to fit a 388px card, and
  `100%` then resolves to that same 388px. On a 375px phone the card sat wider
  than the screen. It is sized against the viewport instead — and against a
  third ceiling that holds the 388:606 proportions once width is binding,
  because a card that goes tall and thin stops looking like a card.
* **`backface-visibility` is not inherited.** Every element carries its own and
  the default is `visible`, so a descendant that establishes its own rendering
  context — a drop-shadowed portrait, a z-indexed badge — is composited
  separately and judged on *its* value, and paints through the back of the card
  mirrored on top of the stats. Naming them explicitly is the direct fix; the
  face pointing away is *also* taken out of painting with `visibility`, delayed
  to the midpoint of the flip so the swap happens while the card is edge-on.
  The second mechanism is what actually guarantees it, and it covers any
  filtered child added later.

**`backface-visibility` is not inherited.** Every element carries its own, and
the default is `visible`. A descendant that establishes its own rendering
context is composited separately and then judged on *its* value rather than the
face's — so the drop-shadowed portrait and the z-indexed overall badge kept
painting through the back of the card, mirrored, on top of the stats. Naming
them explicitly is the direct fix; the face facing away is *also* taken out of
painting with `visibility`, delayed to the midpoint of the flip so the swap
happens while the card is edge-on. The second mechanism is what actually
guarantees it, and it covers any filtered child added later.

### Headshots

`data/headshots.js` builds the URL from the MLBAM person id, which already
arrives on every box-score row, at-bat and leaderboard entry. No image files
are stored and no per-player URL is hardcoded. Two variants: `cutout` (the
silhouetted portrait, which is what makes the card look like a card, since it
composites over the club's colours) and `spot` (round crop, for a small inline
avatar).

**The trap, verified against the live CDN:** an unknown id does **not** 404.
Every variant answers `200` with MLB's own generic silhouette. So an `onError`
handler cannot detect "this player has no photo" — it only fires on a genuine
network failure. What actually keeps a placeholder out of the UI is the id
check: `mlbHeadshotUrl` returns `null` for anything that is not plain digits,
which is also how the offline stub players (ids like `p-11`) fall back to
initials instead of quietly rendering a stranger's silhouette.

The big cut-out loads eagerly. It is the subject of a dialog the user just
opened, and `loading="lazy"` left a shimmer where the player should be.

### Ability ratings

Every rating is a **percentile against the actual major-league population**,
not a hand-tuned curve from a stat to a grade. "Power 72" means "a better ISO
than 72% of the hitters in the pool", and the card says which pool underneath
the bars.

|  | hitter | pitcher |
|---|---|---|
| | **Contact** xBA | **Stuff** whiff%, K%, velocity |
| | **Power** ISO (SLG − AVG) | **Command** BB% and edge% |
| | **Speed** Sprint speed | **Velocity** average fastball |
| | **Fielding** OAA within position; run value for catchers | **Run prevention** xERA |
| | **Overall** xwOBA-anchored | **Overall** weighted composite |

Four decisions in `server/ratings.py` that are easy to get silently wrong, and
which `ratingstest.py` pins down:

* **Ties take the midpoint of the block they share.** `percentile = 100 ×
  (below + tied/2) / N`. OAA is a small integer, so dozens of fielders sit on
  the same value; counting ties as "beaten" would hand every one of them the
  top of the block.
* **Composites are re-percentiled, not averaged.** A weighted mean of
  percentiles is not itself a percentile — averaging pulls everything toward
  50, so a player at the 90th percentile in four skills would score in the low
  70s and nobody would ever look elite. Overall, Stuff and Command are each
  scored for the whole pool and then ranked again, so they are true percentiles
  of their own distribution. A pitcher at the 90th in every component comes out
  at 90.
* **Missing components are dropped, never defaulted.** A designated hitter has
  no fielding sample at all. Scoring that as 0 would call every DH the worst
  fielder alive; scoring it 50 would invent an average defender. The bar
  disappears and the composite renormalises over the weights it does have.
* **Catchers are graded on run value, not on OAA they do not have.** They are
  absent from the OAA board because catching is not a range skill, so Savant
  models it as framing, blocking and throwing instead. `statcast.py` sums those
  three published run values into catcher Fielding Run Value and the catcher is
  ranked against other catchers; the back of the card shows the split.
* **Fielding needs a real sample.** `min` on the OAA board is *attempts*, and it
  was briefly set to 1. OAA is a counting stat, so a thin sample sits near zero
  and lands mid-pack rather than nowhere: Yordan Alvarez, a DH, picked up −2 OAA
  from a handful of left-field innings and was graded 25th percentile against 88
  full-time left fielders, which cost him 10 points of Overall. The threshold is
  now 50 chances (and 500 pitches caught for a catcher).
* **Fielding is graded within a position.** OAA is a counting stat gated by
  opportunity, and opportunity depends on where you stand — +4 is a very
  different season at shortstop and at first base.

**A hitter's Overall is not the average of his bars.** Contact and Power are two
partial views of one swing, and averaging them misreads anyone lopsided: a
hitter can sit 95th in xBA and 12th in ISO — a high-average bat who walks and
does not slug — and the blend calls that mediocre when his run production is
well above average. So Overall is anchored on **xwOBA**, which weights every
outcome by the runs it is actually worth: xwOBA .70, fielding .20, speed .10,
re-percentiled. The bars still say what a hitter does well; Overall says how
much he is worth. That trade is real and the card owns it — the badge carries
its basis on hover, because otherwise a lopsided hitter's number looks like it
disagrees with his own card.

The remaining 30% splits the way value does, defence ahead of baserunning,
matching the ordering of WAR's components. For pitchers, preventing runs is the
job and velocity is already inside Stuff, so counting it fully would count the
same fastball twice: run prevention .40, stuff .30, command .20, velocity .10.

A player under the pool threshold gets **no ratings and a stated reason**
("under the 100 plate appearances needed to be ranked against the league")
rather than a number invented from a small sample.

### Where the numbers come from

statsapi carries none of this: the GUMBO feed has a game's tracked contact but
no season Statcast totals, and `stats=sabermetrics` stops at WAR/FIP/wOBA. So
`statcast.py` pulls Baseball Savant's CSV leaderboards, which key every row on
`player_id` — the same MLBAM id statsapi uses, so the join is a dict lookup.

| board | gives | pool |
|---|---|---|
| `custom` (batter) | xBA, xSLG, xwOBA, AVG, SLG, barrel%, hard-hit%, K%, BB% | 100+ PA |
| `custom` (pitcher) | xERA, K%, BB%, whiff%, edge%, zone%, fastball velo | 25+ IP |
| `sprint_speed` | sprint speed, home-to-first, bolts | 10+ runs |
| `outs_above_average` | OAA, runs prevented, position | fielders, 50+ chances |
| `catcher-framing` + `-blocking` + `-throwing` | catcher run value, split three ways | 500+ pitches |
| `pitch-arsenals` + `pitch-arsenal-stats` | usage, velocity, whiff, xwOBA per pitch | 100+ pitches |

Things established by probing the live boards rather than assumed:

* **`min` means different units per board.** Plate appearances on the batter
  board, *innings* on the pitcher board — `min=150` returns 11 pitchers while
  `min=100` returns 105.
* **`min=q` is far too strict for a player card**: 137 hitters and 54 pitchers
  league-wide, so most of the nine names in a box score would have no ratings.
  The pools above are wider on purpose.
* **The fielding board has no catchers or pitchers.** A missing OAA is normal.
* Responses are UTF-8 with a BOM, and numbers arrive quoted and
  baseball-formatted (`".227"`).

Cached six hours per season with the same stale-serving contract as the
scoreboard, and every board is fetched independently: one failing board costs
its own ability bar, not the whole card. `ratings.profile()` never raises, so if
Savant is unreachable the card keeps its bio and season line and says why the
bars are missing.

### Two gaps, stated rather than filled

* **SIERA is not available.** It is a FanGraphs stat with no public API, and
  neither statsapi nor Savant exposes it. Run prevention is built on **xERA**
  instead — a real Statcast metric measuring the same thing, fetched rather
  than estimated — with **FIP**, **xFIP** and **ERA-** shown alongside it on
  the back. Implementing SIERA from its published regression would mean
  shipping coefficients that cannot be checked against a reference value, which
  is the sort of plausible-but-wrong number worth refusing to produce. Getting
  it properly would need per-pitcher GB/FB/PU rates plus a verified set of
  coefficients.
* **Command has no public ground truth.** The real models (Location+ and
  friends) are proprietary. Walk avoidance plus edge% — the share of pitches on
  the black — is the best proxy the public data supports, and the card labels
  it as a proxy rather than implying a scouted grade. In-zone% is deliberately
  excluded: a pitcher who grooves everything posts a high one.

FIP additionally comes from the **qualified-only** sabermetrics endpoint, which
ignores a larger `limit`, so a reliever legitimately has none and the card shows
a dash.

### Adding to the card later

The pieces are separate on purpose. A new ability is a ladder plus a weight in
`ratings.py` and a row in the front's ability list. A new block on the back is a
`<Section>` in `PlayerCardBack.jsx`. A new Savant board is a loader in
`statcast.py` registered in `_LOADERS`, which gets the caching, the per-board
failure isolation and the `sources` reporting for free. Pitch **movement**
characteristics are the obvious next addition: they need one more Savant board,
joined the way velocity already is.

## Team colours and logos

Club colours come from files dropped into `assets/`:

```
assets/colors/team_colors.csv                official club colours, by team name
assets/audios/*.mp3                          sound effects
```

`scripts/build_team_assets.py` turns those into what the app actually uses:

```bash
python scripts/build_team_assets.py
```

* `public/audio/<name>.mp3`: the sounds, copied through so Vite serves them.
* `src/data/teams.js`: generated, so don't edit it. It's keyed by the
  **abbreviation** the MLB feed sends on every game, so the UI never
  string-matches team names. It also carries each club's MLB team id and its
  two logo URLs.

Re-run the script after changing anything in `assets/`.

### Logos come from MLB's CDN

The repository ships no logo files. `TeamLogo.jsx` loads MLB's own SVGs by team
id, from the same CDN the player headshots come from:

| field | URL | used |
|-------|-----|------|
| `logo` | `mlbstatic.com/team-logos/<id>.svg` | light theme |
| `logoDark` | `mlbstatic.com/team-logos/team-cap-on-dark/<id>.svg` | dark theme, and anything drawn over the 3D scene (the replay HUD and interludes pass `surface="dark"`) |

The dark variant isn't a nicety. Most club marks are navy or black and
disappear on the espresso palette, so MLB's cap-on-dark set recolours them (a
white Braves "A", a white Yankees "NY"). Each file is 0.5–1.5 KB, vector so
it's crisp at any size, and served with a two-week cache. All thirty load in
well under a second from cold.

When a mark can't load (offline, or an abbreviation the table lacks), the
component falls back to a monogram in the club's colours. It remembers which
URL failed rather than giving up on the team, so switching theme retries with
the other mark.

The alternatives were measured before switching. A local 128px PNG pack worked
but shipped 6.6 MB of source art, blurred above 128px and had no dark
variants. MLB's `team-primary-on-*` set uses the full wordmark logos (Braves
script, Phillies bell), which are illegible at the 14–26px the UI draws them.

### Colours

Each entry carries `primary`, `secondary`, the full `palette`, and two derived
values:

* `ink` — a team colour guaranteed to clear 4.5:1 on the cream page. Five
  primaries are too light to read as text on cream (Orioles orange, Guardians
  and Marlins red, Phillies red, Giants orange), so the generator falls back to
  the club's secondary, then darkens until it passes, rather than dropping to a
  generic grey.
* `onPrimary` — text colour for a chip filled with the primary.

`src/data/teamStyle.js` turns an abbreviation into CSS custom properties
(`--team`, `--team-ink`, `--team-wash`, ...) for spreading onto an element. What
components mostly receive are *low-alpha* washes — cream and tan still lead, and
club colour arrives as a hairline accent, a tinted row, or a small mark:

| surface | treatment |
|---------|-----------|
| Box score | accent bar in the selected club's colours, logo + colour on the team tabs, club wash behind the table head |
| Scorebug | logo per side; the side at bat gets a club wash and a coloured spine |
| Game list | both clubs split across the card's top edge, logos on each row |

`TeamLogo` falls back to a monogram in the club's colours whenever a logo is
missing, so an abbreviation the pack does not cover still renders sensibly.

One CSS trap worth knowing: **do not transition a property whose value comes
from a changing custom property.** The scorebug's batting-row wash is set from
`--team-wash`, which React rewrites on every snapshot; with a `transition` on
it, the computed value sticks a flip behind and the row keeps the *previous*
batting team's colour. The highlight snaps instead, which is what a scorebug
should do.

## Strike zone / pitch location

`StrikeZone.jsx` plots every pitch of the selected at-bat where it crossed the
front of home plate — the broadcast-style box. It is drawn in real units and
scaled only at the end, so the picture is honest: the zone is 17 inches wide,
dots are true baseball diameter (2.9"), and a pitch reads as a strike exactly
when the ball clips the zone.

It is a 2D stand-in. Nothing else depends on it, so the replay engine can
supersede it or run alongside it as a readout.

**Where the numbers come from.** MLB tracks every pitch with Hawk-Eye optical
cameras and publishes the fit in `pitchData`:

| field | meaning |
|-------|---------|
| `coordinates.pX`, `pZ` | plate crossing, in **feet** — this is the dot |
| `strikeZoneTop`, `strikeZoneBottom` | that batter's zone, in feet, measured per pitch |
| `strikeZoneWidth` | 17.0 inches, constant |
| `zone` | MLB's own 1–9 grid, 11–14 for the outside quadrants |

Top and bottom are per batter and, as of 2026, **fixed**: MLB's ABS zone, 53.5%
and 27% of the batter's measured height (league averages 3.20 and 1.62 ft). Over
2,299 pitches in 8 September games every batter had exactly one top/bottom pair
for the whole game. `projection.py` puts that pair on each at-bat as `zone`
{top, bottom, source} — tracked when the batter has seen a pitch, from his
listed height (within 0.3 in) when he has not — so the 3D replay draws his zone
from the moment he steps in rather than a generic one that jumps on the first
pitch. The replay draws it exactly as given; it once padded short zones to 1.3
plate widths tall, which put the bottom edge 1.5 in too low.

**The sign convention was verified, not assumed** — getting it backwards
silently mislabels every pitch. Two independent checks over 12 games:

* 9 of 9 hit-by-pitches to right-handed batters had `pX < 0` (mean −2.00 ft). A
  HBP is by definition on the batter's own side, and a RHB stands on the
  third-base side.
* MLB's own zone grid agrees: zones 1/4/7 average `pX` −0.53 ft, zones 3/6/9
  average +0.51 ft.

So negative `pX` is the third-base side — the catcher's view, looking out toward
the mound. Plotting `pX` straight onto a left-to-right axis matches MLB's zone
numbering, and a right-handed batter appears on the left.

That makes inside/away derivable, and `projection.py` now labels it
("Up and in", "Low and away"). Checked against a full game: RHB "inside" pitches
average −0.85 ft and LHB "inside" +0.69 ft — mirrored, as they must be.

**The dashed box** is the zone widened by one ball radius (0.121 ft). A pitch is
a strike if any part of the ball touches the zone, which is why called strikes
reach |pX| ≈ 0.83 ft — and the data agrees: over 564 called strikes the 95th
percentile was 0.82 ft against a predicted 0.708 + 0.121 = 0.829.

## Landing screen behaviour

* Phase `idle` — static splash. **The login form is not in the DOM**, which keeps
  its controls out of the tab order until revealed.
* Phase `swing` — bat/ball animation, 1060ms, contact at 420ms. The hit is
  scheduled on the Web Audio clock against that same 420ms. `Escape` skips to
  the card.
* Phase `login` — card mounts, focus moves to the email field.
* `prefers-reduced-motion: reduce` skips the animation and sound entirely.
  Settings → Reduce motion → Always forces the same for in-app motion.

The bat sweeps up-left through contact, so the ball leaves back along the path it
arrived on. A ball only departs perpendicular to the bat's long axis — reverse the
swing direction and it reads as a foul ball instead of a hit.

Sign-in is stubbed: any email + password gets in, as does "Continue as guest".
Nothing is fetched until sign-in.

## Contact sounds

`src/audio/crack.js` owns three variants, one per tier of contact, and each is a
real recording under `assets/audios/`, published to `public/audio/`:

| variant | what it is |
|---------|------------|
| `barrel` | flush contact on the sweet spot — the crack |
| `muffled`| solid but off the sweet spot: the energy went into the bat |
| `miffed` | a mishit — jam shot, end of the bat, off the handle |

### The thresholds

Purely exit velocity, in `contactVariantFor()` — the one place tiers are
decided, and the only place to change them:

| exit velocity | variant |
|---------------|---------|
| over 105 mph | `barrel` |
| 90 to 105 mph | `muffled` |
| under 90 mph | `miffed` |

Exactly 105 and exactly 90 fall to the *lower* tier, so "greater than" means
what it says. A foul takes the tier below whatever its exit velocity earned — a
foul is a mishit by definition — and a ball with no tracked exit velocity at all
gets `muffled` rather than claiming a barrel nothing measured.

### How a replay plays one

The engine owns the clock, so it raises the cue; it makes no sound itself and
knows nothing about what a cue turns into.

* `engine.onContact(fn)` fires **once per play**, when playback starts with
  contact still ahead of it, carrying `{ exitVelo, delay }`. `delay` is in real
  seconds — the run-up to contact plays at the fixed `PITCH_RATE` fraction of
  real time, so play-time to wall-time is one division.
* It has to be a cue *before* contact rather than a moment *at* it, because each
  recording has a lead-in before its transient. Handed the delay, the audio
  clock places the crack **on** the frame the bat meets the ball instead of a
  fifth of a second after it.
* Pausing, scrubbing or loading another at-bat **withdraws** the cue (the
  listener is called with `null`) and `playContact`'s return value cancels the
  scheduled hit. A crack with no swing under it is worse than no sound at all.
* `replay/index.js` is the only file that joins the two — it is already the one
  file that knows about the host app. Whether sound is on reaches it as a
  `barrels:sound` DOM event, the same way render quality does. It is always on
  now — the Sound effects setting was taken out — but the event is still sent.

### The numbers, measured from each file

Both numbers in `SAMPLES` are measured off the decoded audio, never assumed, and
both change how a file has to be played:

* **`transientOffsetMs`** — where the hit actually peaks inside the recording.
  Every file has a lead-in. Start it *on* the contact frame and the hit lands
  that much late, so playback starts early by exactly that much.
* **`gain`** — what to multiply the file by. These are quiet recordings, and at
  unity they are inaudible next to everything else.

| variant | peak | peaks at | × gain | → output peak |
|---------|------|----------|--------|---------------|
| `barrel` | 0.041 (−27.7 dBFS) | 338 ms | 22.0 | ~0.90 |
| `muffled`| 0.213 (−13.4 dBFS) | 196 ms | 2.9 | ~0.62 |
| `miffed` | 0.110 (−19.2 dBFS) | 107 ms | 4.1 | ~0.45 |

The gains are deliberately **not** normalised to a common peak. A mishit that
comes out of the speakers as loud as a barrel throws away the one thing the
tiering is for, so each target peak steps down with the tier. Re-measure (decode,
find max `|sample|` and its index) if a file is replaced.

Each variant also keeps a **synthesized** fallback — bat bending modes, a
transient, a body sweep and a thud — used when its recording cannot be fetched
or decoded, so a hit is never silent. The tiers differ there in shape, not just
level: `barrel` is short + bright + weak modes, `muffled` is dull + long + strong
modes, `miffed` is the same again with the last of the brightness gone.

To switch what the intro plays, change `INTRO_CONTACT` at the top of
`src/screens/SplashScreen.jsx`. To compare the three back to back, run
`(await import('/src/audio/crack.js')).playContact('barrel')` (or `'muffled'`,
`'miffed'`) in the browser console under `npm run dev` — Settings used to have
buttons for this.

The bytes are fetched at module load (no AudioContext and no user gesture
needed), and decoded on the first gesture, so the buffer is ready well before
any click. `playContact` pins the target moment on the audio clock immediately,
so even a decode that resolves late schedules against the instant the caller
asked for rather than drifting.

## Theming

Every colour is a custom property in `src/styles/tokens.css`. The dark theme
redefines that same token set under `:root[data-theme='dark']` — no component
names a colour directly, so nothing else needed editing.

Settings → Display & motion → **Dark mode**. It ships **off**, and is
deliberately *not* wired to `prefers-color-scheme`: a media query would override
that default for anyone on a dark OS. `App.jsx` stamps `data-theme` on `<html>`
and sets `color-scheme` so the browser's own form controls and scrollbars follow.

Warm dark rather than grey — espresso and bronze, to answer the light theme's
cream and tan.

### Three things that do not survive a palette flip on their own

* **Transitions freeze on the old theme.** Chrome keeps a transitioned property
  whose value comes from a custom property on its *previous* computed value when
  that property changes underneath it. The variable updates; the rendered colour
  does not. Nav pills kept cream backgrounds on a dark page. `App.jsx` adds a
  `.theme-switching` class that kills transitions for the frame the swap happens
  on, then removes it two frames later. (Same root cause as the scorebug's team
  wash — see the note on `.scoreteam` in `app.css`.)
* **Team ink.** 29 of 30 club primaries are navies, reds and blacks chosen for
  light backgrounds, and fail 4.5:1 on espresso. The generator now emits
  `inkDark` alongside `ink`, falling back to the club's *secondary* where that
  reads — Rays navy becomes their light blue, Pirates black becomes their gold —
  rather than dropping to a generic grey. `teamStyle.js` emits both, and three
  rules in `app.css` pick the dark pair.
* **Labels drawn on filled swatches.** The strike-zone dots fill with `--c-seam`
  and `--c-text`, both of which invert between themes, so a hardcoded white
  numeral vanished in one of them. Those labels are tokens now (`--c-on-seam`,
  `--c-on-warn`).

### Contrast

Audited by walking every visible text node on all three screens, compositing the
real background stack, and measuring against WCAG AA:

| theme | elements | failures |
|-------|----------|----------|
| dark  | 1091 | **1** |
| light | 1074 | 636 |

The single dark failure is the `·` placeholder for innings not yet played —
deliberately faint decoration, not information.

**The light theme's numbers are pre-existing and worth a look.** `--c-text-faint`
(`#a3937f`) sits at **2.44–2.98:1** on cream, well under the 4.5 AA floor, and it
carries real content: at-bat detail lines, pitch-feed timestamps, venue names,
section eyebrows. Dark mode did not cause this and this change does not alter the
light palette. Raising `--c-text-faint` to roughly `#8a7864` would clear AA
without changing the design's character.

## Notes on the data

Field paths were verified against live feeds rather than assumed, including the
three the prototype README flagged as unconfirmed
(`playEvents[].pitchData.startSpeed`, `playEvents[].hitData.*`,
`linescore.offense.{first,second,third}`). Two traps worth knowing:

* `linescore.defense.{first,second,third}` are **fielders**. Only `offense`
  describes who is on base, and the keys are absent when a base is empty.
* GUMBO files advisories (status changes, delays, replay reviews) as plays with
  an `atBatIndex`. `projection.py` filters `game_advisory` out of the at-bat list.
* The hydrated schedule reports `currentInning`/`inningState` for games hours from
  first pitch, so live state is gated on the game actually being live.
* The **boxscore** team object carries only `id`/`link`/`name` — no
  abbreviation. A player card's club mark comes from `gameData.teams` instead.

Player cards show real season stats. Batted-ball figures on the back are
aggregated from the current game's tracked contact and labelled "this game";
the season Statcast block beside them comes from Baseball Savant. Nothing on a
card is estimated — see [Player cards](#player-cards) for what is unavailable
and why it is left blank rather than filled in.

## Still stubbed

* Settings are session-local; no persistence layer.
* The transport bar under the viewport is deliberately disabled — the engine owns
  playback, so the controls are laid out but inert.
* `feed/live/diffPatch?startTimecode=…` would fetch deltas instead of full
  snapshots; we still pull the whole feed each poll.
* Pitch **movement** characteristics (horizontal/vertical break) are not on the
  card yet — one more Savant board, joined the way velocity already is.
* SIERA, and a real command model. Both are explained under
  [Player cards](#player-cards); neither is faked in the meantime.
