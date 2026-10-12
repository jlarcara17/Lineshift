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
};

type PolymarketEvent = {
  id?: string | number;
  title?: string;
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const league = (url.searchParams.get('league') || 'NFL').toUpperCase();

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

    const events = payload as PolymarketEvent[];

    const markets = events.flatMap((event) =>
      (event.markets || [])
        .filter((market) => market.closed !== true)
        .map((market) => {
          const outcomes = parseArray(market.outcomes);
          const prices = parseArray(market.outcomePrices);

          return {
            marketId: `polymarket:${market.id}`,
            name: market.question || event.title || 'Untitled market',
            eventName: event.title || market.question,
            marketType: 'Prediction Market',
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
