'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowLeft, BarChart3, CircleHelp, ExternalLink, RefreshCw, Search, ShieldCheck, TrendingUp, Wifi, WifiOff } from 'lucide-react';

type Tick = { at: number; prob: number };
type History = Record<string, Tick[]>;
type Outcome = { outcomeId?: string; name?: string; label?: string; price?: string | number | null };
type Market = { marketId?: string; id?: string; eventId?: string; eventName?: string; eventSlug?: string; startDate?: string | null; gameStartTime?: string | null; name?: string; title?: string; marketType?: string; sportsMarketType?: string | null; line?: number | string | null; groupItemTitle?: string | null; source?: string; outcomes?: Outcome[]; volume?: string | number; status?: string };
type KalshiMarket = { marketId: string; eventId: string; ticker: string; name: string; yesSubtitle?: string | null; yesBid: number | null; yesAsk: number | null; closeTime?: string | null };
type Signal = { id: string; label: string; outcome: string; league: string; opening: number; current: number; change: number; observations: number; score: number };
type Game = { id: string; name: string; kickoff: string | null; markets: Market[] };
type Category = 'Moneyline' | 'Spreads' | 'Totals' | 'Player Props' | 'Other';
type OddsFormat = 'probability' | 'american';
type GamePeriod = 'Full Game' | 'Q1' | 'Q2' | 'First Half' | 'Q3' | 'Q4' | 'Second Half';
const gamePeriods: GamePeriod[] = ['Full Game', 'Q1', 'Q2', 'First Half', 'Q3', 'Q4', 'Second Half'];
type Comparison = { id: string; game: Game; team: string; polymarket: number; kalshiAsk: number; kalshiBid: number | null; difference: number };

const historyKey = 'lineshift-history-v1';
const watchKey = 'lineshift-watch';
const oddsKey = 'lineshift-odds-format-v1';
const categories: Category[] = ['Moneyline', 'Spreads', 'Totals', 'Player Props', 'Other'];
const teamNames: Record<string, string> = {
  ARI: 'Arizona Cardinals', ATL: 'Atlanta Falcons', BAL: 'Baltimore Ravens', BUF: 'Buffalo Bills', CAR: 'Carolina Panthers', CHI: 'Chicago Bears', CIN: 'Cincinnati Bengals', CLE: 'Cleveland Browns', DAL: 'Dallas Cowboys', DEN: 'Denver Broncos', DET: 'Detroit Lions', GB: 'Green Bay Packers', HOU: 'Houston Texans', IND: 'Indianapolis Colts', JAC: 'Jacksonville Jaguars', JAX: 'Jacksonville Jaguars', KC: 'Kansas City Chiefs', LV: 'Las Vegas Raiders', LAC: 'Los Angeles Chargers', LAR: 'Los Angeles Rams', MIA: 'Miami Dolphins', MIN: 'Minnesota Vikings', NE: 'New England Patriots', NO: 'New Orleans Saints', NYG: 'New York Giants', NYJ: 'New York Jets', PHI: 'Philadelphia Eagles', PIT: 'Pittsburgh Steelers', SEA: 'Seattle Seahawks', SF: 'San Francisco 49ers', TB: 'Tampa Bay Buccaneers', TEN: 'Tennessee Titans', WAS: 'Washington Commanders'
};
const teamAliases: Record<string, string[]> = {
  ARI: ['arizona', 'cardinals'], ATL: ['atlanta', 'falcons'], BAL: ['baltimore', 'ravens'], BUF: ['buffalo', 'bills'], CAR: ['carolina', 'panthers'], CHI: ['chicago', 'bears'], CIN: ['cincinnati', 'bengals'], CLE: ['cleveland', 'browns'], DAL: ['dallas', 'cowboys'], DEN: ['denver', 'broncos'], DET: ['detroit', 'lions'], GB: ['green bay', 'packers'], HOU: ['houston', 'texans'], IND: ['indianapolis', 'colts'], JAC: ['jacksonville', 'jaguars'], KC: ['kansas city', 'chiefs'], LV: ['las vegas', 'raiders'], LAC: ['los angeles chargers', 'la chargers', 'chargers', 'los angeles c'], LAR: ['los angeles rams', 'la rams', 'rams', 'los angeles r'], MIA: ['miami', 'dolphins'], MIN: ['minnesota', 'vikings'], NE: ['new england', 'patriots'], NO: ['new orleans', 'saints'], NYG: ['new york giants', 'ny giants', 'giants', 'new york g'], NYJ: ['new york jets', 'ny jets', 'jets', 'new york j'], PHI: ['philadelphia', 'eagles'], PIT: ['pittsburgh', 'steelers'], SEA: ['seattle', 'seahawks'], SF: ['san francisco', '49ers', 'niners'], TB: ['tampa bay', 'buccaneers', 'bucs'], TEN: ['tennessee', 'titans'], WAS: ['washington', 'commanders']
};
function probability(raw: unknown): number | null { if (raw === '' || raw == null) return null; const n = Number(raw); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null; }
function formatPrice(raw: unknown, format: OddsFormat): string { const p = probability(raw); if (p === null) return '—'; if (format === 'probability') return `${(p * 100).toFixed(1)}%`; if (p <= 0 || p >= 1) return '—'; const n = Math.round(p >= 0.5 ? -100 * p / (1 - p) : 100 * (1 - p) / p); return n > 0 ? `+${n}` : String(n); }
function money(raw: unknown): string { const n = Number(raw); return Number.isFinite(n) && n > 0 ? '$' + n.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'; }
function marketId(m: Market) { return String(m.marketId || m.id || ''); }
function marketName(m: Market) { return m.name || m.title || 'Untitled market'; }
function gameName(m: Market) { return m.eventName || marketName(m); }
function kickoffTimestamp(value?: string | null) { const n = value ? Date.parse(value) : NaN; return Number.isFinite(n) ? n : Infinity; }
function formatKickoff(value?: string | null) { return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(value)) : 'Kickoff unavailable'; }
function normalizeMatchupName(raw: string) { return raw.replace(/ - (First Touchdown Scorer|Anytime Touchdown Scorer|Highest Scoring Quarter|Player Props|Team Props|Game Props|Passing Props|Rushing Props|Receiving Props|Touchdown Props|Alternate Spreads|Alternate Totals)$/i, '').trim(); }
function categoryOf(m: Market): Category { const s = `${m.marketType || ''} ${m.sportsMarketType || ''} ${marketName(m)}`.toLowerCase(); if (/player|passing yards|rushing yards|receiving yards|receptions|touchdown scorer|anytime touchdown|first touchdown|to score a touchdown/.test(s)) return 'Player Props'; if (/spread/.test(s)) return 'Spreads'; if (/total|over\/under|combined points|o\/u/.test(s)) return 'Totals'; if (/moneyline|winner|game winner|who will win/.test(s)) return 'Moneyline'; return 'Other'; }
// Conservative period classification: never treat an unknown period as a full-game contract.
function gamePeriod(m: Market): GamePeriod | null {
  const label = `${marketName(m)} ${m.groupItemTitle || ''} ${m.sportsMarketType || ''}`.toLowerCase();
  const slug = (m.eventSlug || '').toLowerCase();
  const text = `${label} ${slug}`;
  if (/\b(?:1st|first)[ -]?(?:quarter|qtr)\b|\bq1\b/.test(text)) return 'Q1';
  if (/\b(?:2nd|second)[ -]?(?:quarter|qtr)\b|\bq2\b/.test(text)) return 'Q2';
  if (/\b(?:3rd|third)[ -]?(?:quarter|qtr)\b|\bq3\b/.test(text)) return 'Q3';
  if (/\b(?:4th|fourth)[ -]?(?:quarter|qtr)\b|\bq4\b/.test(text)) return 'Q4';
  if (/\b(?:1st|first)[ -]?half\b|\b1h\b/.test(text)) return 'First Half';
  if (/\b(?:2nd|second)[ -]?half\b|\b2h\b/.test(text)) return 'Second Half';
  if (/\b(?:quarter|qtr|half|period|overtime)\b/.test(text)) return null;
  // Game-level event alone is not proof that a generic "winner" market is full-game.
  // Require the market to be the main event winner or explicitly say full game.
  const mainEvent = marketName(m).trim().toLowerCase() === (m.eventName || '').trim().toLowerCase();
  if (mainEvent || /\b(?:full[ -]?game|game winner|match winner|final result)\b/.test(label)) return 'Full Game';
  // Standard game spread/total markets often omit the words 'full game'.
  // Do not apply this inference to player props or unusual/unrecognized markets.
  if (categoryOf(m) === 'Spreads' && /\bspread\b/.test(label) && !/\b(?:team total|player|alternate quarter|half)\b/.test(label)) return 'Full Game';
  if (categoryOf(m) === 'Totals' && /\b(?:game total|total points|total:|over\/under|o\/u)\b/.test(label) && !/\b(?:team total|player)\b/.test(label)) return 'Full Game';
  return null;
}
function isTwoTeamMoneyline(m: Market, codes: string[]): boolean {
  if (categoryOf(m) !== 'Moneyline') return false;
  const outcomes = m.outcomes || [];
  const teams = outcomes.map(o => teamFromText(o.name || o.label || ''));
  return outcomes.length === 2 && teams.every(Boolean) && new Set(teams).size === 2 &&
    teams.every(t => codes.includes(t as string));
}
function groupGames(markets: Market[]): Game[] { const groups = new Map<string, Game>(); for (const m of markets) { const name = normalizeMatchupName(gameName(m)); const kickoff = m.gameStartTime || null; const id = `${name.toLowerCase()}:${kickoff || 'unknown'}`; const existing = groups.get(id); if (existing) existing.markets.push(m); else groups.set(id, { id, name, kickoff, markets: [m] }); } return [...groups.values()].sort((a, b) => kickoffTimestamp(a.kickoff) - kickoffTimestamp(b.kickoff) || a.name.localeCompare(b.name)); }
function teamFromText(raw: string): string | null { const text = raw.toLowerCase().replace(/[^a-z0-9 ]/g, ' '); const matches = Object.entries(teamAliases).filter(([, aliases]) => aliases.some(a => new RegExp(`(^|\\s)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(text))); return matches.length === 1 ? matches[0][0] : null; }
function matchupTeams(raw: string): string[] { const found = new Set<string>(); for (const [code, aliases] of Object.entries(teamAliases)) if (aliases.some(a => new RegExp(`(^|\\s)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(raw.toLowerCase().replace(/[^a-z0-9 ]/g, ' ')))) found.add(code); return [...found]; }
function kalshiDate(eventId: string): string | null { const m = eventId.match(/^KXNFLGAME-(\d{2})([A-Z]{3})(\d{1,2})/); if (!m) return null; const months: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 }; const month = months[m[2]]; if (month === undefined) return null; return `${2000 + Number(m[1])}-${String(month + 1).padStart(2, '0')}-${m[3].padStart(2, '0')}`; }
function gameLocalDate(value: string): string { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value)); const get = (type: string) => parts.find(p => p.type === type)?.value || ''; return `${get('year')}-${get('month')}-${get('day')}`; }
// Use the exchange's scheduled event date, not its contract settlement/close date.
function kalshiEventKey(eventId: string): string | null {
  const match = eventId.match(/^KXNFLGAME-(\d{2}[A-Z]{3}\d{1,2})([A-Z]+)$/);
  if (!match) return null;
  const date = kalshiDate(eventId);
  const suffix = match[2];
  const codes = Object.keys(teamNames).filter(code => code !== 'JAX').sort((a, b) => b.length - a.length);
  const pairs = codes.flatMap(a => codes.filter(b => b !== a && a + b === suffix).map(b => [a, b]));
  if (!date || pairs.length !== 1) return null;
  return `${date}:${pairs[0].sort().join(':')}`;
}
function polymarketEventKey(game: Game): string | null {
  if (!game.kickoff || !Number.isFinite(Date.parse(game.kickoff))) return null;
  let teams = matchupTeams(game.name);
  if (teams.length !== 2) {
    const slug = game.markets.find(m => m.eventSlug)?.eventSlug || '';
    const match = slug.match(/^nfl-([a-z]+)-([a-z]+)-\d{4}-\d{2}-\d{2}/i);
    const aliases: Record<string, string> = { la: 'LAR', lar: 'LAR', lac: 'LAC', buf: 'BUF', sf: 'SF', gb: 'GB', kc: 'KC', lv: 'LV', ne: 'NE', no: 'NO', nyg: 'NYG', nyj: 'NYJ', tb: 'TB', jax: 'JAC', jac: 'JAC', was: 'WAS' };
    if (match) teams = [match[1], match[2]].map(code => aliases[code.toLowerCase()] || code.toUpperCase());
  }
  if (teams.length !== 2 || teams[0] === teams[1]) return null;
  return `${gameLocalDate(game.kickoff)}:${teams.sort().join(':')}`;
}
type MatchDiagnostic = { eventId: string; matchup: string; reason: string };
function analyzeMatches(games: Game[], kalshi: KalshiMarket[]): { rows: Comparison[]; diagnostics: MatchDiagnostic[] } {
  const events = new Map<string, KalshiMarket[]>();
  for (const contract of kalshi) {
    const group = events.get(contract.eventId) || [];
    group.push(contract);
    events.set(contract.eventId, group);
  }
  const rows: Comparison[] = [];
  const diagnostics: MatchDiagnostic[] = [];
  for (const [eventId, contracts] of events) {
    const key = kalshiEventKey(eventId);
    const matchup = contracts.map(c => c.name.replace(/ wins$/i, '')).join(' vs. ');
    if (!key) { diagnostics.push({ eventId, matchup, reason: 'Could not decode Kalshi ticker' }); continue; }
    const candidates = games.filter(g => polymarketEventKey(g) === key);
    if (!candidates.length) { diagnostics.push({ eventId, matchup, reason: 'No Polymarket game with matching teams and Eastern game date' }); continue; }
    const markets = candidates.flatMap(g => g.markets.filter(m => categoryOf(m) === 'Moneyline' && gamePeriod(m) === 'Full Game'));
    const canonical = markets.filter(m => {
      const outcomes = m.outcomes || [];
      const codes = outcomes.map(o => teamFromText(o.name || o.label || ''));
      return outcomes.length === 2 && codes.every(Boolean) && new Set(codes).size === 2 &&
        key.endsWith(':' + [...codes].sort().join(':'));
    });
    const unique = [...new Map(canonical.map(m => [marketId(m), m])).values()];
    if (!unique.length) { diagnostics.push({ eventId, matchup, reason: 'Game found, but no comparable two-team moneyline' }); continue; }
    if (unique.length > 1) { diagnostics.push({ eventId, matchup, reason: 'Multiple full-game winner contracts; review required' }); continue; }
    const market = unique[0];
    const game = candidates.find(g => g.markets.includes(market)) || candidates[0];
    let added = 0;
    for (const outcome of market.outcomes || []) {
      const code = teamFromText(outcome.name || outcome.label || '');
      const contract = contracts.find(c => c.ticker.endsWith('-' + code));
      const ask = probability(contract?.yesAsk);
      const poly = probability(outcome.price);
      if (!code || !contract || ask === null || poly === null) continue;
      rows.push({ id: `${key}:${code}`, game, team: teamNames[code], polymarket: poly, kalshiAsk: ask, kalshiBid: probability(contract.yesBid), difference: (poly - ask) * 100 });
      added++;
    }
    if (added !== 2) diagnostics.push({ eventId, matchup, reason: `Only ${added} of 2 team prices comparable` });
  }
  return { rows: rows.sort((a, b) => kickoffTimestamp(a.game.kickoff) - kickoffTimestamp(b.game.kickoff) || a.team.localeCompare(b.team)), diagnostics };
}
function playerName(m: Market) { const title = marketName(m); const colon = title.indexOf(':'); if (colon > 0) return title.slice(0, colon).trim(); const match = title.match(/\s+(?:Passing Yards|Rushing Yards|Receiving Yards|Receptions|Anytime Touchdown|First Touchdown|Anytime TD|First TD|to score a touchdown)\b/i); return match?.index ? title.slice(0, match.index).trim() : m.groupItemTitle || 'Other Player Props'; }
function propType(m: Market) { const s = marketName(m).toLowerCase(); if (/anytime.*(?:td|touchdown)/.test(s)) return 'Anytime TD'; for (const name of ['Passing Yards', 'Rushing Yards', 'Receiving Yards', 'Receptions', 'First Touchdown']) if (s.includes(name.toLowerCase())) return name; return 'Other'; }
function buildSignals(markets: Market[], history: History, league: string): Signal[] { const result: Signal[] = []; for (const m of markets) (m.outcomes || []).forEach((o, i) => { const id = `${league}:${marketId(m)}:${o.outcomeId || i}`; const ticks = history[id] || []; if (ticks.length < 2 || ticks[ticks.length - 1].at - ticks[0].at < 60000) return; const opening = ticks[0].prob; const current = ticks[ticks.length - 1].prob; const change = (current - opening) * 100; if (Math.abs(change) < 0.5 || current < 1 / 3 || current > 0.85) return; result.push({ id, label: `${normalizeMatchupName(gameName(m))} · ${marketName(m)}`, outcome: o.name || o.label || `Outcome ${i + 1}`, league, opening, current, change, observations: ticks.length, score: Math.abs(change) }); }); return result.sort((a, b) => b.score - a.score); }

export default function Home() {
  const [history, setHistory] = useState<History>({});
  const [view, setView] = useState<'markets' | 'compare' | 'signals' | 'arb'>('markets');
  const league = 'NFL';
  const [query, setQuery] = useState('');
  const [markets, setMarkets] = useState<Market[]>([]);
  const [kalshi, setKalshi] = useState<KalshiMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kalshiError, setKalshiError] = useState('');
  const [updated, setUpdated] = useState('');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('Moneyline');
  const [period, setPeriod] = useState<GamePeriod>('Full Game');
  const [watch, setWatch] = useState<string[]>([]);
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>('probability');
  const [showAllPlayers, setShowAllPlayers] = useState(false);
  const [expandedPlayers, setExpandedPlayers] = useState<string[]>([]);
  useEffect(() => { try { setWatch(JSON.parse(localStorage.getItem(watchKey) || '[]')); setHistory(JSON.parse(localStorage.getItem(historyKey) || '{}')); const saved = localStorage.getItem(oddsKey); if (saved === 'american' || saved === 'probability') setOddsFormat(saved); } catch { /* browser storage unavailable */ } }, []);
  function changeOddsFormat(f: OddsFormat) { setOddsFormat(f); try { localStorage.setItem(oddsKey, f); } catch {} }
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const requests: Promise<Response>[] = [fetch(`/api/markets?league=${encodeURIComponent(league)}`, { cache: 'no-store' })];
      if (league === 'NFL') requests.push(fetch('/api/kalshi', { cache: 'no-store' }));
      const results = await Promise.allSettled(requests);
      const p = results[0];
      if (p.status !== 'fulfilled') throw new Error('Polymarket connection failed');
      const data = await p.value.json(); if (!p.value.ok) throw new Error(data.error || 'Unable to load markets');
      const incoming: Market[] = Array.isArray(data.markets) ? data.markets : [];
      setMarkets(incoming); setUpdated(data.updatedAt || new Date().toISOString()); setError('');
      setHistory(previous => {
        const next: History = { ...previous }; const now = Date.now();
        for (const m of incoming) (m.outcomes || []).forEach((o, i) => { const p = probability(o.price); if (p === null) return; const id = `${league}:${marketId(m)}:${o.outcomeId || i}`; const old = next[id] || []; if (!old.length || old[old.length - 1].prob !== p || now - old[old.length - 1].at >= 60000) next[id] = [...old, { at: now, prob: p }].slice(-500); });
        try { localStorage.setItem(historyKey, JSON.stringify(next)); } catch {} return next;
      });
      if (league === 'NFL') {
        const k = results[1];
        if (k.status === 'fulfilled') {
          try { const kd = await k.value.json(); if (!k.value.ok) throw new Error(kd.error || 'Kalshi unavailable'); setKalshi(Array.isArray(kd.markets) ? kd.markets : []); setKalshiError(''); }
          catch (e) { setKalshi([]); setKalshiError(e instanceof Error ? e.message : 'Kalshi unavailable'); }
        } else { setKalshi([]); setKalshiError('Kalshi connection failed'); }
      } else { setKalshi([]); setKalshiError(''); }
    } catch (e) { setMarkets([]); setError(e instanceof Error ? e.message : 'Connection error'); }
    finally { setLoading(false); }
  }, [league]);
  useEffect(() => { void load(); const timer = setInterval(() => { void load(); }, 60000); return () => clearInterval(timer); }, [load]);
  const games = useMemo(() => groupGames(markets), [markets]);
  const matchAnalysis = useMemo(() => analyzeMatches(games, kalshi), [games, kalshi]);
  const comparisons = matchAnalysis.rows;
  const signals = useMemo(() => buildSignals(markets, history, league), [markets, history, league]);
  const filteredGames = useMemo(() => games.filter(g => (!query || `${g.name} ${g.markets.map(marketName).join(' ')}`.toLowerCase().includes(query.toLowerCase())) && (!onlyWatch || g.markets.some(m => watch.includes(marketId(m))))), [games, query, onlyWatch, watch]);
  const selectedGame = games.find(g => g.id === selectedGameId) || null;
  const selectedMarkets = selectedGame?.markets.filter(m => categoryOf(m) === category && gamePeriod(m) === period) || [];
  const playerGroups = useMemo(() => {
    const groups = new Map<string, Market[]>(); for (const m of selectedMarkets) { const name = playerName(m); groups.set(name, [...(groups.get(name) || []), m]); }
    return [...groups.entries()].map(([name, items]) => ({ name, markets: [...items].sort((a, b) => (propType(b) === 'Anytime TD' ? 1 : 0) - (propType(a) === 'Anytime TD' ? 1 : 0) || Number(b.volume || 0) - Number(a.volume || 0)) })).sort((a, b) => Number(b.markets.some(m => propType(m) === 'Anytime TD')) - Number(a.markets.some(m => propType(m) === 'Anytime TD')) || b.markets.reduce((n, m) => n + Number(m.volume || 0), 0) - a.markets.reduce((n, m) => n + Number(m.volume || 0), 0));
  }, [selectedMarkets]);
  function resetPlayers() { setShowAllPlayers(false); setExpandedPlayers([]); }
  function openGame(g: Game) { setPeriod('Full Game'); setSelectedGameId(g.id); resetPlayers(); setCategory(categories.find(c => g.markets.some(m => categoryOf(m) === c)) || 'Moneyline'); }
  function toggleWatch(id: string) { const next = watch.includes(id) ? watch.filter(w => w !== id) : [...watch, id]; setWatch(next); try { localStorage.setItem(watchKey, JSON.stringify(next)); } catch {} }
    function renderMarketRow(m: Market, i: number) { const id = marketId(m) || String(i); return <tr key={id}><td><div className="marketname">{marketName(m)}</div>{m.line != null && <div className="marketid">Line: {m.line}</div>}</td><td><div className="outcomes">{(m.outcomes || []).map((o, index) => <span className="outcome" key={index}>{o.name || o.label || `Outcome ${index + 1}`} <strong>{formatPrice(o.price, oddsFormat)}</strong></span>)}</div></td><td className="volume">{money(m.volume)}</td><td><button className={'star ' + (watch.includes(id) ? 'saved' : '')} onClick={() => toggleWatch(id)} title="Toggle watchlist">{watch.includes(id) ? '★' : '☆'}</button></td></tr>; }
  return <div className="shell">
    <aside className="sidebar"><div className="brand"><div className="brandmark"><Activity size={23} /></div><div>LINE<span>SHIFT</span><small>SPORTS MARKET INTELLIGENCE</small></div></div><div className="navlabel">WORKSPACE</div>
      <button className={'navitem ' + (view === 'markets' ? 'active' : '')} onClick={() => setView('markets')}><BarChart3 size={18} />Market Overview</button>
      <button className={'navitem ' + (view === 'compare' ? 'active' : '')} onClick={() => { setView('compare'); setSelectedGameId(null); }}><TrendingUp size={18} />Market Comparison<b>{comparisons.length}</b></button>
      <button className={'navitem ' + (view === 'signals' ? 'active' : '')} onClick={() => setView('signals')}><Activity size={18} />Line Movement<b>{signals.length}</b></button>
      <button className={'navitem ' + (view === 'arb' ? 'active' : '')} onClick={() => setView('arb')}><TrendingUp size={18} />Arbitrage Scanner<b>0</b></button>
      <button className={'navitem ' + (onlyWatch ? 'active' : '')} onClick={() => { setOnlyWatch(!onlyWatch); setSelectedGameId(null); setView('markets'); }}><TrendingUp size={18} />Watchlist<b>{watch.length}</b></button>
      <div className="navlabel second">DATA SOURCES</div><div className="source"><span className={'dot ' + (error ? 'red' : '')} /><div>Polymarket Gamma API<small>{error ? 'Unavailable' : 'Read-only connection'}</small></div></div>
      <div className="source"><span className={'dot ' + (kalshiError ? 'red' : '')} /><div>Kalshi Markets API<small>{kalshiError ? 'Unavailable' : 'Read-only connection'}</small></div></div>
      <div className="sidebottom"><ShieldCheck size={18} /><span>Market data only<br /><small>No trades or account access</small></span></div>
    </aside>
    <main className="main"><header className="top"><div className="crumb">WORKSPACE <span>/</span> {view === 'compare' ? 'MARKET COMPARISON' : selectedGame && view === 'markets' ? 'MATCHUP DETAILS' : view === 'signals' ? 'LINE MOVEMENT' : view === 'arb' ? 'ARBITRAGE SCANNER' : 'MARKET OVERVIEW'}</div><div className="topright"><span className="live"><span className={'dot ' + (error ? 'red' : '')} />{error ? 'OFFLINE' : 'LIVE DATA'}</span><a href="https://docs.polymarket.com/" target="_blank" rel="noreferrer">API Docs <ExternalLink size={13} /></a></div></header>
      <div className="content"><div className="heading"><div><div className="eyebrow">TRACK THE LINES. SPOT THE SHIFTS.</div><h1>LineShift Overview<span className="headingdot">.</span></h1><p>Explore NFL prediction markets, compare exchange prices, and track the contracts that matter.</p></div><button className="refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''} />Refresh Data</button></div>
      <section className="stats"><div className="stat"><div className="stathead">AVAILABLE MATCHUPS<BarChart3 size={18} /></div><div className="statvalue">{loading && !games.length ? '…' : games.length.toLocaleString()}</div><div className="statfoot">Upcoming {league} events</div></div><div className="stat"><div className="stathead">AVAILABLE CONTRACTS<TrendingUp size={18} /></div><div className="statvalue">{markets.length.toLocaleString()}</div><div className="statfoot">Polymarket feed</div></div><div className="stat"><div className="stathead">DATA CONNECTION{error ? <WifiOff size={18} /> : <Wifi size={18} />}</div><div className="statvalue smaller">{error ? 'Unavailable' : 'Connected'}</div><div className="statfoot">Refreshes every 60 seconds</div></div><div className="stat"><div className="stathead">TRADING MODE<ShieldCheck size={18} /></div><div className="statvalue smaller">Read Only</div><div className="statfoot">No orders are placed</div></div></section>
      {(view === 'compare' || view === 'arb') && <div style={{ marginBottom: 18 }}><div className="eyebrow" style={{ marginBottom: 10 }}>MARKET PERIOD</div><div className="market-tabs" role="group" aria-label="Select game period">{gamePeriods.map(p => <button key={p} className={'market-tab ' + (period === p ? 'selected' : '')} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p}</button>)}</div></div>}
      {view === 'compare' && period !== 'Full Game' && <section className="panel"><div className="panelhead"><h2>{period} Comparison</h2></div><div className="empty"><ShieldCheck size={30} /><h3>No verified {period.toLowerCase()} comparisons</h3><p>Period-specific contracts require independently verified market identities and matching settlement rules on both exchanges. We will not substitute full-game prices or label uncertain contracts as comparable.</p></div></section>}
      {view === 'compare' && period === 'Full Game' && <section className="panel"><div className="panelhead"><div><div className="eyebrow">CROSS-EXCHANGE NFL MONEYLINES · {period.toUpperCase()}</div><h2>Market Comparison <span className="count">{period === 'Full Game' ? comparisons.length : 0}</span></h2></div><div className="last">{updated ? `Last updated ${new Date(updated).toLocaleTimeString()}` : 'Waiting for feed'}</div></div>
        <p className="signalintro">Compare Polymarket indicative prices with Kalshi YES ask prices. Lower displayed prices are highlighted, but this is <strong>not an arbitrage scanner</strong>. The feeds may have different liquidity, fees, and settlement terms. A difference does not guarantee a tradeable opportunity.</p>
        
        <p className="signalintro">Kalshi NFL games: {new Set(kalshi.map(k => k.eventId)).size} · Matched games: {new Set(comparisons.map(c => c.game.id)).size} · Kalshi events needing review: {matchAnalysis.diagnostics.length}.</p>
        {kalshiError && <div className="error"><CircleHelp size={18} /><div><strong>Kalshi feed unavailable</strong><div>{kalshiError}</div></div></div>}
        {error && <div className="error"><CircleHelp size={18} /><div><strong>Polymarket feed unavailable</strong><div>{error}</div></div></div>}
        <div className="tablewrap"><table><thead><tr><th>GAME / TEAM</th><th>POLYMARKET<br />INDICATIVE</th><th>KALSHI<br />YES ASK</th><th>PRICE DIFFERENCE</th><th>LOWER DISPLAYED PRICE</th></tr></thead><tbody>{comparisons.map(row => <tr key={row.id}><td><div className="marketname">{row.team}</div><div className="marketid">{row.game.name} · {formatKickoff(row.game.kickoff)}</div></td><td><strong style={{ color: row.polymarket < row.kalshiAsk ? '#b6f36c' : undefined }}>{formatPrice(row.polymarket, oddsFormat)}</strong></td><td><strong style={{ color: row.kalshiAsk < row.polymarket ? '#b6f36c' : undefined }}>{formatPrice(row.kalshiAsk, oddsFormat)}</strong></td><td>{Math.abs(row.difference).toFixed(1)} pp</td><td><span className="badge">{Math.abs(row.difference) < 0.05 ? 'Tie' : row.difference > 0 ? 'Kalshi' : 'Polymarket'}</span></td></tr>)}</tbody></table>{!comparisons.length && <div className="empty"><BarChart3 size={30} /><h3>No verified matches yet</h3><p>Both feeds may be working even when no identical NFL moneyline contracts can be matched. We only show unambiguous game, date, and team matches.</p><p>Kalshi markets loaded: {kalshi.length} · Polymarket markets loaded: {markets.length}</p></div>}</div>
        <div style={{ padding: '18px 20px', borderTop: '1px solid #343a40' }}><div className="eyebrow" style={{ marginBottom: 10 }}>MATCHING DIAGNOSTICS · {matchAnalysis.diagnostics.length} EVENTS NEED REVIEW</div><div className="tablewrap"><table><thead><tr><th>KALSHI GAME</th><th>EVENT ID</th><th>WHY NOT FULLY MATCHED</th></tr></thead><tbody>{matchAnalysis.diagnostics.map(d => <tr key={d.eventId}><td>{d.matchup}</td><td className="marketid">{d.eventId}</td><td>{d.reason}</td></tr>)}</tbody></table>{!matchAnalysis.diagnostics.length && <p className="muted">All returned Kalshi games matched two team prices.</p>}</div></div>
        <div className="panelbottom"><span>Kalshi YES ask vs. Polymarket indicative probability · Read only</span><span>American odds are calculated equivalents, not executable sportsbook quotes</span></div></section>}
      {view === 'signals' && <section className="panel signalpanel">
        <div className="panelhead"><div><div className="eyebrow">NFL PRICE TRACKER</div><h2>Price Changes <span className="count">{signals.length}</span></h2></div></div>
        <p className="signalintro">See how NFL contract prices have changed <strong>since you opened this page</strong>. These are observed prices, not betting recommendations. Large changes may be caused by incomplete or unreliable feed data and should be verified before use.</p>
        <div className="signalgrid">{signals.map(s => {
          const [matchup, ...details] = s.label.split(' · ');
          const rising = s.change > 0;
          const suspicious = Math.abs(s.change) >= 20;
          return <div className="signalcard" key={s.id} style={{padding: '20px', display: 'flex', flexDirection: 'column', gap: 10}}>
            <div className="eyebrow">{matchup || 'NFL game'}</div>
            <h3 style={{margin: 0, lineHeight: 1.35}}>{details.join(' · ') || s.label}</h3>
            <div className="muted" style={{fontSize: 13}}>Selection: <strong style={{color: '#f2f6fa'}}>{s.outcome}</strong></div>
            <div style={{borderTop: '1px solid #263644', paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap'}}>
              <div><div className="muted" style={{fontSize: 11, marginBottom: 5}}>FIRST SEEN → LATEST</div><strong style={{fontSize: 16}}>{formatPrice(s.opening, oddsFormat)} → {formatPrice(s.current, oddsFormat)}</strong></div>
              <div style={{textAlign: 'right'}}><div className="muted" style={{fontSize: 11, marginBottom: 5}}>IMPLIED CHANCE</div><strong className={rising ? 'positive' : 'negative'}>{rising ? '▲ Increased' : '▼ Decreased'} {Math.abs(s.change).toFixed(1)} points</strong></div>
            </div>
            <div className="muted" style={{fontSize: 12}}>{s.observations} price checks this session{suspicious ? ' · ⚠ Large change: verify feed accuracy' : ''}</div>
          </div>;
        })}{!signals.length && <div className="signalempty">No confirmed price changes yet. Leave this page open for a few minutes while prices refresh.</div>}</div>
      </section>}
      {view === 'arb' && <section className="panel signalpanel"><div className="panelhead"><div><div className="eyebrow">EXECUTABLE CROSS-EXCHANGE OPPORTUNITIES</div><h2>Arbitrage Scanner · {period} <span className="count">0</span></h2></div></div><div className="empty"><ShieldCheck size={30} /><h3>No qualifying arbitrage opportunities detected</h3><p>LineShift does not yet have verified executable asks, order-book depth, complete trading fees, and compatible settlement rules for both exchanges. Indicative Polymarket probabilities cannot establish a profitable arbitrage.</p><p>We'll enable results only after these checks are implemented. No picks or estimated profit claims are shown.</p></div></section>}
      {view === 'markets' && <section className="panel">{!selectedGame ? <><div className="panelhead"><div><div className="eyebrow">MATCHUP EXPLORER</div><h2>Upcoming Matchups <span className="count">{filteredGames.length}</span></h2></div><div className="last">{updated ? `Last updated ${new Date(updated).toLocaleTimeString()}` : 'Waiting for feed'}</div></div><div className="filters"><div className="leagues"><span className="chosen" style={{ display: 'inline-flex', alignItems: 'center', padding: '10px 18px', borderRadius: 8, fontWeight: 700, background: '#b6f36c', color: '#151a13' }}>NFL</span></div><div className="search"><Search size={16} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search teams or matchups" /></div></div>{error && <div className="error"><CircleHelp size={18} /><div><strong>Live feed temporarily unavailable.</strong><div>{error}</div></div></div>}<div className="tablewrap"><table><thead><tr><th>MATCHUP / KICKOFF</th><th>AVAILABLE CONTRACTS</th><th>MARKET TYPES</th><th>EXCHANGE</th></tr></thead><tbody>{filteredGames.map(g => <tr key={g.id} onClick={() => openGame(g)} style={{ cursor: 'pointer' }}><td><div className="marketname">{g.name}</div><div className="marketid" style={{ color: '#b6f36c', marginTop: 8 }}>{formatKickoff(g.kickoff)}</div><div className="marketid">Click to explore markets →</div></td><td className="volume">{g.markets.length.toLocaleString()}</td><td><div className="outcomes">{categories.filter(c => g.markets.some(m => categoryOf(m) === c)).map(c => <span key={c} className="badge">{c}</span>)}</div></td><td className="volume">Polymarket</td></tr>)}</tbody></table>{!loading && !filteredGames.length && <div className="empty"><BarChart3 size={30} /><h3>{error ? 'No live data' : 'No upcoming games found'}</h3><p>{error ? 'Try refreshing later.' : 'Try another search.'}</p></div>}{loading && !games.length && <div className="empty"><RefreshCw size={25} className="spin" /><p>Loading upcoming matchups…</p></div>}</div></> : <><div className="panelhead"><div><button className="backbutton" onClick={() => setSelectedGameId(null)}><ArrowLeft size={16} />Back to matchups</button><div className="eyebrow">{league} MATCHUP DETAILS</div><h2>{selectedGame.name}</h2><p className="muted">{formatKickoff(selectedGame.kickoff)}</p><p className="muted">{selectedGame.markets.length} available contracts · Polymarket</p></div></div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}><div className="eyebrow">DISPLAY PRICES AS</div><div style={{ display: 'flex', gap: 6, padding: 4, borderRadius: 8, border: '1px solid #343a40', background: '#191d21' }}>{(['probability', 'american'] as OddsFormat[]).map(f => <button key={f} onClick={() => changeOddsFormat(f)} aria-pressed={oddsFormat === f} style={{ padding: '9px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600, background: oddsFormat === f ? '#b6f36c' : 'transparent', color: oddsFormat === f ? '#151a13' : '#c7cbd0' }}>{f === 'probability' ? 'Probability %' : 'American Odds'}</button>)}</div></div>
      {category === 'Moneyline' && period === 'Full Game' && comparisons.some(r => r.game.id === selectedGame.id) && <div style={{ marginBottom: 20, padding: 16, border: '1px solid #343a40', borderRadius: 8, background: '#20262a' }}><div className="eyebrow" style={{ marginBottom: 12 }}>POLYMARKET VS. KALSHI</div><div className="tablewrap"><table><thead><tr><th>TEAM</th><th>POLYMARKET INDICATIVE</th><th>KALSHI YES ASK</th><th>LOWER PRICE</th></tr></thead><tbody>{comparisons.filter(r => r.game.id === selectedGame.id).map(r => <tr key={r.id}><td>{r.team}</td><td>{formatPrice(r.polymarket, oddsFormat)}</td><td>{formatPrice(r.kalshiAsk, oddsFormat)}</td><td>{Math.abs(r.difference) < 0.05 ? 'Tie' : r.difference > 0 ? 'Kalshi' : 'Polymarket'}</td></tr>)}</tbody></table></div></div>}
      {<div style={{ marginBottom: 14 }}><div className="eyebrow" style={{ marginBottom: 10 }}>GAME PERIOD</div><div className="market-tabs" role="group" aria-label="Game period">{gamePeriods.map(p => <button key={p} className={'market-tab ' + (period === p ? 'selected' : '')} aria-pressed={period === p} onClick={() => setPeriod(p)}>{p}<span>{selectedGame.markets.filter(m => categoryOf(m) === category && gamePeriod(m) === p).length}</span></button>)}</div></div>}
      <div className="market-tabs">{categories.map(c => <button key={c} className={'market-tab ' + (category === c ? 'selected' : '')} onClick={() => { setCategory(c); resetPlayers(); }}>{c}<span>{selectedGame.markets.filter(m => categoryOf(m) === c && gamePeriod(m) === period).length}</span></button>)}</div>
      {category === 'Player Props' ? <><div className="muted" style={{ padding: '16px 4px' }}>Showing {showAllPlayers ? playerGroups.length : Math.min(10, playerGroups.length)} of {playerGroups.length} players · Up to 3 featured props each · Anytime TDs prioritized {playerGroups.length > 10 && <button className="refresh" onClick={() => setShowAllPlayers(!showAllPlayers)}>{showAllPlayers ? 'Show Top 10 Players' : `Show All ${playerGroups.length} Players`}</button>}</div>{(showAllPlayers ? playerGroups : playerGroups.slice(0, 10)).map(group => { const expanded = expandedPlayers.includes(group.name); const shown = expanded ? group.markets : group.markets.slice(0, 3); return <div key={group.name} style={{ marginBottom: 24 }}><div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', background: '#20262a', border: '1px solid #343a40', borderRadius: '8px 8px 0 0' }}><strong>{group.name} <span className="muted">· {group.markets.length} props</span></strong>{group.markets.length > 3 && <button className="refresh" onClick={() => setExpandedPlayers(p => expanded ? p.filter(n => n !== group.name) : [...p, group.name])}>{expanded ? 'Show Less' : `Show ${group.markets.length - 3} More`}</button>}</div><div className="tablewrap"><table><thead><tr><th>PLAYER PROP / LINE</th><th>OUTCOMES & PRICES</th><th>VOLUME</th><th>WATCH</th></tr></thead><tbody>{shown.map(renderMarketRow)}</tbody></table></div></div>; })}{!selectedMarkets.length && <div className="empty"><h3>No player props available</h3></div>}</> : <div className="tablewrap"><table><thead><tr><th>MARKET / BETTING LINE</th><th>OUTCOMES & {oddsFormat === 'american' ? 'AMERICAN ODDS' : 'IMPLIED PROBABILITY'}</th><th>VOLUME</th><th>WATCH</th></tr></thead><tbody>{selectedMarkets.map(renderMarketRow)}</tbody></table>{!selectedMarkets.length && <div className="empty"><BarChart3 size={30} /><h3>No {category.toLowerCase()} contracts for {period}</h3><p>Try another market period or type. Markets with unclear periods are intentionally excluded.</p></div>}</div>}</>}
      <div className="panelbottom"><span>Source: Polymarket Gamma API · Read-only</span><span>{oddsFormat === 'american' ? 'American odds are calculated equivalents, not executable quotes' : 'Displayed probabilities are indicative, not guaranteed executable quotes'}</span></div></section>}
      <div className="disclaimer">LineShift is an independent demo dashboard and is not affiliated with Polymarket, Kalshi, or Novig. Cross-exchange comparisons require matching event dates, teams, and settlement terms. Market-implied probabilities are not guaranteed outcomes. American odds are mathematical conversions, not sportsbook quotes. Polymarket indicative prices are not necessarily executable; Kalshi asks may change before execution. Fees, depth, and liquidity are not included. This application does not place trades or provide financial advice.</div>
      </div></main></div>;
}
