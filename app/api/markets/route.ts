import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const POLYMARKET_API = 'https://gamma-api.polymarket.com';

const SERIES_IDS: Record<string, string> = {
  NFL: '12185',
};

type PolymarketMarket = {
  id?: string | number;
  question?: string;
  slug?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  volume?: string | number;
  active?: boolean;
  closed?: boolean;
  groupItemTitle?: string;
  sportsMarketType?: string;
  line?: number | string;
  gameStartTime?: string;
};

type PolymarketEvent = {
  id?: string | number;
  title?: string;
  slug?: string;
  startDate?: string;
  endDate?: string;
  gameStartTime?: string;
  markets?: PolymarketMarket[];
};

function parseArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);

      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    } catch {
      return [];
    }
  }

  return [];
}

function classifyMarket(market: PolymarketMarket): string {
  const question = (market.question || '').toLowerCase();
  const type = (market.sportsMarketType || '').toLowerCase();

  if (
    question.includes('passing yards') ||
    question.includes('rushing yards') ||
    question.includes('receiving yards') ||
    question.includes('receptions') ||
    question.includes('touchdown') ||
    type.includes('player')
  ) {
    return 'Player Props';
  }

  if (
    type.includes('spread') ||
    question.includes('spread') ||
    /[+-]\d+\.5/.test(question)
  ) {
    return 'Spreads';
  }

  if (
    type.includes('total') ||
    question.includes('total points') ||
    question.includes('over/under') ||
    question.includes('o/u')
  ) {
    return 'Totals';
  }

  if (
    type.includes('moneyline') ||
    question.includes('moneyline') ||
    question.includes('winner')
  ) {
    return 'Moneyline';
  }

  return 'Other';
}

function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : null;
}

function getKickoff(event: PolymarketEvent): string | null {
  // gameStartTime is the actual scheduled kickoff.
  // startDate is the market creation/opening date, NOT kickoff.
  const eventKickoff = validDate(event.gameStartTime);

  if (eventKickoff) {
    return eventKickoff;
  }

  for (const market of event.markets || []) {
    const marketKickoff = validDate(market.gameStartTime);

    if (marketKickoff) {
      return marketKickoff;
    }
  }

  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const league = (
    url.searchParams.get('league') || 'NFL'
  ).toUpperCase();

  if (!/^[A-Z0-9]{2,12}$/.test(league)) {
    return NextResponse.json(
      { error: 'Invalid league' },
      { status: 400 }
    );
  }

  const seriesId = SERIES_IDS[league];

  if (!seriesId) {
    return NextResponse.json({
      markets: [],
      updatedAt: new Date().toISOString(),
      source: 'Polymarket',
      message: `${league} integration is coming soon`,
    });
  }

  try {
    const endpoint =
      `${POLYMARKET_API}/events?` +
      new URLSearchParams({
        series_id: seriesId,
        active: 'true',
        closed: 'false',
        limit: '100',
      }).toString();

    const response = await fetch(endpoint, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`Polymarket returned ${response.status}`);
    }

    const payload: unknown = await response.json();

    if (!Array.isArray(payload)) {
      throw new Error('Unexpected Polymarket response format');
    }

    const now = Date.now();

    const events = (payload as PolymarketEvent[])
      .map((event) => ({
        event,
        kickoff: getKickoff(event),
      }))
      .filter(({ kickoff }) => {
        // Only show games with a verified future kickoff time.
        if (!kickoff) return false;

        return Date.parse(kickoff) > now;
      })
      .sort(
        (a, b) =>
          Date.parse(a.kickoff!) - Date.parse(b.kickoff!)
      );

    const markets = events.flatMap(({ event, kickoff }) =>
      (event.markets || [])
        .filter((market) => market.closed !== true)
        .map((market) => {
          const outcomes = parseArray(market.outcomes);
          const prices = parseArray(market.outcomePrices);

          return {
            marketId: `polymarket:${market.id}`,
            eventId: String(event.id || ''),
            eventName: event.title || 'Unknown matchup',
            eventSlug: event.slug || '',

            // This is the actual scheduled kickoff time.
            gameStartTime: kickoff,

            // Retain the original market start date separately.
            startDate: event.startDate || null,

            name:
              market.question ||
              event.title ||
              'Untitled market',

            marketType: classifyMarket(market),
            sportsMarketType: market.sportsMarketType || null,
            line: market.line ?? null,
            groupItemTitle: market.groupItemTitle || null,
            source: 'Polymarket',
            volume: market.volume,

            outcomes: outcomes.map((name, index) => {
              const rawPrice = prices[index];
              const numericPrice = Number(rawPrice);

              return {
                outcomeId: String(index),
                name,
                price:
                  rawPrice !== undefined &&
                  Number.isFinite(numericPrice) &&
                  numericPrice >= 0 &&
                  numericPrice <= 1
                    ? numericPrice
                    : null,
              };
            }),
          };
        })
    );

    return NextResponse.json({
      markets,
      updatedAt: new Date().toISOString(),
      source: 'Polymarket',
    });
  } catch (error) {
    return NextResponse.json(
      {
        markets: [],
        error:
          error instanceof Error
            ? error.message
            : 'Polymarket API unavailable',
        updatedAt: new Date().toISOString(),
      },
      { status: 502 }
    );
  }
}
