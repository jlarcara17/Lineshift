import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2";

type KalshiMarket = {
  ticker: string;
  event_ticker: string;
  title: string;
  subtitle?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  status: string;
  yes_bid?: number;
  yes_ask?: number;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  last_price?: number;
  volume?: number;
  close_time?: string;
};

type KalshiResponse = {
  markets?: KalshiMarket[];
  cursor?: string;
};

function getPrice(dollars?: string, cents?: number): number | null {
  if (dollars !== undefined) {
    const price = Number(dollars);
    return Number.isFinite(price) && price >= 0 && price <= 1
      ? price
      : null;
  }

  if (typeof cents === "number") {
    return cents >= 0 && cents <= 100 ? cents / 100 : null;
  }

  return null;
}

export async function GET() {
  try {
    const endpoint =
      `${KALSHI_API}/markets?` +
      new URLSearchParams({
        status: "open",
        limit: "1000",
      }).toString();

    const response = await fetch(endpoint, {
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      throw new Error(`Kalshi returned ${response.status}`);
    }

    const data: KalshiResponse = await response.json();

    const markets = (data.markets || [])
      .filter((market) => market.ticker.startsWith("KXNFL"))
      .map((market) => ({
        marketId: `kalshi:${market.ticker}`,
        eventId: market.event_ticker,
        name: market.title,
        subtitle: market.subtitle || null,
        yesSubtitle: market.yes_sub_title || null,
        noSubtitle: market.no_sub_title || null,
        source: "Kalshi",
        status: market.status,
        yesBid: getPrice(market.yes_bid_dollars, market.yes_bid),
        yesAsk: getPrice(market.yes_ask_dollars, market.yes_ask),
        volume: market.volume ?? null,
        closeTime: market.close_time || null,
      }));

    return NextResponse.json({
      markets,
      count: markets.length,
      updatedAt: new Date().toISOString(),
      source: "Kalshi",
      note:
        "Initial NFL market discovery. Market matching and pagination will be added after verifying the response.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        markets: [],
        error:
          error instanceof Error
            ? error.message
            : "Kalshi API unavailable",
      },
      { status: 502 }
    );
  }
}
