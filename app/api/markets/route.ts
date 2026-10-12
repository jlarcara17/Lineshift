import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

const SERIES_IDS: Record<string, string> = {
  NFL: '12185',
};

type PolymarketMarket = {
  id?: string | number;
  question?: string;
  slug?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  clobTokenIds?: string | string[];
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

type OrderBookLevel = {
  price?: string | number;
  size?: string | number;
};

type OrderBook = {
  bids?: OrderBookLevel[];
  asks?: OrderBookLevel[];
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

function validPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) &&
    number >= 0 &&
    number <= 1
    ? number
    : null;
}

function validSize(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? number
    : null;
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

async function getOrderBook(tokenId: string) {
  try {
    const endpoint =
      `${CLOB_API}/book?` +
      new URLSearchParams({
        token_id: tokenId,
      }).toString();

    const response = await fetch(endpoint, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return null;
    }

    const book: OrderBook = await response.json();

    const bids = (book.bids || [])
      .map((level) => ({
        price: validPrice(level.price),
        size: validSize(level.size),
      }))
      .filter(
        (level) =>
          level.price !== null && level.size !== null
      );

    const asks = (book.asks || [])
      .map((level) => ({
        price: validPrice(level.price),
        size: validSize(level.size),
      }))
      .filter(
        (level) =>
          level.price !== null && level.size !== null
      );

    const bestBid =
      bids.length > 0
        ? Math.max(...bids.map((level) => level.price!))
        : null;

    const bestAsk =
      asks.length > 0
        ? Math.min(...asks.map((level) => level.price!))
        : null;

    const bestBidSize =
      bestBid === null
        ? null
        : bids
            .filter((level) => level.price === bestBid)
            .reduce((sum, level) => sum + level.size!, 0);

    const bestAskSize =
      bestAsk === null
        ? null
        : asks
            .filter((level) => level.price === bestAsk)
            .reduce((sum, level) => sum + level.size!, 0);

    return {
      bestBid,
      bestAsk,
      bestBidSize,
      bestAskSize,
      spread:
        bestBid !== null && bestAsk !== null
          ? Number((bestAsk - bestBid).toFixed(4))
          : null,
      hasBuyLiquidity: bestAsk !== null && bestAskSize !== null && bestAskSize > 0,
      hasSellLiquidity: bestBid !== null && bestBidSize !== null && bestBidSize > 0,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  const league = (
    url.searchParams.get('league') || 'NFL'
  ).toUpperCase();

  const quotesFor = url.searchParams.get('quotesFor');

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
      `${GAMMA_API}/events?` +
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
      throw new Error(
        `Polymarket returned ${response.status}`
      );
    }

    const payload: unknown = await response.json();

    if (!Array.isArray(payload)) {
      throw new Error(
        'Unexpected Polymarket response format'
      );
    }

    const now = Date.now();

    const events = (payload as PolymarketEvent[])
      .map((event) => ({
        event,
        kickoff: getKickoff(event),
      }))
      .filter(
        ({ kickoff }) =>
          !!kickoff && Date.parse(kickoff) > now
      )
      .sort(
        (a, b) =>
          Date.parse(a.kickoff!) -
          Date.parse(b.kickoff!)
      );

    const markets = events.flatMap(
      ({ event, kickoff }) =>
        (event.markets || [])
          .filter((market) => market.closed !== true)
          .map((market) => {
            const outcomes = parseArray(market.outcomes);
            const prices = parseArray(market.outcomePrices);
            const tokenIds = parseArray(market.clobTokenIds);

            return {
              marketId: `polymarket:${market.id}`,
              eventId: String(event.id || ''),
              eventName: event.title || 'Unknown matchup',
              eventSlug: event.slug || '',
              gameStartTime: kickoff,
              startDate: event.startDate || null,
              name:
                market.question ||
                event.title ||
                'Untitled market',
              marketType: classifyMarket(market),
              sportsMarketType:
                market.sportsMarketType || null,
              line: market.line ?? null,
              groupItemTitle:
                market.groupItemTitle || null,
              source: 'Polymarket',
              volume: market.volume,
              outcomes: outcomes.map((name, index) => ({
                outcomeId: String(index),
                name,
                price: validPrice(prices[index]),
                tokenId: tokenIds[index] || null,
              })),
            };
          })
    );

    // Normal dashboard requests stay fast.
    // Order books are fetched only when a specific
    // market is requested using quotesFor.
    if (!quotesFor) {
      return NextResponse.json({
        markets,
        updatedAt: new Date().toISOString(),
        source: 'Polymarket',
      });
    }

    const selectedMarket = markets.find(
      (market) => market.marketId === quotesFor
    );

    if (!selectedMarket) {
      return NextResponse.json(
        { error: 'Market not found' },
        { status: 404 }
      );
    }

    const outcomesWithQuotes = await Promise.all(
      selectedMarket.outcomes.map(async (outcome) => {
        const orderBook = outcome.tokenId
          ? await getOrderBook(outcome.tokenId)
          : null;

        return {
          ...outcome,
          orderBook,
          quoteStatus: orderBook
            ? 'order_book_available'
            : 'order_book_unavailable',
        };
      })
    );

    return NextResponse.json({
      market: {
        ...selectedMarket,
        outcomes: outcomesWithQuotes,
      },
      updatedAt: new Date().toISOString(),
      source: 'Polymarket CLOB',
      note:
        'Best bids and asks are snapshots, not guaranteed execution prices. Available sizes may change.',
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
