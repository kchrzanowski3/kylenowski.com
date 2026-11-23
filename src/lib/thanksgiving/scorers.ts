// The first-TD-scorer list (docs/thanksgiving-spec.md, scoring rules, "First TD scorer"):
// per team, from the depth chart, the top 2 QBs, top 2 RBs, the 3 starting WRs and the starting TE.
// Players ruled out (or on injured reserve, or not on the active roster) are left off, and the next
// player on the depth chart takes the spot. Admin edits win over all of this.

import { athleteIdFromRef } from './espn';
import type { ScorerEdits, ScorerOption, ScorerPosition, Side } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export interface RosterPlayer {
  id: string;
  name: string;
  pos: string;
  available: boolean;
}

const UNAVAILABLE_INJURY = /^(out|injured reserve|suspended|physically unable to perform|pup|non-football injury)/i;

/** Flattens a team roster feed into players, marking who is ruled out or not active. */
export function parseRoster(roster: Json): RosterPlayer[] {
  const out: RosterPlayer[] = [];
  for (const group of roster?.athletes ?? []) {
    for (const a of group?.items ?? []) {
      const injured = (a?.injuries ?? []).some((i: Json) => UNAVAILABLE_INJURY.test(String(i?.status ?? '')));
      const active = (a?.status?.type ?? 'active') === 'active';
      out.push({
        id: String(a.id),
        name: String(a.displayName ?? a.fullName ?? ''),
        pos: String(a?.position?.abbreviation ?? ''),
        available: active && !injured,
      });
    }
  }
  return out;
}

interface DepthEntry {
  id: string;
  rank: number;
  slot: number;
}

/** Depth entries for one position, from the offense formation of a depth-chart feed. */
function depth(chart: Json, pos: string): DepthEntry[] {
  const offense = (chart?.items ?? []).find((i: Json) => i?.positions?.qb && i?.positions?.wr) ?? chart?.items?.[0];
  const entries: DepthEntry[] = [];
  for (const a of offense?.positions?.[pos]?.athletes ?? []) {
    const id = athleteIdFromRef(a?.athlete?.$ref ?? '');
    if (!id) continue;
    entries.push({ id, rank: Number(a.rank ?? 99), slot: Number(a.slot ?? 0) });
  }
  return entries.sort((x, y) => x.rank - y.rank);
}

const PICKS: { pos: ScorerPosition; key: string; count: number }[] = [
  { pos: 'QB', key: 'qb', count: 2 },
  { pos: 'RB', key: 'rb', count: 2 },
  { pos: 'WR', key: 'wr', count: 3 },
  { pos: 'TE', key: 'te', count: 1 },
];

export function buildScorerOptions(chart: Json, roster: RosterPlayer[], side: Side): ScorerOption[] {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const out: ScorerOption[] = [];
  for (const { pos, key, count } of PICKS) {
    // Healthy players in depth-chart order. For WRs, ESPN lists several per slot (WR1/WR2/WR3);
    // after dropping unavailable players, the best-ranked player in each slot starts there, then
    // anyone left fills an empty slot.
    const healthy = depth(chart, key).filter((e) => byId.get(e.id)?.available);
    let chosen: DepthEntry[];
    if (key === 'wr') {
      const starters: DepthEntry[] = [];
      const seenSlots = new Set<number>();
      for (const e of healthy) {
        if (!seenSlots.has(e.slot)) {
          seenSlots.add(e.slot);
          starters.push(e);
        }
      }
      const rest = healthy.filter((e) => !starters.includes(e));
      chosen = [...starters.slice(0, count), ...rest].slice(0, count);
    } else {
      chosen = healthy.slice(0, count);
    }
    for (const e of chosen) {
      if (out.some((o) => o.id === e.id)) continue;
      out.push({ id: e.id, name: byId.get(e.id)!.name, pos, side });
    }
  }
  return out;
}

/** Applies the admin's edits on top of a freshly built list. */
export function applyScorerEdits(list: ScorerOption[], edits: ScorerEdits | null | undefined): ScorerOption[] {
  if (!edits) return list;
  const removed = new Set(edits.removed);
  const out = list.filter((p) => !removed.has(p.id));
  for (const p of edits.added) {
    if (!removed.has(p.id) && !out.some((o) => o.id === p.id)) out.push(p);
  }
  return out;
}

/** Whether a first-TD-scorer pick can still score (players dropped from the list can't). */
export function scorerPickCounts(pick: string, list: ScorerOption[]): boolean {
  return pick === 'other' || pick === 'none' || list.some((p) => p.id === pick);
}
