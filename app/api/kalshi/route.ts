import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2";

// NFL game-winner markets
const NFL_SERIES = "KXNFLGAME";

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
  volume?: number;
  close_time?: string;
};

type KalshiResponse = {
  markets?: KalshiMarket[];
  cursor?: string;
};

function getPrice(
  dollars?: string,
  cents?: number
): number | null {
  if (dollars !== undefined && dollars !== "") {
    const price = Number(dollars);

    return Number.isFinite(price) &&
      price >= 0 &&
      price <= 1
      ? price
      : null;
  }

  if (typeof cents === "number") {
    return cents >= 0 && cents <= 100
      ? cents / 100
      : null;
  }

  return null;
}

export async function GET() {
  try {
    const allMarkets: KalshiMarket[] = [];
    let cursor = "";
    let pagesFetched = 0;

    // Retrieve NFL markets directly, including additional pages.
    do {
      const params = new URLSearchParams({
        series_ticker: NFL_SERIES,
        status: "open",
        limit: "1000",
      });

      if (cursor) {
        params.set("cursor", cursor);
      }

      const response = await fetch(
        `${KALSHI_API}/markets?${params.toString()}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Kalshi returned ${response.status}`
        );
      }

      const data: KalshiResponse = await response.json();

      allMarkets.push(...(data.markets || []));

      cursor = data.cursor || "";
      pagesFetched++;

      // Safety limit to avoid excessive API requests.
    } while (cursor && pagesFetched < 5);

    const markets = allMarkets.map((market) => ({
      marketId: `kalshi:${market.ticker}`,
      eventId: market.event_ticker,
      ticker: market.ticker,
      name: market.title,
      subtitle: market.subtitle || null,
      yesSubtitle: market.yes_sub_title || null,
      noSubtitle: market.no_sub_title || null,
      source: "Kalshi",
      status: market.status,
      yesBid: getPrice(
        market.yes_bid_dollars,
        market.yes_bid
      ),
      yesAsk: getPrice(
        market.yes_ask_dollars,
        market.yes_ask
      ),
      volume: market.volume ?? null,
      closeTime: market.close_time || null,
    }));

    return NextResponse.json({
      markets,
      count: markets.length,
      pagesFetched,
      updatedAt: new Date().toISOString(),
      source: "Kalshi",
      series: NFL_SERIES,
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
