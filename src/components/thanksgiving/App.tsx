import type { User } from 'firebase/auth';
import { collection, doc, onSnapshot, orderBy, query } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDemoAlerts,
  detectStandingsChange,
  diffSnapshotAlerts,
  improvedRankIds,
  toMobileAlert,
  type GameAlert,
  type MobileAlert,
} from '../../lib/thanksgiving/alerts';
import { getClients, switchPlayer, watchUser, type Clients } from '../../lib/thanksgiving/client';
import { QUESTION_COUNT, answeredCount, type Answers } from '../../lib/thanksgiving/questions';
import type { CategoryKey, Standings as StandingsData } from '../../lib/thanksgiving/scoring';
import { autoGameId, gamePhase, lockedPoints, lockedPointsByGame, toGame, type Game, type Player } from '../../lib/thanksgiving/view';
import { MobileAlertToast, RecentUpdatesStrip } from './Alerts';
import { TvView } from './TvView';
import { AccountMenu } from './AccountMenu';
import { CloseIcon, PhaseBadge, TeamLogo } from './icons';
import { RulesModal } from './RulesModal';
import type { GameResult } from './Scoreboard';
import { Standings } from './Standings';
import { GamePanel } from './GamePanel';
import { SignIn } from './SignIn';

const FLASH_DURATION_MS = 4500;
const MOBILE_TOAST_MS = 7500;
const RECENT_UPDATES_MAX = 8;
const DEMO_LABELS = ['First TD (1/4)', 'Big Swing (2/4)', 'Halftime (3/4)', 'Game Final (4/4)'] as const;

/** Ticks once a second, so locks and countdowns update on their own. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function App() {
  const [clients, setClients] = useState<Clients | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [games, setGames] = useState<Game[] | null>(null);
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [tab, setTab] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, GameResult>>({});
  const [resultsLoaded, setResultsLoaded] = useState(false);
  const [standings, setStandings] = useState<StandingsData | null>(null);
  const now = useNow();

  // Notification state: TV persistent Last Big Play strip + row flashes, and mobile toast + catch-up feed.
  const [tvAlertsByGame, setTvAlertsByGame] = useState<Record<string, GameAlert>>({});
  const [tvFlashesByGame, setTvFlashesByGame] = useState<Record<string, Partial<Record<CategoryKey, 'final' | 'live'>>>>({});
  const [rankUpIds, setRankUpIds] = useState<string[]>([]);
  const [latestAlert, setLatestAlert] = useState<GameAlert | null>(null);
  const [mobileToast, setMobileToast] = useState<MobileAlert | null>(null);
  const [recentUpdates, setRecentUpdates] = useState<MobileAlert[]>([]);
  const [demoMode, setDemoMode] = useState(false);
  const [demoIndex, setDemoIndex] = useState(0);

  const flashTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const rankTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSnap = useRef<{
    seeded: boolean;
    results: Record<string, GameResult>;
    standings: StandingsData | null;
    lastAlertAt: number;
    lastAlertGameId: string | null;
  }>({
    seeded: false,
    results: {},
    standings: null,
    lastAlertAt: 0,
    lastAlertGameId: null,
  });

  useEffect(() => {
    setDemoMode(new URLSearchParams(window.location.search).get('demoAlerts') === '1');
  }, []);

  useEffect(() => {
    getClients().then(setClients, (e: unknown) => setLoadError(String(e)));
  }, []);

  useEffect(() => {
    if (!clients) return;
    const offUser = watchUser(clients.auth, setUser);
    const offGames = onSnapshot(
      query(collection(clients.db, 'tgGames'), orderBy('order')),
      (snap) => setGames(snap.docs.map((d) => toGame(d.id, d.data())).filter((g): g is Game => g !== null)),
      (e) => setLoadError(`Couldn't load the games: ${e.message}`),
    );
    const offPlayers = onSnapshot(
      query(collection(clients.db, 'tgPlayers'), orderBy('name')),
      (snap) => setPlayers(snap.docs.map((d) => ({ id: d.id, name: d.get('name'), hasPin: !!d.get('hasPin') }))),
      (e) => setLoadError(`Couldn't load the players: ${e.message}`),
    );
    // Published scores (after the spoiler delay); public, so no sign-in needed.
    const offResults = onSnapshot(collection(clients.db, 'tgResults'), (snap) => {
      setResults(Object.fromEntries(snap.docs.map((d) => [d.id, { stats: d.get('stats'), score: d.get('score') } as GameResult])));
      setResultsLoaded(true);
    });
    const offStandings = onSnapshot(doc(clients.db, 'tgStandings/overall'), (snap) =>
      setStandings(snap.exists() ? (snap.data() as StandingsData) : null),
    );
    return () => {
      offUser();
      offGames();
      offPlayers();
      offResults();
      offStandings();
    };
  }, [clients]);

  useEffect(() => {
    const timers = flashTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      if (rankTimer.current) clearTimeout(rankTimer.current);
    };
  }, []);

  const me = useMemo(() => (user && players ? players.find((p) => p.id === user.uid) ?? null : null), [user, players]);

  // Right after joining, Auth knows the new player a moment before the player list does. Give it a
  // few seconds before treating the sign-in as one whose player no longer exists.
  const [userSeenAt, setUserSeenAt] = useState(0);
  useEffect(() => setUserSeenAt(Date.now()), [user]);
  const waitingForPlayer = !!user && !me && now - userSeenAt < 5000;

  // How many of the questions you've answered in each game, for the progress bar on its tab.
  const meId = me?.id ?? null;
  const gameIds = (games ?? []).map((g) => g.id).join(',');
  const [answered, setAnswered] = useState<Record<string, number>>({});
  useEffect(() => {
    setAnswered({});
    if (!clients || !meId || !gameIds) return;
    const offs = gameIds.split(',').map((id) =>
      onSnapshot(
        doc(clients.db, `tgGames/${id}/picks/${meId}`),
        (snap) => setAnswered((a) => ({ ...a, [id]: snap.exists() ? answeredCount((snap.get('answers') as Answers) ?? {}) : 0 })),
        () => {}, // right after signing in this can be refused for a moment; the bar just stays empty
      ),
    );
    return () => offs.forEach((off) => off());
  }, [clients, meId, gameIds]);

  // Clear personalized mobile alerts when switching signed-in player.
  const prevMeId = useRef<string | null>(meId);
  useEffect(() => {
    if (prevMeId.current !== meId) {
      prevMeId.current = meId;
      setMobileToast(null);
      setRecentUpdates([]);
    }
  }, [meId]);

  // Open on the game being played, else the next to kick off, else the last; follow it as games
  // kick off, until you pick a tab yourself.
  const phases = (games ?? []).map((g) => ({ id: g.id, phase: gamePhase(g.kickoff, results[g.id]?.stats?.state, now) }));
  const phaseOf = new Map(phases.map((p) => [p.id, p.phase]));
  const activeId = tab && games?.some((g) => g.id === tab) ? tab : autoGameId(phases);

  // Banked points (final categories, finished games) for the standings and the full-screen view.
  const locked = useMemo(() => lockedPoints(results), [results]);
  const lockedByGame = useMemo(() => lockedPointsByGame(results), [results]);
  const [tv, setTv] = useState(false);
  const exitTv = useCallback(() => setTv(false), []);
  const enterTv = useCallback(() => setTv(true), []);
  const [rulesOpen, setRulesOpen] = useState(false);
  const openRules = useCallback(() => setRulesOpen(true), []);
  const closeRules = useCallback(() => setRulesOpen(false), []);

  const flashCategoriesFor = useCallback((gameId: string, flashes: GameAlert['flashedCategories']) => {
    if (flashes.length === 0) return;
    const map: Partial<Record<CategoryKey, 'final' | 'live'>> = {};
    for (const f of flashes) map[f.key] = f.tone;
    setTvFlashesByGame((prev) => ({ ...prev, [gameId]: map }));
    const existing = flashTimers.current.get(gameId);
    if (existing) clearTimeout(existing);
    flashTimers.current.set(
      gameId,
      setTimeout(() => {
        setTvFlashesByGame((prev) => {
          const copy = { ...prev };
          delete copy[gameId];
          return copy;
        });
        flashTimers.current.delete(gameId);
      }, FLASH_DURATION_MS),
    );
  }, []);

  const pulseRankUps = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setRankUpIds(ids);
    if (rankTimer.current) clearTimeout(rankTimer.current);
    rankTimer.current = setTimeout(() => {
      setRankUpIds([]);
      rankTimer.current = null;
    }, FLASH_DURATION_MS);
  }, []);

  const pushMobileAlert = useCallback((m: MobileAlert) => {
    setMobileToast(m);
    setRecentUpdates((prev) => [m, ...prev.filter((x) => x.id !== m.id)].slice(0, RECENT_UPDATES_MAX));
  }, []);

  // Diff live published snapshots after initial load so refreshes never spam alerts.
  useEffect(() => {
    if (!games || !players || !resultsLoaded) return;
    const snap = prevSnap.current;
    if (!snap.seeded) {
      snap.seeded = true;
      snap.results = results;
      snap.standings = standings;
      return;
    }
    const prevResults = snap.results;
    const prevStandings = snap.standings;
    if (prevResults === results && prevStandings === standings) return;
    snap.results = results;
    snap.standings = standings;

    const at = Date.now();
    const alerts = diffSnapshotAlerts({
      games,
      prevResults,
      nextResults: results,
      prevStandings,
      nextStandings: standings,
      players,
      at,
    });

    const knownIds = new Set(players.map((p) => p.id));
    const movedUp = improvedRankIds(prevStandings, standings, prevResults, results, knownIds);
    if (movedUp.length > 0) pulseRankUps(movedUp);

    if (alerts.length > 0) {
      for (const alert of alerts) {
        if (alert.showOnTvBanner) {
          setTvAlertsByGame((prev) => ({ ...prev, [alert.gameId]: alert }));
          setLatestAlert(alert);
          snap.lastAlertAt = at;
          snap.lastAlertGameId = alert.gameId;
        }
        flashCategoriesFor(alert.gameId, alert.flashedCategories);
        const m = toMobileAlert({ alert, meId, nextResult: results[alert.gameId] });
        if (m) pushMobileAlert(m);
      }
      return;
    }

    // Firestore delivers tgResults and tgStandings/overall in separate snapshots; if a 1st-place
    // change arrives moments after a play, attach it to the recent TV banner without double-flashing.
    if (prevStandings !== standings) {
      const lead = detectStandingsChange(prevStandings, standings, prevResults, results, knownIds);
      if (lead) {
        const targetId =
          snap.lastAlertGameId && at - snap.lastAlertAt < 4000
            ? snap.lastAlertGameId
            : (activeId ?? games[0]?.id ?? null);
        if (targetId) {
          setTvAlertsByGame((prev) => {
            const existing = prev[targetId];
            if (existing && at - existing.at < 4000) {
              return { ...prev, [targetId]: { ...existing, standingsLead: lead } };
            }
            return prev;
          });
        }
        if (meId && lead.gainedLeaders.includes(meId) && !lead.isChampion) {
          pushMobileAlert({
            id: `overall-lead-${at}`,
            gameId: targetId ?? games[0]?.id ?? '',
            kind: 'swing',
            tag: '1ST OVERALL',
            headline: 'Overall standings',
            impact: 'You moved into 1st overall!',
            badge: '1st overall',
            tone: 'live',
            at,
          });
        }
      }
    }
  }, [games, players, results, resultsLoaded, standings, meId, activeId, flashCategoriesFor, pulseRankUps, pushMobileAlert]);

  // Auto-dismiss mobile play alert toast after a readable duration.
  useEffect(() => {
    if (!mobileToast) return;
    const t = setTimeout(() => setMobileToast(null), MOBILE_TOAST_MS);
    return () => clearTimeout(t);
  }, [mobileToast]);

  // Brief confirmation/undo toast after one-tap sign-in on a PIN-less family chip.
  const [signInToast, setSignInToast] = useState<Player | null>(null);
  useEffect(() => {
    if (!signInToast) return;
    const t = setTimeout(() => setSignInToast(null), 6000);
    return () => clearTimeout(t);
  }, [signInToast]);
  useEffect(() => {
    if (signInToast && me && me.id !== signInToast.id) setSignInToast(null);
  }, [me, signInToast]);

  const triggerDemoAlert = useCallback(
    (targetGameId: string | null) => {
      const targetGame = (games ?? []).find((g) => g.id === targetGameId) ?? (games ?? [])[0] ?? null;
      const list = buildDemoAlerts({ game: targetGame, players: players ?? [], meId, at: Date.now() });
      const pair = list[demoIndex % list.length];
      setDemoIndex((n) => n + 1);
      setTvAlertsByGame((prev) => ({ ...prev, [pair.tvAlert.gameId]: pair.tvAlert }));
      setLatestAlert(pair.tvAlert);
      flashCategoriesFor(pair.tvAlert.gameId, pair.tvAlert.flashedCategories);
      if (pair.tvAlert.standingsLead) pulseRankUps(pair.tvAlert.standingsLead.gainedLeaders);
      pushMobileAlert(pair.mobileAlert);
    },
    [games, players, meId, demoIndex, flashCategoriesFor, pulseRankUps, pushMobileAlert],
  );

  if (loadError) return <p className="tg-error" role="alert">{loadError}</p>;
  if (!clients || games === null || players === null || user === undefined) return <p className="muted">Loading…</p>;

  const lastKickoff = games.reduce((m, g) => Math.max(m, g.kickoff), 0);
  const joinOpen = games.length === 0 || now < lastKickoff;
  const active = games.find((g) => g.id === activeId) ?? null;
  const showStandings = !!standings && standings.status !== 'pre';
  const isPickingOpenGame = active ? phaseOf.get(active.id) === 'open' : false;
  const demoNextLabel = DEMO_LABELS[demoIndex % DEMO_LABELS.length];

  // Next open game that still needs picks, for the celebratory 15/15 handoff button.
  const nextOpenGame =
    games.find((g) => g.id !== activeId && phaseOf.get(g.id) === 'open' && (answered[g.id] ?? 0) < QUESTION_COUNT) ??
    null;

  const selectGame = (id: string) => {
    if (!games.some((g) => g.id === id)) return;
    setTab(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className={showStandings ? 'tg tg-arena tg-arena-split' : 'tg tg-arena'}>
      <AccountMenu clients={clients} me={me} onFullScreen={enterTv} onOpenRules={openRules} />
      {tv && (
        <TvView
          games={games}
          phases={phases}
          results={results}
          standings={standings}
          locked={locked}
          players={players}
          playAlerts={tvAlertsByGame}
          categoryFlashes={tvFlashesByGame}
          rankUpIds={rankUpIds}
          latestAlert={latestAlert}
          demoMode={demoMode}
          demoNextLabel={demoNextLabel}
          onDemoAlert={triggerDemoAlert}
          onExit={exitTv}
        />
      )}
      {rulesOpen && <RulesModal onClose={closeRules} />}
      {signInToast && (
        <div className="tg-toast" role="status" aria-live="polite" data-testid="tg-signin-toast">
          <span className="tg-toast-text">
            Signed in as <strong>{signInToast.name}</strong>
          </span>
          <button
            type="button"
            className="tg-toast-action"
            onClick={() => {
              setSignInToast(null);
              void switchPlayer(clients.auth);
            }}
          >
            Switch
          </button>
          <button
            type="button"
            className="tg-toast-dismiss"
            aria-label="Dismiss"
            onClick={() => setSignInToast(null)}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}
      {!tv && !signInToast && mobileToast && (
        <MobileAlertToast
          alert={mobileToast}
          onDismiss={() => setMobileToast(null)}
          onSelectGame={selectGame}
        />
      )}

      {showStandings && (
        <aside className="tg-rail" aria-label="Standings">
          <Standings
            standings={standings}
            games={games}
            phases={phases}
            players={players}
            me={me}
            locked={locked}
            lockedByGame={lockedByGame}
            isPickingOpenGame={isPickingOpenGame}
          />
        </aside>
      )}

      <div className="tg-main">
        {demoMode && (
          <div className="tg-demo-bar" data-testid="tg-demo-bar">
            <span className="tg-demo-label">Alert preview mode</span>
            <button
              type="button"
              className="tg-demo-btn"
              onClick={() => triggerDemoAlert(activeId)}
              data-testid="tg-mobile-demo-alert"
            >
              Trigger: {demoNextLabel}
            </button>
          </div>
        )}

        {me ? null : waitingForPlayer ? (
          <p className="muted">Signing you in…</p>
        ) : (
          <SignIn
            clients={clients}
            players={players}
            joinOpen={joinOpen}
            signedInElsewhere={!!user && !me}
            onQuickSignIn={setSignInToast}
          />
        )}

        {games.length === 0 ? (
          <p className="muted">The games will show up here shortly.</p>
        ) : (
          <>
            <nav className="tg-tabs" aria-label="Games">
              {games.map((g) => {
                const phase = phaseOf.get(g.id)!;
                const n = answered[g.id] ?? 0;
                const tabScore = phase !== 'open' && results[g.id]?.stats && results[g.id].stats.state !== 'pre' ? results[g.id].stats : null;
                const badgeText =
                  phase === 'live'
                    ? tabScore
                      ? `${tabScore.away}–${tabScore.home}`
                      : 'Live'
                    : phase === 'final'
                      ? tabScore
                        ? `${tabScore.away}–${tabScore.home}`
                        : 'Final'
                      : me
                        ? `${n}/${QUESTION_COUNT}`
                        : 'Open';
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`tg-tab tg-tab-${phase}`}
                    aria-current={g.id === activeId ? 'page' : undefined}
                    onClick={() => setTab(g.id)}
                  >
                    <span className="tg-tab-logos" aria-hidden="true">
                      <TeamLogo team={g.away} size={28} />
                      <TeamLogo team={g.home} size={28} />
                    </span>
                    <span className="tg-tab-teams">
                      {g.away.abbr} @ {g.home.abbr}
                    </span>
                    <span className="tg-tab-meta">
                      <PhaseBadge phase={phase} text={badgeText} compact />
                    </span>
                    {me && (
                      <span
                        className="tg-progress"
                        role="progressbar"
                        aria-label="Your picks"
                        aria-valuemin={0}
                        aria-valuemax={QUESTION_COUNT}
                        aria-valuenow={n}
                        data-testid={`tg-progress-${g.id}`}
                      >
                        <span className={n >= QUESTION_COUNT ? 'tg-progress-fill tg-progress-full' : 'tg-progress-fill'} style={{ width: `${(100 * n) / QUESTION_COUNT}%` }} />
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <RecentUpdatesStrip
              alerts={recentUpdates}
              now={now}
              onSelectGame={selectGame}
              onClear={() => setRecentUpdates([])}
            />

            {active && (
              <GamePanel
                key={active.id}
                clients={clients}
                game={active}
                me={me}
                players={players}
                now={now}
                result={results[active.id] ?? null}
                phase={phaseOf.get(active.id)!}
                nextGame={nextOpenGame}
                nextAnswered={nextOpenGame ? (answered[nextOpenGame.id] ?? 0) : 0}
                onSelectGame={selectGame}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
