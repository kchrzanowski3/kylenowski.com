# Thanksgiving Picks: spec

A family pick'em for the Thanksgiving NFL games at **kylenowski.com/thanksgiving**. Players make picks for each
game before kickoff. Everything is scored automatically from live game data, and a leaderboard updates during
the games.

Status: **spec only, not built yet.**

## Games

Thursday, Nov 26, 2026:

| # | Game | Kickoff (ET) | TV |
|---|---|---|---|
| 1 | Chicago Bears @ Detroit Lions | 1:00 PM | CBS |
| 2 | Philadelphia Eagles @ Dallas Cowboys | 4:30 PM | FOX |
| 3 | Kansas City Chiefs @ Buffalo Bills | 8:20 PM | NBC |

Games, teams and kickoff times come from the live data feed, not from this table, so a schedule change is picked
up automatically.

## Players

- **Joining:** type a name, and optionally set a **4-digit PIN**.
- **Logging in on any device:** pick your name from the list of players. If that name has a PIN, enter it.
- Low-stakes on purpose: easy sign-in matters more than strong security. Names without a PIN can be picked by
  anyone.
- The admin can rename players, remove players and reset PINs.

## Questions (the same 15 for every game)

| # | Question | Answer | Points |
|---|---|---|---|
| 1 | **Final score** | away score, home score (can't be a tie) | **3** closest · **+1** correct winner · **+1** within 15 |
| 2 | **Which team scores first?** | team | 1 |
| 3 | **How is the first score made?** | TD / FG / safety | 1 for TD or FG · **5 for safety** |
| 4 | **First TD scorer** | player from a list, "Other player", or "No TD" | 3 |
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
- **Overtime counts** toward every stat (score, TDs, punts, sacks and so on).
- **Total touchdowns** includes defensive and special-teams TDs.
- **Turnovers** are interceptions plus lost fumbles. Turnovers on downs don't count.
- **Missed kick** means any missed or blocked extra point or field goal. A failed 2-point try doesn't count.
- **Lead change in the 4th quarter:** **yes** if, at any point in the 4th quarter, a team goes ahead when it was
  tied or behind just before that play. Going from tied to ahead counts. Overtime doesn't count, since it isn't
  the 4th quarter.
- **First TD scorer:** the list has each team's QBs, RBs, WRs and TEs. "Other player" covers anyone else,
  including defensive, special-teams and lineman TDs. "No TD" wins only if the game has no touchdown.
- **No touchdown in the game:** longest TD = 0, and the first-TD-scorer answer is "No TD".

### Locking and reveal

- Picks for a game can be made and edited until **that game's kickoff**, then they lock. Each game locks
  separately, so someone who shows up late can still play the night game.
- Other players' picks are **hidden until kickoff**, then shown to everyone side by side.
- A player who skips a question gets 0 for it. A player who skips a whole game can still win overall.

## Help shown while picking

- **Vegas projected score** for each game, worked out from the betting line:
  favorite = (over/under + spread) ÷ 2, underdog = (over/under − spread) ÷ 2.
  For example, DAL −3.5 with O/U 47.5 projects DAL 25.5 – PHI 22. It uses the line from the data feed, updates
  until kickoff, then freezes.
- **Reference averages** next to every number question (field goals, punts, TDs, turnovers, longest TD, sacks,
  and points for the final score): the NFL per-game average **and each team's per-game average this season**.
  These are calculated from real 2026 game data shortly before Thanksgiving, not entered by hand.

## Standings

### Overall (default view)
- One **running total across all 3 games**.
- **Tiebreaker for the overall champion:** whoever's game 3 final-score guess (away + home) is closest to that
  game's actual total points. No extra question needed.
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

Plus each player's points for that game, and that game's winner once it's over.

### Live scoring
- During a game, standings count **projected points**: each category is scored as if the game ended right
  now. Projected points look different from final ones, and a category becomes final as soon as its answer
  can't change any more (see the Status column).
- Updates aim to reach phones **within about a minute** of a play.

## Admin (only Kyle)

- At `/thanksgiving/admin`, **signed in with Kyle's Google account**. No other account can open it. The admin
  identity is set in configuration, not committed to this public repo.
- **Fix any stat or result.** An override wins over the live feed, and the screen shows both the feed value and
  the override.
- **Pause the automatic feed** for a game, or re-run scoring.
- **Players:** rename, remove, or reset a PIN.
- **Adjust a kickoff/lock time** if the schedule changes.
- Every admin change is logged with a timestamp.

## Data

- **Live data:** ESPN's public scoreboard and game-summary feeds (free, no key). They provide the schedule,
  live score, quarter-by-quarter scores, scoring plays (first score, first TD scorer, longest TD, 4th-quarter
  lead changes), team stats (TDs, turnovers, sacks, field goals), kicking (missed kicks), drive results
  (punts), rosters, and the betting line.
  - These feeds are **unofficial** and could change, so the admin override is the backup.
  - **Before the games:** check every derived stat against a completed 2026 game's box score.

## How it's built (summary)

- **Page:** `/thanksgiving` is a static Astro page with a React app inside it, served by Firebase Hosting.
- **Data:** Firestore. Phones subscribe to the game and standings data, so the leaderboard updates live with
  no refresh.
- **Sign-in:** Firebase Auth. Players get an anonymous session linked to their name; the admin signs in with
  Google.
- **Live updates:** a Cloud Run job, started by Cloud Scheduler every minute during game windows, reads the ESPN
  feed, works out the stats, scores every player, and writes the results to Firestore. All scoring happens on
  the server, not on phones.
- **Firestore rules:**
  - Players can only write their own picks, and only before that game's kickoff.
  - Other players' picks can only be read after kickoff.
  - Only the admin can write overrides.
- **All of it is managed by Terraform** in `infra/` and goes through the usual PR workflow.
- **CSP:** the page's Content-Security-Policy has to allow the Firebase/Firestore hosts the app talks to.

## Open questions

1. **Wednesday and Friday games:** the 2026 slate also has Packers @ Rams (Wed, Nov 25, 8:00 PM ET) and Broncos
   @ Steelers (Fri, Nov 27, 3:00 PM ET). Should either be included, or just the three Thursday games?
