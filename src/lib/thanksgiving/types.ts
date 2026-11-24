// Shapes shared by the page, the server functions and the tests.
// Firestore layout (see firestore.rules):
//   tgGames/{espnEventId}                 GameDoc       public
//   tgGames/{espnEventId}/picks/{player}  PickDoc       own pick always; everyone's after kickoff
//   tgPlayers/{playerId}                  PlayerDoc     public
//   tgMeta/{doc}                          refresh info  public
//   tgSecrets/{playerId}, tgNames/{key}, tgSeasonGames/{espnEventId}   server only
// The test contest has the same layout under the tgTest prefix (tgTestGames, ...; config.ts).

export type Side = 'away' | 'home';
export type SideOrTie = Side | 'tie';

export interface TeamInfo {
  id: string;
  abbr: string;
  name: string; // "Detroit Lions"
  shortName: string; // "Lions"
  color: string | null; // hex without '#'
}

/** The betting line, as published by the feed. */
export interface Line {
  /** Which side is favored, or null for a pick'em. */
  favorite: Side | null;
  /** Points the favorite is giving (always >= 0). */
  spread: number;
  overUnder: number;
  /** The feed's own text, for example "DAL -8.5". */
  details: string;
}

export interface Projection {
  away: number;
  home: number;
}

export type ScorerPosition = 'QB' | 'RB' | 'WR' | 'TE';

export interface ScorerOption {
  id: string; // ESPN athlete id
  name: string;
  pos: ScorerPosition;
  side: Side;
}

/** Admin edits to a game's first-TD-scorer list. They win over the pre-game refresh. */
export interface ScorerEdits {
  added: ScorerOption[];
  removed: string[]; // athlete ids
}

/** One team's own per-game averages this season (or the NFL average per team per game). */
export interface TeamAverages {
  games: number;
  points: number;
  fgs: number;
  punts: number;
  tds: number;
  turnovers: number;
  sacks: number;
  longestTd: number;
}

/** One team's own numbers in one game, derived from the feed's box score. */
export interface TeamGameStats {
  points: number;
  fgs: number;
  punts: number;
  tds: number;
  turnovers: number;
  sacks: number; // made by this team's defense
  longestTd: number; // 0 if it scored no TD
}
