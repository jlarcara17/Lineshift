import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
const HOST = 'https://api.novig.com';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const league = (url.searchParams.get('league') || 'NFL').toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(league)) return NextResponse.json({error:'Invalid league'}, {status:400});
  try {
    const endpoint = `${HOST}/v3/public/catalog/markets?league=${encodeURIComponent(league)}&limit=100`;
    const response = await fetch(endpoint, {cache:'no-store', signal:AbortSignal.timeout(9000)});
    if (!response.ok) throw new Error(`Novig returned ${response.status}`);
    const payload = await response.json();
    const markets = Array.isArray(payload) ? payload : (payload.items || payload.markets || []);
    return NextResponse.json({markets, updatedAt:new Date().toISOString(), source:'Novig public API'});
  } catch (e) {
    return NextResponse.json({markets:[], error:e instanceof Error?e.message:'Novig API unavailable', updatedAt:new Date().toISOString()}, {status:502});
  }
}
