# Thanksgiving Picks: spec

A family pick'em for the Thanksgiving NFL games at **kylenowski.com/thanksgiving**. Players make picks for each
game before kickoff. Everything is scored automatically from live game data, and a leaderboard updates during
the games.

Status: **built** (PR 1: picks; PR 2: game day). See "Build order".

## Games

Thursday, Nov 26, 2026:

| # | Game | Kickoff (ET) | TV |
|---|---|---|---|
| 1 | Chicago Bears @ Detroit Lions | 1:00 PM | CBS |
| 2 | Philadelphia Eagles @ Dallas Cowboys | 4:30 PM | FOX |
| 3 | Kansas City Chiefs @ Buffalo Bills | 8:20 PM | NBC |

Only the Thursday games count. The Wednesday (Packers @ Rams) and Friday (Broncos @ Steelers) games are not
part of the contest.

Games, teams and kickoff times come from the live data feed, not from this table, so a schedule change is picked
up automatically. The contest's games are every game on its ESPN scoreboard dates (20261126; until Thursday
morning also the practice games, see "Practice games") whose kickoff falls on its ET days, numbered by kickoff.
"The last game" below is game 3, KC @ BUF.

## Players

- **Joining:** type a name, and optionally set a **4-digit PIN**. Names are unique, ignoring case ("kyle" and
  "Kyle" can't both join). Joining closes at the last game's kickoff (game 3), since there's nothing left to pick.
- **Logging in on any device:** pick your name from the list of players. If that name has a PIN, enter it. The
  PIN is checked by the sign-in service (see "How it's built"), which limits wrong guesses so a PIN can't be
  found by trying all 10,000.
- **Adding a PIN later:** a signed-in player can add or change their own PIN at any time.
- Low-stakes on purpose: easy sign-in matters more than strong security. Names without a PIN can be picked by
  anyone.
- The admin can rename players, remove players and reset PINs. Removing a player deletes their picks and
  points.
- **No account needed to watch:** anyone with the link can see the standings, and everyone's picks for a game
  once it has kicked off.

## Questions (the same 15 for every game)

| # | Question | Answer | Points |
|---|---|---|---|
| 1 | **Final score** | away score, home score (can't be a tie) | **3** closest · **+1** correct winner · **+1** within 15 |
| 2 | **Which team scores first?** | team | 1 |
| 3 | **How is the first score made?** | TD / FG / safety | 1 for TD or FG · **5 for safety** |
| 4 | **First TD scorer** | player from the list, "Other player", or "No TD" | 3 |
| 5 | **Who's leading at halftime?** | team / tied | 1 |
| 6 | **Which team has more passing TDs?** | team / tie | 1 |
| 7 | **Which team has more rushing TDs?** | team / tie | 1 |
| 8 | **Missed extra point or field goal?** | yes / no | 1 |
| 9 | **Lead change in the 4th quarter?** | yes / no | 1 |
| 10 | **Total field goals made** (both teams) | number | 3 closest |
| 11 | **Total punts** (both teams) | number | 3 closest |
| 12 | **Total touchdowns** (both teams) | number | 3 closest |
| 13 | **Combined turnovers** | number | 3 closest |
| 14 | **Yards on the longest TD** | number | 3 closest |
| 15 | **Combined sacks** | number | 3 closest |

The most anyone can score in one game is **37**, if they pick a safety correctly (33 otherwise).

### Scoring rules

- **"Closest" questions:** the guess with the smallest absolute difference from the actual number wins the
  points. Only the closest guess scores. **If several guesses are equally close, each of them gets the full
  points.**
- **Final score:**
  - *Closest*: the distance is |away guess − away actual| + |home guess − home actual|, and the smallest
    distance wins 3 (ties as above).
  - *Correct winner*: +1 to everyone whose guess has the winning team ahead. If the game ends in a tie, nobody
    gets this point.
  - *Within 15*: +1 to everyone whose distance is ≤ 15.
- **The official box score decides** what each stat counts (for example blocked punts, aborted kicks, or plays
  wiped out by a penalty). The derived stats are tested against official box scores (see "Testing").
- **Overtime counts** toward every stat (score, TDs, punts, sacks and so on).
- **Total touchdowns** includes defensive and special-teams TDs.
- **Turnovers** are interceptions plus lost fumbles. Turnovers on downs don't count.
- **Missed kick** means any missed or blocked extra point or field goal. A failed 2-point try doesn't count.
- **Lead change in the 4th quarter:** **yes** if, at any point in the 4th quarter, a team goes ahead when it was
  tied or behind just before that play. Going from tied to ahead counts. Overtime doesn't count, since it isn't
  the 4th quarter.
- **First TD scorer:** the list has the players most likely to score, for each team, from ESPN's depth chart:
  - the top 2 QBs
  - the top 2 RBs
  - the starting WRs (the 3 WR slots)
  - the starting TE

  Players ruled out or listed inactive drop off the list when the feed reports it. A pick already made on such
  a player stays, but won't score. A listed player who scores **any** kind of TD (receiving, rushing, or a
  kick, punt or fumble return) counts as that player. **"Other player"** covers everyone not on the list:
  backups, defensive players, special-teams players and linemen. "No TD" wins only if the game has no
  touchdown.
- **Longest TD** counts every kind of TD, including defensive and return TDs.
- **No score in the game (0–0):** nobody gets the points for "which team scores first" or "how is the first
  score made".
- **No touchdown in the game:** longest TD = 0, and the first-TD-scorer answer is "No TD".

### Locking and reveal

- Picks for a game can be made and edited until **that game's kickoff**, then they lock. Each game locks
  separately, so someone who shows up late can still play the night game.
- The lock time is the **scheduled kickoff** stored in Firestore (from the feed, or as adjusted by the admin),
  checked against the server's clock. It doesn't wait for ESPN to show the game as started.
- **A lock never reopens.** Once a game's lock time has passed, moving its kickoff later (by the feed or by the
  admin) doesn't reopen picks, since everyone's picks have already been revealed.
- Other players' picks are **hidden until kickoff**. From kickoff anyone can choose a player from a list and see
  that player's picks for the game (see "Page layout").
- A player who skips a question gets 0 for it. A player who skips a whole game can still win overall.

## Help shown while picking

- **Vegas projected score** for each game, shown with the final-score question (for example "Vegas projects
  DAL 25.5 – PHI 22 (DAL -3.5, O/U 47.5)"), worked out from the betting line:
  favorite = (over/under + spread) ÷ 2, underdog = (over/under − spread) ÷ 2.
  For example, DAL −3.5 with O/U 47.5 projects DAL 25.5 – PHI 22. It uses the line from the data feed,
  refreshes on the pre-game schedule (see "Pre-game refresh"), and freezes at kickoff.
- **Reference averages** under the number questions: the **NFL average per game** this season. The questions
  ask for both teams combined, so for field goals, punts, TDs, turnovers and sacks it's twice the NFL average
  per team (for example "NFL average 8.1 per game"). A game's longest TD is the longer of the two teams', not
  their sum, so that one shows the NFL average per team ("NFL team average longest TD: 31.5 yards"). The final
  score shows the Vegas projection instead of an average. (Each team's own averages are still worked out, but
  not shown: they don't differ much from the NFL's.) Per team, the averages count:
  - points: points it scored
  - field goals: field goals it made
  - punts: its punts
  - TDs: TDs it scored, of every kind
  - turnovers: turnovers it committed (interceptions thrown plus fumbles lost)
  - sacks: sacks made by its defense
  - longest TD: its longest TD in each game, averaged (a game where it scored no TD counts as 0)

  These are calculated from real 2026 game data shortly before Thanksgiving, not entered by hand.

## Standings

### Overall (default view)
- Shown at the top of `/thanksgiving` as soon as the first game kicks off.
- One **running total across all 3 games**.
- **Tiebreaker for the overall champion:** whoever's final-score guess (away + home) for the last game (game 3)
  is closest to that game's actual total points. No extra question needed. If that's still tied (equally close,
  or the tied players didn't pick the last game's final score), they're **co-champions**.
- Expand a player to see their points per game.

### Per-game scoreboard
One view per game, with a row for **each way to score points**:

| Category | Worth | Current leader(s) or who's right | Status |
|---|---|---|---|
| Final score: closest | 3 | names | live / final |
| Final score: correct winner | 1 each | names | live / final |
| Final score: within 15 | 1 each | names | live / final |
| First team to score | 1 | names | final once anyone scores |
| How the first score was made | 1 (5 for safety) | names | final once anyone scores |
| First TD scorer | 3 | names | final after the first TD |
| Halftime leader | 1 | names | final at halftime |
| More passing TDs | 1 | names | live / final |
| More rushing TDs | 1 | names | live / final |
| Missed XP or FG | 1 | names | final once "yes" happens, otherwise at the end of the game |
| 4th-quarter lead change | 1 | names | final once "yes" happens, otherwise at the end of the game |
| Total FGs made | 3 | names | live / final |
| Total punts | 3 | names | live / final |
| Total TDs | 3 | names | live / final |
| Combined turnovers | 3 | names | live / final |
| Longest TD yards | 3 | names | live / final |
| Combined sacks | 3 | names | live / final |

Plus that game's winner once it's over: the most points in that game, with ties as **co-winners** (no
tiebreaker). Each player's points for the game are shown with their picks (see "Page layout").

### Page layout
Kept light on text: the page shows state with icons, not instructions.
- **Account menu:** once signed in, a round icon with your initial, top right next to the heading, opens a menu
  with your name, "Add a PIN" / "Change PIN" and "Switch player". Signed out, the sign-in card is on the page.
- **Game tabs**, one per game in kickoff order, each with both teams' logos (from ESPN), the matchup, and a lock:
  an **open lock** while the game is open for picks, a **green lock** from kickoff while it's being played, and a
  **grey lock** once it's final. Signed in, each tab also has a **progress bar** of how many of the 15 questions
  you've answered for that game (full: green).
- **Which game opens:** the game being played, else the next game to kick off, else the last game. The page
  follows along as games kick off until you choose a tab yourself.
- **Game header:** logos and team names ("Bengals @ Commanders"); once the game is under way the score sits
  between the names ("Bengals 10 – 7 Commanders") with the clock ("Q2 1:55", "Final") below. Then a chip with
  the lock and the time left until kickoff ("Locked" while it's on, "Final" once it's over), the kickoff time
  and TV. The pick form starts with the points each question is worth, spelled out ("1 point", "3 points
  (closest pick wins)").
- **Picks, from kickoff:** a list of players: you first whenever you're signed in (even with no picks for the
  game: "No picks for this game"), then everyone who made picks. It starts on you; signed out, on the game's
  leader. It shows the chosen player's 15 answers with the points each is earning and their total for the game.
  An answer earning points is tinted green; one that's settled (every category behind it final) with no points
  for that player, including a skipped question, is greyed out and struck through.
- **Who's getting points this game:** the per-game scoreboard as a compact list under the picks, one row per
  category: a short name ("Punts", "Closest score"), its worth as a badge ("3 pts", "1 pt", "1/5 pts"), the
  value so far, who's right as a count ("Ann", "You", "You + 2", "6 players") and a mark: a green check once the
  category is final, a grey hollow circle while it could still change. Rows where you're right are tinted green. Tapping a row
  shows the full category name, worth, value, the names of who's right and the status.
- **Overall standings:** a pulsing green dot while points are projected (live); projected points also look different from
  final ones. A chevron on each row opens that player's points per game.

### Live scoring
- During a game, standings count **projected points**: each category is scored as if the game ended right
  now. Projected points look different from final ones, and a category becomes final as soon as its answer
  can't change any more (see the Status column).
- Updates reach phones about **15–45 seconds after the ESPN feed** (see "Live updates" below).

## Admin (only Kyle)

- At `/thanksgiving/admin`, **signed in with an emailed sign-in link sent to Kyle's email address**. No other
  account can open it. The admin email address is set in configuration, not committed to this public repo.
- **Kyle plays too**, as a regular player under a player name. The admin sign-in is separate from that, and
  being the admin gives no early look at anyone's picks (see "No peeking").
- **Fix any stat or result.** An override wins over the live feed, and the screen shows both the feed value and
  the override.
- **Pause the automatic feed** for a game, or re-run scoring.
- **Spoiler delay:** set how many seconds (0–180) live updates are held back before players see them. It
  starts at **0** and takes effect immediately. The admin screen always shows the live values, without the
  delay.
- **No peeking:** before a game kicks off, the admin screen **can't show other players' picks** for that game,
  the same as every other player's view. After kickoff it shows everything.
- **Players:** rename, remove, or reset a PIN.
- **Edit the first-TD-scorer list** for a game before its kickoff: add or remove a player, in case ESPN's depth
  chart is out of date. The admin's edits win over the pre-game refresh, which won't undo them. A pick already
  made on a removed player stays, but won't score (as with inactive players).
- **Adjust a kickoff/lock time** if the schedule changes. A lock time that has already passed can't be moved
  later (see "Locking and reveal").
- Every admin change is logged with a timestamp.

## Data

- **Live data:** ESPN's public scoreboard and game-summary feeds (free, no key). They provide the schedule,
  live score, quarter-by-quarter scores, scoring plays (first score, first TD scorer, longest TD, 4th-quarter
  lead changes), team stats (TDs, turnovers, sacks, field goals), kicking (missed kicks), drive results
  (punts), rosters, depth charts, injuries and inactives, and the betting line.
  - These feeds are **unofficial** and could change, so the admin override is the backup.
  - **Before the games:** check every derived stat against a completed 2026 game's box score.

## How it's built (summary)

- **Page:** `/thanksgiving` is a static Astro page with a React app inside it, served by Firebase Hosting.
- **Data:** Firestore. Phones subscribe to the game and standings data, so the leaderboard updates live with
  no refresh.
- **Sign-in:** Firebase Auth.
  - **Players:** a small **sign-in service** (`tg-auth`, a Cloud Function, 2nd gen, which runs on Cloud Run)
    handles joining and logging in. It checks the name
    and PIN (PINs are stored hashed and never readable by phones), limits wrong PIN guesses, and returns a
    Firebase sign-in token for that player. This is what lets the same player sign in on a second device.
  - **Admin:** signs in with an **emailed sign-in link** (Firebase's passwordless email sign-in), which
    Terraform can set up entirely, with no manual steps. Kyle's email address is kept in a GitHub secret,
    passed to Terraform as a sensitive variable and inserted into the Firestore rules when they're deployed,
    so it's never committed or shown in a PR's plan output. The rules accept only that address, and only
    once it's verified (which clicking the emailed link does).
- **Admin changes:** the admin screen makes every change through a small admin service (`tg-admin`, a Cloud
  Function) that accepts only the admin's verified email. Browsers never write game data directly. The admin
  service creates the admin's account up front, so nobody else can register that address with a password.
- **Re-scoring after an admin fix:** saving an override calls the admin service, which runs scoring
  once.
- **Live updates:** see "Live updates" below. All scoring happens on the server, not on phones.
- **Firestore rules:**
  - Players can only write their own picks, and only before that game's kickoff.
  - Other players' picks can only be read after kickoff.
  - Only the admin can write overrides or change the spoiler delay.
  - PINs and the player-to-account link are written only by the sign-in service.
  - Standings, the player list and (after kickoff) picks can be read without signing in.
- **All of it is managed by Terraform** in `infra/` and goes through the usual PR workflow.
- **CSP:** the page's Content-Security-Policy has to allow the Firebase/Firestore hosts the app talks to.

## Pre-game refresh

A Cloud Function (`tg-refresh`), called by Cloud Scheduler, refreshes everything shown before kickoff (CI also
runs it once after each deploy):

- the betting line (spread and over/under) and the Vegas projected score
- kickoff and lock times, in case the schedule changes
- the first-TD-scorer player lists, from current depth charts and inactives (keeping the admin's edits)
- the reference averages

Schedule:

| When | How often |
|---|---|
| From launch through Wednesday, Nov 25 | daily at 9:00 AM ET |
| Thursday, Nov 26, until 12:00 PM ET | hourly |
| Thursday from 12:00 PM ET | done by the live worker once a minute (each scheduled call) until each game's kickoff |

A game's line and player list freeze at its kickoff.

## Live updates

ESPN's feed has no push or webhooks, and paid sports-data push feeds are enterprise-priced, so the server
polls. The path from the database to phones is push.

```
ESPN feed --poll ~15s--> live worker (tg-live) --write only on change--> Firestore ==push==> phones
```

- **Game window:** **Thursday, Nov 26, 12:00 PM ET** (an hour before the first kickoff) to **midnight ET**.
- **Worker:** a Cloud Function (`tg-live`) that Cloud Scheduler calls **every minute** during the window.
  - Each call polls the ESPN scoreboard and the summaries of in-progress games about every 15 seconds for just
    under a minute, recomputes the stats and scores, and writes to Firestore **only when something changed**.
  - A lease in Firestore keeps calls from overlapping. A call that fails is simply followed by the next
    minute's call, so there's no long-running job and no separate watchdog to restart one.
  - Calls continue the whole window, even after all 3 games are final, so late stat corrections from ESPN
    still get picked up.
  - The first TD's scorer is identified by ESPN athlete id from the play's "scorer" participant (looked up
    once per play); the name in the play text is the fallback.
  - The admin screen shows "last update N seconds ago".
- **Outside the window:** nothing runs. Admin fixes still re-score immediately, because saving an override
  triggers a one-off scoring run.
- **Spoiler delay:** the worker computes results right away but holds each update for the admin-set delay
  (default 0 seconds) before publishing it to what players see.
- **Phones:** listen to Firestore, so changes appear within about a second of being written, with no refresh.
- **Overall delay:** about 15–45 seconds behind the ESPN feed, which itself runs slightly behind the live
  broadcast.
- **What the admin sees vs players:** the newest feed values (`tgLive`) are readable only by the admin. Players
  read the published results (`tgResults`, `tgStandings`), which apply the spoiler delay and the admin's
  overrides.
- **Cost:** about 12 hours (noon to midnight ET) of one small function on game day, plus the small sign-in and
  admin services. Around free-tier levels; small overages are fine.

## Testing

Tests are written alongside the code and run in CI on every PR (a `test` job next to `build`, `infra` and
`hosting`). A PR doesn't merge unless they pass.

1. **Scoring rules (Vitest).** Scoring is a pure function: game data + picks → points. **Every rule in this spec
   has at least one test**, including the edge cases:
   - equal-distance ties for "closest" (everyone tied gets full points)
   - final score: closest distance, the correct-winner point, the ≤ 15 window (exactly 15 counts, 16 doesn't),
     and a tie game (nobody gets the winner point)
   - first score made by safety (5 points) vs TD/FG (1)
   - "No TD" and longest TD = 0 in a game without a touchdown
   - overtime counted in stats, but not for the 4th-quarter lead change
   - a lead change from tied to ahead counts; one team extending its lead doesn't
   - missed kicks include blocked kicks but not failed 2-point tries
   - turnovers exclude turnovers on downs
   - projected (live) vs final status for each category
   - the overall tiebreaker (closest total points in the last game: game 3, or game 5 while the practice games
     are on), and co-champions when that's still tied
   - per-game co-winners when players tie on points
   - a 0–0 game (nobody gets "scores first" or "how the first score was made")
   - first TD scorer: a listed player's return TD counts as that player; an unlisted player's TD counts as
     "Other player"
   - longest TD includes defensive and return TDs
   - the Vegas projection formula
2. **Recorded real games.** ESPN data from several completed 2026 games is saved as test fixtures (ideally
   including an overtime game and a game with a safety). Tests check that every derived stat matches the official
   box score. They run offline, so a feed change can't break them, and they guard against misreading the feed.
3. **Firestore security rules**, tested in the Firebase emulator:
   - players can write only their own picks, and only before kickoff
   - other players' picks can't be read before kickoff, including from the admin screen
   - only the admin can write overrides, change the spoiler delay or edit the first-TD-scorer list
   - the admin is only the configured email address, and only once it's verified
   - PIN-protected names can't be taken over without the PIN
   - clients can't change a game, so they can't move a kickoff to reopen picks (the pre-game refresh never
     moves a kickoff that has passed; that's tested with the refresh, below)
   - standings, the player list and revealed picks are readable without signing in; PINs never are
4. **Sign-in service (Vitest):** joining with a name already taken (ignoring case) is refused; a wrong PIN is
   refused and repeated wrong guesses are slowed down; a right PIN signs in on a new device; players can add
   or change their own PIN; joining closes at the last game's kickoff.
5. **First-TD-scorer list:** built from a recorded depth chart, it has each team's top 2 QBs, top 2 RBs, 3
   starting WRs and starting TE, and drops players ruled out or inactive. Run against recorded feeds, the
   pre-game refresh writes the games, lines, projections and averages, and leaves a game that has kicked off
   untouched (its lock never reopens). The admin's added and removed
   players survive a pre-game refresh, and a pick on a removed player doesn't score.
6. **End-to-end (Playwright, against the emulators):** join → make picks → kickoff locks picks → picks are
   revealed → a simulated scoring update moves the leaderboard.
7. **Before Thursday:** run the full worker against a recorded game replayed at speed, and check the standings
   it produces against a hand-worked result.

Before merging, PRs also get the built-in `/code-review`, plus `/security-review` for anything touching
sign-in or Firestore rules.

8. **Practice games** (see "Practice games"): until 6:00 AM ET Thursday the contest has the Mon/Wed games
   and the Thursday games, numbered by kickoff, and the live worker polls all three scoreboards; Test1–Test10
   are created once, without PINs; their seed picks are valid, complete, stable, only for the practice games,
   made once, never replace a person's picks, and are scored; the live worker's per-minute refresh seeds and
   removes nothing; from 6:00 AM Thursday the contest is Thursday only, and the next scheduled refresh removes
   the practice games (picks, live values, overrides, results) and Test1–Test10 (with all their picks, Thursday's
   too), keeps real players with their PINs and Thursday picks, renumbers Thursday's games 1–3, clears the
   standings, and removes nothing more on later runs.

## Practice games

To try the game with real NFL games before Thanksgiving, the real page runs a practice until Thursday morning.
Everything below is removed by itself at 6:00 AM ET Thursday, and the practice code comes out after Thursday.

- **Games:** until 6:00 AM ET Thursday, the contest's scoreboard dates are 20261123, 20261125 and 20261126,
  so `/thanksgiving` also shows Monday's CIN @ WSH (8:15 PM ET) and Wednesday's GB @ LAR (8:00 PM ET), before
  the three Thursday games. They're numbered by kickoff (the Thursday games are 3–5 until then), and all the
  rules above apply to them; "the last game" is still KC @ BUF.
- **Practice players:** **Test1** through **Test10**, without PINs, created by the scheduled pre-game refresh if
  they're missing (anyone can pick one). Anyone can also join with their own name, as usual.
- **Seed picks:** the same refresh gives each practice player a full, valid set of answers (varied, and the same
  every time for a player and game) for each practice game they have no picks for, including one that has
  already kicked off, so the scoring and leaderboard have players to show. Picks someone made while signed in as
  a practice player are never replaced. Thursday's games never get seed picks.
- **Schedules (ET):** the pre-game refresh also runs hourly on Nov 23 and 25. The live worker also runs every
  minute from 1 hour before each practice kickoff until 1:00 AM (Mon 7:15 PM–Tue 12:59 AM; Wed 7:00 PM–Thu
  12:59 AM).
- **The end of the practice:** at 6:00 AM ET Thursday the contest becomes Thursday only, and the next scheduled
  pre-game refresh (6:00 AM) removes:
  - the Mon/Wed games, with all their picks, live values, overrides and results;
  - Test1–Test10, with all their picks (Thursday's too);
  - the standings, which the live worker publishes again from Thursday's games.

  Real players are kept, with their PINs and their Thursday picks; their practice picks go with the practice
  games. Thursday's games become games 1–3 again.

## Build order

Two PRs, so picks can open on time:

1. **Picks (live by Wednesday, Nov 25):** the test setup (`npm test`, the CI `test` job, the Firebase
   emulator), joining and logging in (including the sign-in service), making picks, locking, revealing picks
   at kickoff, and the help shown while picking (Vegas projection, reference averages, the pre-game refresh).
2. **Game day (live before 1:00 PM ET Thursday):** the live worker and watchdog, scoring, live standings, the
   spoiler delay, and the admin screen.

## Launch and afterwards

- **Picks open** as soon as the page goes live (target: Wednesday, Nov 25), and stay open for each game until
  its kickoff.
- **Sharing:** share the link `kylenowski.com/thanksgiving` with the family. Search engines are asked not to
  index the page (`noindex`).
- **After Thanksgiving:** the page stays up as a read-only results archive. No new players or picks.
