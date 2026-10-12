'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  CircleHelp,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingUp,
  Wifi,
  WifiOff,
} from 'lucide-react';

type Tick = {
  at: number;
  prob: number;
};

type History = Record<string, Tick[]>;

type Outcome = {
  outcomeId?: string;
  name?: string;
  label?: string;
  price?: string | number | null;
};

type Market = {
  marketId?: string;
  id?: string;
  eventId?: string;
  eventName?: string;
  eventSlug?: string;
  startDate?: string | null;
  gameStartTime?: string | null;
  name?: string;
  title?: string;
  marketType?: string;
  sportsMarketType?: string | null;
  line?: number | string | null;
  groupItemTitle?: string | null;
  source?: string;
  outcomes?: Outcome[];
  volume?: string | number;
  status?: string;
};

type Signal = {
  id: string;
  label: string;
  outcome: string;
  league: string;
  opening: number;
  current: number;
  change: number;
  observations: number;
  score: number;
  at: number;
};

type Game = {
  id: string;
  name: string;
  kickoff: string | null;
  markets: Market[];
};

type Category =
  | 'Moneyline'
  | 'Spreads'
  | 'Totals'
  | 'Player Props'
  | 'Other';

type OddsFormat = 'probability' | 'american';

const historyKey = 'lineshift-history-v1';
const picksKey = 'lineshift-weekly-picks-v1';
const watchKey = 'lineshift-watch';
const oddsKey = 'lineshift-odds-format-v1';

const leagues = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'EPL'];

const categories: Category[] = [
  'Moneyline',
  'Spreads',
  'Totals',
  'Player Props',
  'Other',
];

const DEFAULT_PROP_LIMIT = 25;

function numericProbability(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;

  const value = Number(raw);

  return Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function price(raw: unknown): string {
  const value = numericProbability(raw);

  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function americanOdds(raw: unknown): string {
  const probability = numericProbability(raw);

  if (
    probability === null ||
    probability === 0 ||
    probability === 1
  ) {
    return '—';
  }

  const odds =
    probability >= 0.5
      ? (-100 * probability) / (1 - probability)
      : (100 * (1 - probability)) / probability;

  const rounded = Math.round(odds);

  return rounded > 0 ? `+${rounded}` : String(rounded);
}

function formatPrice(raw: unknown, format: OddsFormat): string {
  return format === 'american' ? americanOdds(raw) : price(raw);
}

function money(raw: unknown): string {
  const value = Number(raw);

  return Number.isFinite(value) && value > 0
    ? '$' +
        value.toLocaleString(undefined, {
          maximumFractionDigits: 0,
        })
    : '—';
}

function marketId(market: Market): string {
  return String(market.marketId || market.id || '');
}

function marketName(market: Market): string {
  return market.name || market.title || 'Untitled market';
}

function gameName(market: Market): string {
  return market.eventName || marketName(market);
}

function kickoffTimestamp(
  value: string | null | undefined
): number {
  if (!value) return Infinity;

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : Infinity;
}

function formatKickoff(
  value: string | null | undefined
): string {
  if (!value || !Number.isFinite(Date.parse(value))) {
    return 'Kickoff time unavailable';
  }

  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
}

function normalizeMatchupName(rawName: string): string {
  const name = rawName.trim();

  const suffixes = [
    ' - First Touchdown Scorer',
    ' - Anytime Touchdown Scorer',
    ' - Highest Scoring Quarter',
    ' - Player Props',
    ' - Team Props',
    ' - Game Props',
    ' - Passing Props',
    ' - Rushing Props',
    ' - Receiving Props',
    ' - Touchdown Props',
    ' - Alternate Spreads',
    ' - Alternate Totals',
  ];

  for (const suffix of suffixes) {
    if (
      name.toLowerCase().endsWith(suffix.toLowerCase())
    ) {
      return name.slice(0, -suffix.length).trim();
    }
  }

  return name;
}

function marketCategory(market: Market): Category {
  const type = (market.marketType || '').toLowerCase();
  const sportsType = (
    market.sportsMarketType || ''
  ).toLowerCase();
  const question = marketName(market).toLowerCase();

  if (
    type.includes('player') ||
    sportsType.includes('player') ||
    /passing yards|rushing yards|receiving yards|receptions|anytime touchdown|first touchdown|player to score/.test(
      question
    )
  ) {
    return 'Player Props';
  }

  if (
    type.includes('spread') ||
    sportsType.includes('spread') ||
    question.includes('spread')
  ) {
    return 'Spreads';
  }

  if (
    type.includes('total') ||
    sportsType.includes('total') ||
    /total points|over\/under|combined points|o\/u/.test(
      question
    )
  ) {
    return 'Totals';
  }

  if (
    type.includes('moneyline') ||
    sportsType.includes('moneyline') ||
    question.includes('moneyline') ||
    question.includes('winner')
  ) {
    return 'Moneyline';
  }

  return 'Other';
}

function groupGames(markets: Market[]): Game[] {
  const groups = new Map<string, Game>();

  for (const market of markets) {
    const name = normalizeMatchupName(gameName(market));
    const kickoff = market.gameStartTime || null;

    const kickoffKey = Number.isFinite(
      kickoffTimestamp(kickoff)
    )
      ? new Date(kickoff as string).toISOString()
      : 'unknown';

    const id = `${name.toLowerCase()}:${kickoffKey}`;
    const existing = groups.get(id);

    if (existing) {
      existing.markets.push(market);
    } else {
      groups.set(id, {
        id,
        name,
        kickoff,
        markets: [market],
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) => {
    const aTime = kickoffTimestamp(a.kickoff);
    const bTime = kickoffTimestamp(b.kickoff);

    if (aTime !== bTime) return aTime - bTime;

    return a.name.localeCompare(b.name);
  });
}

// Extract the player name from common Polymarket prop titles.
function playerName(market: Market): string {
  const title = marketName(market).trim();

  const colonIndex = title.indexOf(':');

  if (colonIndex > 0) {
    return title.slice(0, colonIndex).trim();
  }

  const patterns = [
    /\s+(?:Passing Yards|Rushing Yards|Receiving Yards|Receptions)\b/i,
    /\s+(?:Anytime Touchdown|First Touchdown)\b/i,
  ];

  for (const pattern of patterns) {
    const match = title.match(pattern);

    if (match && match.index !== undefined && match.index > 0) {
      return title.slice(0, match.index).trim();
    }
  }

  return 'Other Player Props';
}

function volumeNumber(market: Market): number {
  const value = Number(market.volume);

  return Number.isFinite(value) && value > 0 ? value : 0;
}

function sortPropsByVolume(markets: Market[]): Market[] {
  return [...markets].sort(
    (a, b) => volumeNumber(b) - volumeNumber(a)
  );
}

type PlayerGroup = {
  name: string;
  markets: Market[];
  totalVolume: number;
};

function groupPlayerProps(markets: Market[]): PlayerGroup[] {
  const groups = new Map<string, PlayerGroup>();

  for (const market of markets) {
    const name = playerName(market);
    const key = name.toLowerCase();

    const existing = groups.get(key);

    if (existing) {
      existing.markets.push(market);
      existing.totalVolume += volumeNumber(market);
    } else {
      groups.set(key, {
        name,
        markets: [market],
        totalVolume: volumeNumber(market),
      });
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      markets: sortPropsByVolume(group.markets),
    }))
    .sort(
      (a, b) =>
        b.totalVolume - a.totalVolume ||
        a.name.localeCompare(b.name)
    );
}

function buildSignals(
  markets: Market[],
  history: History,
  league: string
): Signal[] {
  const signals: Signal[] = [];

  for (const market of markets) {
    const mid = marketId(market);

    if (!mid) continue;

    for (const [index, outcome] of (
      market.outcomes || []
    ).entries()) {
      const id = `${league}:${mid}:${outcome.outcomeId || index}`;
      const ticks = history[id] || [];

      if (
        ticks.length < 2 ||
        ticks[ticks.length - 1].at - ticks[0].at < 60000
      ) {
        continue;
      }

      const opening = ticks[0].prob;
      const current = ticks[ticks.length - 1].prob;
      const change = (current - opening) * 100;

      if (
        Math.abs(change) < 0.5 ||
        current < 1 / 3 ||
        current > 0.85
      ) {
        continue;
      }

      signals.push({
        id,
        label: `${normalizeMatchupName(
          gameName(market)
        )} · ${marketName(market)}`,
        outcome:
          outcome.name ||
          outcome.label ||
          `Outcome ${index + 1}`,
        league,
        opening,
        current,
        change,
        observations: ticks.length,
        score: Math.abs(change),
        at: ticks[ticks.length - 1].at,
      });
    }
  }

  return signals.sort((a, b) => b.score - a.score);
}

export default function Home() {
  const [history, setHistory] = useState<History>({});
  const [picks, setPicks] = useState<Signal[]>([]);
  const [view, setView] = useState<
    'markets' | 'signals' | 'picks'
  >('markets');
  const [league, setLeague] = useState('NFL');
  const [query, setQuery] = useState('');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');
  const [selectedGameId, setSelectedGameId] = useState<
    string | null
  >(null);
  const [category, setCategory] =
    useState<Category>('Moneyline');
  const [watch, setWatch] = useState<string[]>([]);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [oddsFormat, setOddsFormat] =
    useState<OddsFormat>('probability');
  const [showAllProps, setShowAllProps] = useState(false);

  useEffect(() => {
    try {
      setWatch(
        JSON.parse(localStorage.getItem(watchKey) || '[]')
      );
      setHistory(
        JSON.parse(localStorage.getItem(historyKey) || '{}')
      );
      setPicks(
        JSON.parse(localStorage.getItem(picksKey) || '[]')
      );

      const savedFormat = localStorage.getItem(oddsKey);

      if (
        savedFormat === 'american' ||
        savedFormat === 'probability'
      ) {
        setOddsFormat(savedFormat);
      }
    } catch {
      // Continue with empty local data.
    }
  }, []);

  function changeOddsFormat(nextFormat: OddsFormat) {
    setOddsFormat(nextFormat);

    try {
      localStorage.setItem(oddsKey, nextFormat);
    } catch {
      // Ignore local storage errors.
    }
  }

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch(
        `/api/markets?league=${encodeURIComponent(league)}`,
        { cache: 'no-store' }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || 'Unable to load markets'
        );
      }

      const incoming: Market[] = Array.isArray(data.markets)
        ? data.markets
        : [];

      setMarkets(incoming);
      setUpdated(data.updatedAt || '');

      setHistory((previous) => {
        const next: History = { ...previous };
        const now = Date.now();

        for (const market of incoming) {
          const mid = marketId(market);

          if (!mid) continue;

          for (const [index, outcome] of (
            market.outcomes || []
          ).entries()) {
            const probability = numericProbability(
              outcome.price
            );

            if (probability === null) continue;

            const id = `${league}:${mid}:${
              outcome.outcomeId || index
            }`;
            const old = next[id] || [];

            if (
              !old.length ||
              old[old.length - 1].prob !== probability ||
              now - old[old.length - 1].at >= 60000
            ) {
              next[id] = [
                ...old,
                { at: now, prob: probability },
              ].slice(-500);
            }
          }
        }

        try {
          localStorage.setItem(
            historyKey,
            JSON.stringify(next)
          );
        } catch {
          // Ignore local storage errors.
        }

        return next;
      });

      setError('');
    } catch (err) {
      setMarkets([]);
      setError(
        err instanceof Error
          ? err.message
          : 'Connection error'
      );
    } finally {
      setLoading(false);
    }
  }, [league]);

  useEffect(() => {
    load();

    const interval = setInterval(load, 60000);

    return () => clearInterval(interval);
  }, [load]);

  const signals = useMemo(
    () => buildSignals(markets, history, league),
    [markets, history, league]
  );

  const games = useMemo(
    () => groupGames(markets),
    [markets]
  );

  const filteredGames = useMemo(() => {
    const search = query.trim().toLowerCase();

    return games.filter((game) => {
      const matchesSearch =
        !search ||
        game.name.toLowerCase().includes(search) ||
        game.markets.some(
          (market) =>
            marketName(market)
              .toLowerCase()
              .includes(search) ||
            marketCategory(market)
              .toLowerCase()
              .includes(search) ||
            (market.outcomes || []).some((outcome) =>
              (
                outcome.name ||
                outcome.label ||
                ''
              )
                .toLowerCase()
                .includes(search)
            )
        );

      const matchesWatch =
        !onlyWatch ||
        game.markets.some((market) =>
          watch.includes(marketId(market))
        );

      return matchesSearch && matchesWatch;
    });
  }, [games, query, onlyWatch, watch]);

  const selectedGame = useMemo(
    () =>
      games.find((game) => game.id === selectedGameId) ||
      null,
    [games, selectedGameId]
  );

  const selectedMarkets = useMemo(
    () =>
      selectedGame
        ? selectedGame.markets.filter(
            (market) =>
              marketCategory(market) === category
          )
        : [],
    [selectedGame, category]
  );

  const playerGroups = useMemo(
    () => groupPlayerProps(selectedMarkets),
    [selectedMarkets]
  );

  const visiblePlayerGroups = useMemo(() => {
    if (showAllProps) return playerGroups;

    let remaining = DEFAULT_PROP_LIMIT;

    return playerGroups
      .map((group) => {
        const visibleMarkets = group.markets.slice(
          0,
          remaining
        );

        remaining -= visibleMarkets.length;

        return {
          ...group,
          markets: visibleMarkets,
        };
      })
      .filter((group) => group.markets.length > 0);
  }, [playerGroups, showAllProps]);

  function openGame(game: Game) {
    setSelectedGameId(game.id);
    setShowAllProps(false);

    const firstAvailable = categories.find((item) =>
      game.markets.some(
        (market) =>
          marketCategory(market) === item
      )
    );

    setCategory(firstAvailable || 'Moneyline');
  }

  function changeLeague(nextLeague: string) {
    setLeague(nextLeague);
    setSelectedGameId(null);
    setQuery('');
    setShowAllProps(false);
  }

  function changeCategory(nextCategory: Category) {
    setCategory(nextCategory);
    setShowAllProps(false);
  }

  function toggleWatch(id: string) {
    const next = watch.includes(id)
      ? watch.filter((item) => item !== id)
      : [...watch, id];

    setWatch(next);

    try {
      localStorage.setItem(
        watchKey,
        JSON.stringify(next)
      );
    } catch {
      // Ignore local storage errors.
    }
  }

  function publish() {
    const selected = signals
      .filter((signal) => signal.change > 0)
      .slice(0, 5);

    setPicks(selected);

    try {
      localStorage.setItem(
        picksKey,
        JSON.stringify(selected)
      );
    } catch {
      // Ignore local storage errors.
    }

    setView('picks');
  }

  function exportPicks() {
    const payload = {
      source: 'LineShift',
      generatedAt: new Date().toISOString(),
      method:
        'Positive price movement; candidates only, not recommendations',
      picks,
    };

    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: 'application/json' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download =
      'lineshift-weekly-hot-picks.json';
    link.click();

    URL.revokeObjectURL(url);
  }

  function renderMarketRow(
    market: Market,
    index: number
  ) {
    const id = marketId(market) || String(index);

    return (
      <tr key={id}>
        <td>
          <div className="marketname">
            {marketName(market)}
          </div>

          {market.line !== null &&
            market.line !== undefined && (
              <div className="marketid">
                Line: {market.line}
              </div>
            )}
        </td>

        <td>
          <div className="outcomes">
            {(market.outcomes || []).map(
              (outcome, outcomeIndex) => (
                <span
                  className="outcome"
                  key={outcomeIndex}
                >
                  {outcome.name ||
                    outcome.label ||
                    `Outcome ${outcomeIndex + 1}`}

                  <strong>
                    {formatPrice(
                      outcome.price,
                      oddsFormat
                    )}
                  </strong>
                </span>
              )
            )}
          </div>
        </td>

        <td className="volume">
          {money(market.volume)}
        </td>

        <td>
          <button
            className={
              'star ' +
              (watch.includes(id) ? 'saved' : '')
            }
            onClick={() => toggleWatch(id)}
            title="Toggle watchlist"
          >
            {watch.includes(id) ? '★' : '☆'}
          </button>
        </td>
      </tr>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandmark">
            <Activity size={23} />
          </div>
          <div>
            LINE<span>SHIFT</span>
            <small>
              SPORTS MARKET INTELLIGENCE
            </small>
          </div>
        </div>

        <div className="navlabel">
          WORKSPACE
        </div>

        <button
          className={
            'navitem ' +
            (view === 'markets' ? 'active' : '')
          }
          onClick={() => setView('markets')}
        >
          <BarChart3 size={18} />
          Market Overview
        </button>

        <button
          className={
            'navitem ' +
            (view === 'signals' ? 'active' : '')
          }
          onClick={() => setView('signals')}
        >
          <Activity size={18} />
          Line Movement
          <b>{signals.length}</b>
        </button>

        <button
          className={
            'navitem ' +
            (view === 'picks' ? 'active' : '')
          }
          onClick={() => setView('picks')}
        >
          <TrendingUp size={18} />
          Weekly Hot Picks
          <b>{picks.length}</b>
        </button>

        <button
          className={
            'navitem ' +
            (onlyWatch ? 'active' : '')
          }
          onClick={() => {
            setOnlyWatch(!onlyWatch);
            setSelectedGameId(null);
            setView('markets');
          }}
        >
          <TrendingUp size={18} />
          Watchlist
          <b>{watch.length}</b>
        </button>

        <div className="navlabel second">
          DATA SOURCE
        </div>

        <div className="source">
          <span
            className={
              'dot ' + (error ? 'red' : '')
            }
          />
          <div>
            Polymarket Gamma API
            <small>
              {error
                ? 'Unavailable'
                : 'Read-only connection'}
            </small>
          </div>
        </div>

        <div className="sidebottom">
          <ShieldCheck size={18} />
          <span>
            Market data only
            <br />
            <small>
              No trades or account access
            </small>
          </span>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <div className="crumb">
            WORKSPACE <span>/</span>{' '}
            {selectedGame &&
            view === 'markets'
              ? 'MATCHUP DETAILS'
              : 'MARKET OVERVIEW'}
          </div>

          <div className="topright">
            <span className="live">
              <span
                className={
                  'dot ' + (error ? 'red' : '')
                }
              />
              {error
                ? 'OFFLINE'
                : 'LIVE DATA'}
            </span>

            <a
              href="https://docs.polymarket.com/"
              target="_blank"
              rel="noreferrer"
            >
              API Docs{' '}
              <ExternalLink size={13} />
            </a>
          </div>
        </header>

        <div className="content">
          <div className="heading">
            <div>
              <div className="eyebrow">
                TRACK THE LINES. SPOT THE SHIFTS.
              </div>

              <h1>
                LineShift Overview
                <span className="headingdot">
                  .
                </span>
              </h1>

              <p>
                Explore sports prediction markets,
                compare implied probabilities, and
                track the contracts that matter.
              </p>
            </div>

            <button
              className="refresh"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw
                size={16}
                className={
                  loading ? 'spin' : ''
                }
              />
              Refresh Data
            </button>
          </div>

          <section className="stats">
            <div className="stat">
              <div className="stathead">
                AVAILABLE MATCHUPS{' '}
                <BarChart3 size={18} />
              </div>
              <div className="statvalue">
                {loading
                  ? '…'
                  : games.length.toLocaleString()}
              </div>
              <div className="statfoot">
                Upcoming {league} events
              </div>
            </div>

            <div className="stat">
              <div className="stathead">
                AVAILABLE CONTRACTS{' '}
                <TrendingUp size={18} />
              </div>
              <div className="statvalue">
                {loading
                  ? '…'
                  : markets.length.toLocaleString()}
              </div>
              <div className="statfoot">
                Current market feed
              </div>
            </div>

            <div className="stat">
              <div className="stathead">
                DATA CONNECTION{' '}
                {error ? (
                  <WifiOff size={18} />
                ) : (
                  <Wifi size={18} />
                )}
              </div>
              <div className="statvalue smaller">
                {error
                  ? 'Unavailable'
                  : 'Connected'}
              </div>
              <div className="statfoot">
                Refreshes every 60 seconds
              </div>
            </div>

            <div className="stat">
              <div className="stathead">
                TRADING MODE{' '}
                <ShieldCheck size={18} />
              </div>
              <div className="statvalue smaller">
                Read Only
              </div>
              <div className="statfoot">
                No orders are placed
              </div>
            </div>
          </section>

          {view === 'signals' && (
            <section className="panel signalpanel">
              <div className="panelhead">
                <div>
                  <div className="eyebrow">
                    PRICE MOVEMENT ENGINE
                  </div>
                  <h2>
                    LineShift Signals{' '}
                    <span className="count">
                      {signals.length}
                    </span>
                  </h2>
                </div>

                <button
                  className="refresh"
                  onClick={publish}
                  disabled={
                    !signals.some(
                      (signal) =>
                        signal.change > 0
                    )
                  }
                >
                  Select Top 5 Hot Picks
                </button>
              </div>

              <p className="signalintro">
                Observed changes since this browser
                started collecting prices. A positive
                move means implied probability
                increased, not that the contract is
                a good bet. Requires at least two
                observations a minute apart.
              </p>

              <div className="signalgrid">
                {signals.map((signal) => (
                  <div
                    className="signalcard"
                    key={signal.id}
                  >
                    <div className="eyebrow">
                      {signal.league} ·{' '}
                      {signal.observations}{' '}
                      observations
                    </div>

                    <h3>{signal.label}</h3>

                    <div className="muted">
                      {signal.outcome}
                    </div>

                    <div className="signalnumbers">
                      <span>
                        {(
                          signal.opening * 100
                        ).toFixed(1)}
                        % →{' '}
                        {(
                          signal.current * 100
                        ).toFixed(1)}
                        %
                      </span>

                      <strong
                        className={
                          signal.change >= 0
                            ? 'positive'
                            : 'negative'
                        }
                      >
                        {signal.change > 0
                          ? '+'
                          : ''}
                        {signal.change.toFixed(1)}{' '}
                        pp
                      </strong>
                    </div>
                  </div>
                ))}

                {!signals.length && (
                  <div className="signalempty">
                    No qualified movements yet.
                    Keep the dashboard open while
                    prices refresh.
                  </div>
                )}
              </div>
            </section>
          )}

          {view === 'picks' && (
            <section className="panel signalpanel">
              <div className="panelhead">
                <div>
                  <div className="eyebrow">
                    WEEKLY PARLAY INTEGRATION
                  </div>
                  <h2>
                    Weekly Hot Picks{' '}
                    <span className="count">
                      {picks.length}/5
                    </span>
                  </h2>
                </div>

                <button
                  className="refresh"
                  disabled={!picks.length}
                  onClick={exportPicks}
                >
                  Export JSON
                </button>
              </div>

              <p className="signalintro">
                These are line-movement candidates,
                not verified betting
                recommendations. Nothing is
                automatically published.
              </p>

              <div className="signalgrid">
                {picks.map(
                  (signal, index) => (
                    <div
                      className="signalcard"
                      key={signal.id}
                    >
                      <div className="eyebrow">
                        PICK {index + 1} ·{' '}
                        {signal.league}
                      </div>

                      <h3>{signal.label}</h3>

                      <div className="muted">
                        {signal.outcome}
                      </div>

                      <div className="signalnumbers">
                        <span>
                          {formatPrice(
                            signal.current,
                            oddsFormat
                          )}{' '}
                          {oddsFormat ===
                          'probability'
                            ? 'implied'
                            : 'equivalent'}
                        </span>

                        <strong className="positive">
                          +
                          {signal.change.toFixed(
                            1
                          )}{' '}
                          pp
                        </strong>
                      </div>
                    </div>
                  )
                )}

                {!picks.length && (
                  <div className="signalempty">
                    No Hot Picks selected yet.
                  </div>
                )}
              </div>
            </section>
          )}

          {view === 'markets' && (
            <section className="panel">
              {!selectedGame ? (
                <>
                  <div className="panelhead">
                    <div>
                      <div className="eyebrow">
                        MATCHUP EXPLORER
                      </div>

                      <h2>
                        Upcoming Matchups{' '}
                        <span className="count">
                          {filteredGames.length}
                        </span>
                      </h2>
                    </div>

                    <div className="last">
                      {updated
                        ? 'Last updated ' +
                          new Date(
                            updated
                          ).toLocaleTimeString()
                        : 'Waiting for feed'}
                    </div>
                  </div>

                  <div className="filters">
                    <div className="leagues">
                      {leagues.map((item) => (
                        <button
                          key={item}
                          className={
                            league === item
                              ? 'chosen'
                              : ''
                          }
                          onClick={() =>
                            changeLeague(item)
                          }
                        >
                          {item}
                        </button>
                      ))}
                    </div>

                    <div className="search">
                      <Search size={16} />
                      <input
                        value={query}
                        onChange={(event) =>
                          setQuery(
                            event.target.value
                          )
                        }
                        placeholder="Search teams or matchups"
                      />
                    </div>
                  </div>

                  {error && (
                    <div className="error">
                      <CircleHelp size={18} />
                      <div>
                        <strong>
                          Live feed temporarily
                          unavailable.
                        </strong>
                        <div>{error}</div>
                      </div>
                    </div>
                  )}

                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr>
                          <th>
                            MATCHUP / KICKOFF
                          </th>
                          <th>
                            AVAILABLE CONTRACTS
                          </th>
                          <th>
                            MARKET TYPES
                          </th>
                          <th>EXCHANGE</th>
                        </tr>
                      </thead>

                      <tbody>
                        {filteredGames.map(
                          (game) => {
                            const available =
                              categories.filter(
                                (item) =>
                                  game.markets.some(
                                    (market) =>
                                      marketCategory(
                                        market
                                      ) === item
                                  )
                              );

                            return (
                              <tr
                                key={game.id}
                                onClick={() =>
                                  openGame(game)
                                }
                              >
                                <td>
                                  <div className="marketname">
                                    {game.name}
                                  </div>

                                  <div
                                    className="marketid"
                                    style={{
                                      color:
                                        '#b6f36c',
                                      marginTop: 8,
                                    }}
                                  >
                                    {formatKickoff(
                                      game.kickoff
                                    )}
                                  </div>

                                  <div className="marketid">
                                    Click to explore
                                    markets →
                                  </div>
                                </td>

                                <td className="volume">
                                  {game.markets.length.toLocaleString()}
                                </td>

                                <td>
                                  <div className="outcomes">
                                    {available.map(
                                      (item) => (
                                        <span
                                          key={item}
                                          className="badge"
                                        >
                                          {item}
                                        </span>
                                      )
                                    )}
                                  </div>
                                </td>

                                <td className="volume">
                                  Polymarket
                                </td>
                              </tr>
                            );
                          }
                        )}
                      </tbody>
                    </table>

                    {!loading &&
                      !filteredGames.length && (
                        <div className="empty">
                          <BarChart3 size={30} />
                          <h3>
                            {error
                              ? 'No live data'
                              : 'No upcoming games found'}
                          </h3>
                          <p>
                            {error
                              ? 'Try refreshing later.'
                              : 'Try another search or league.'}
                          </p>
                        </div>
                      )}

                    {loading &&
                      !games.length && (
                        <div className="empty">
                          <RefreshCw
                            size={25}
                            className="spin"
                          />
                          <p>
                            Loading upcoming
                            matchups…
                          </p>
                        </div>
                      )}
                  </div>
                </>
              ) : (
                <>
                  <div className="panelhead">
                    <div>
                      <button
                        className="backbutton"
                        onClick={() =>
                          setSelectedGameId(null)
                        }
                      >
                        <ArrowLeft size={16} />
                        Back to matchups
                      </button>

                      <div className="eyebrow">
                        {league} MATCHUP DETAILS
                      </div>

                      <h2>
                        {selectedGame.name}
                      </h2>

                      <p className="muted">
                        {formatKickoff(
                          selectedGame.kickoff
                        )}
                      </p>

                      <p className="muted">
                        {
                          selectedGame.markets
                            .length
                        }{' '}
                        available contracts ·
                        Polymarket
                      </p>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent:
                        'space-between',
                      flexWrap: 'wrap',
                      gap: 12,
                      marginBottom: 20,
                    }}
                  >
                    <div className="eyebrow">
                      DISPLAY PRICES AS
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        padding: 4,
                        borderRadius: 8,
                        border:
                          '1px solid #343a40',
                        background: '#191d21',
                      }}
                    >
                      <button
                        onClick={() =>
                          changeOddsFormat(
                            'probability'
                          )
                        }
                        aria-pressed={
                          oddsFormat ===
                          'probability'
                        }
                        style={{
                          padding:
                            '9px 14px',
                          borderRadius: 6,
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 600,
                          background:
                            oddsFormat ===
                            'probability'
                              ? '#b6f36c'
                              : 'transparent',
                          color:
                            oddsFormat ===
                            'probability'
                              ? '#151a13'
                              : '#c7cbd0',
                        }}
                      >
                        Probability %
                      </button>

                      <button
                        onClick={() =>
                          changeOddsFormat(
                            'american'
                          )
                        }
                        aria-pressed={
                          oddsFormat ===
                          'american'
                        }
                        style={{
                          padding:
                            '9px 14px',
                          borderRadius: 6,
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 600,
                          background:
                            oddsFormat ===
                            'american'
                              ? '#b6f36c'
                              : 'transparent',
                          color:
                            oddsFormat ===
                            'american'
                              ? '#151a13'
                              : '#c7cbd0',
                        }}
                      >
                        American Odds
                      </button>
                    </div>
                  </div>

                  <div className="market-tabs">
                    {categories.map((item) => {
                      const count =
                        selectedGame.markets.filter(
                          (market) =>
                            marketCategory(
                              market
                            ) === item
                        ).length;

                      return (
                        <button
                          key={item}
                          className={
                            category === item
                              ? 'market-tab selected'
                              : 'market-tab'
                          }
                          onClick={() =>
                            changeCategory(item)
                          }
                        >
                          {item}
                          <span>{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  {category === 'Player Props' && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent:
                          'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 12,
                        padding: '14px 4px',
                      }}
                    >
                      <div className="muted">
                        {showAllProps
                          ? `Showing all ${selectedMarkets.length} player props`
                          : `Showing up to ${DEFAULT_PROP_LIMIT} of ${selectedMarkets.length} player props`}
                        {' · '}
                        Highest-volume contracts
                        first
                      </div>

                      {selectedMarkets.length >
                        DEFAULT_PROP_LIMIT && (
                        <button
                          className="refresh"
                          onClick={() =>
                            setShowAllProps(
                              !showAllProps
                            )
                          }
                        >
                          {showAllProps
                            ? 'Show Less'
                            : `Show All ${selectedMarkets.length} Props`}
                        </button>
                      )}
                    </div>
                  )}

                  {category === 'Player Props' ? (
                    <>
                      {visiblePlayerGroups.map(
                        (group) => (
                          <div
                            key={group.name}
                            style={{
                              marginBottom: 24,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent:
                                  'space-between',
                                padding:
                                  '14px 16px',
                                background:
                                  '#20262a',
                                border:
                                  '1px solid #343a40',
                                borderRadius:
                                  '8px 8px 0 0',
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 700,
                                  fontSize: 15,
                                }}
                              >
                                {group.name}
                              </div>

                              <div className="muted">
                                {
                                  group.markets
                                    .length
                                }{' '}
                                props
                              </div>
                            </div>

                            <div className="tablewrap">
                              <table>
                                <thead>
                                  <tr>
                                    <th>
                                      PLAYER PROP /
                                      LINE
                                    </th>
                                    <th>
                                      {oddsFormat ===
                                      'american'
                                        ? 'AMERICAN ODDS'
                                        : 'IMPLIED PROBABILITY'}
                                    </th>
                                    <th>
                                      VOLUME
                                    </th>
                                    <th>
                                      WATCH
                                    </th>
                                  </tr>
                                </thead>

                                <tbody>
                                  {group.markets.map(
                                    (
                                      market,
                                      index
                                    ) =>
                                      renderMarketRow(
                                        market,
                                        index
                                      )
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )
                      )}

                      {!selectedMarkets.length && (
                        <div className="empty">
                          <BarChart3 size={30} />
                          <h3>
                            No player props
                            available
                          </h3>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="tablewrap">
                      <table>
                        <thead>
                          <tr>
                            <th>
                              MARKET / BETTING LINE
                            </th>
                            <th>
                              OUTCOMES &{' '}
                              {oddsFormat ===
                              'american'
                                ? 'AMERICAN ODDS'
                                : 'IMPLIED PROBABILITY'}
                            </th>
                            <th>VOLUME</th>
                            <th>WATCH</th>
                          </tr>
                        </thead>

                        <tbody>
                          {selectedMarkets.map(
                            (
                              market,
                              index
                            ) =>
                              renderMarketRow(
                                market,
                                index
                              )
                          )}
                        </tbody>
                      </table>

                      {!selectedMarkets.length && (
                        <div className="empty">
                          <BarChart3 size={30} />
                          <h3>
                            No contracts in this
                            category
                          </h3>
                          <p>
                            Try another market
                            type.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="panelbottom">
                <span>
                  Source: Polymarket Gamma API ·
                  Read-only
                </span>
                <span>
                  {oddsFormat === 'american'
                    ? 'American odds are calculated equivalents, not executable quotes'
                    : 'Displayed probabilities are indicative, not guaranteed executable quotes'}
                </span>
              </div>
            </section>
          )}

          <div className="disclaimer">
            LineShift is an independent demo
            dashboard and is not affiliated with
            Polymarket. Market-implied probabilities
            are not guaranteed outcomes. American
            odds are mathematical conversions of
            displayed probabilities, not sportsbook
            quotes. Displayed prices may differ from
            executable order-book quotes. This
            application does not place trades or
            provide financial advice.
          </div>
        </div>
      </main>
    </div>
  );
}
