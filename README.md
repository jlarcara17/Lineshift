# LineShift — Sports Market Intelligence

Personal, read-only Next.js sports market analytics project. Design direction: Kalshi × Robinhood.

## Run

```bash
npm install
npm run dev
```

Deploy as a Next.js project to Vercel.

## What works

- Novig market catalog proxy (subject to Novig endpoint availability and schema; not verified live)
- Market explorer and watchlist
- Line-movement tracking for outcomes with valid 0–1 prices, recorded every 60 seconds while the page is open
- Movement signals after at least two observations separated by a minute; shows percentage-point changes
- Select up to five positive-movement candidates and export JSON for manual review before Weekly Parlay import

## Important limitations

This is a portfolio MVP, not a verified production integration. The API endpoint `https://api.novig.com/v3/public/catalog/markets` and its response shape must be checked against Novig's current official docs. The dashboard never invents prices or fills in missing market data. Browser localStorage is not persistent server-side history: collection pauses when the browser is closed, and signals are scoped to the currently selected league. Weekly Hot Picks are **candidates**, not betting recommendations; selection is based on movement alone and does not yet enforce the Weekly Parlay rules (market type, -200 odds cutoff, diversification, player props). No automatic Wednesday job or Supabase integration is configured. No trades are placed.

## Next build

1. Verify Novig API authentication, supported endpoints, and field mappings.
2. Persist timestamped quotes in Supabase with a server-side scheduled collector.
3. Implement market normalization, liquidity filters, spread/prop classification, and Weekly Parlay odds cutoff.
4. Add Wednesday 4 AM ET weekly snapshot and publish reviewed picks to Weekly Parlay.
