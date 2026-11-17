/** Shared ESPN request helper for the Vercel serverless API routes. */
const WEB = 'https://site.web.api.espn.com';
const SITE = 'https://site.api.espn.com';
const SPORTS = Object.freeze({ nba: 'basketball', nfl: 'football' });
const cache = new Map();

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function remote(url, ttl = 180000) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'PlayerSeasonStats/1.0' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Sports data provider returned ${response.status}`);
    const data = await response.json();
    cache.set(url, { at: Date.now(), data });
    if (cache.size > 300) cache.delete(cache.keys().next().value);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function getSportsData(endpoint, params) {
  const league = params.get('league');
  if (!SPORTS[league]) throw new RequestError(400, 'Choose NBA or NFL.');
  let url;
  if (endpoint === 'search') {
    const q = (params.get('q') || '').trim().slice(0, 90);
    if (q.length < 2) return { results: [] };
    url = `${SITE}/apis/search/v2?query=${encodeURIComponent(q)}&limit=25`;
  } else if (endpoint === 'profile' || endpoint === 'gamelog') {
    const id = params.get('id') || '';
    if (!/^\d{1,12}$/.test(id)) throw new RequestError(400, 'Invalid athlete id.');
    const prefix = `${WEB}/apis/common/v3/sports/${SPORTS[league]}/${league}/athletes/${id}`;
    if (endpoint === 'profile') {
      url = `${prefix}/overview`;
    } else {
      const season = Number(params.get('season'));
      if (!Number.isInteger(season) || season < 2000 || season > 2100) {
        throw new RequestError(400, 'Invalid season.');
      }
      url = `${prefix}/gamelog?season=${season}`;
    }
  } else {
    throw new RequestError(404, 'Unknown endpoint.');
  }
  try {
    return await remote(url, endpoint === 'search' ? 180000 : 300000);
  } catch (error) {
    throw new RequestError(502, `Unable to load ESPN data: ${error.message}`);
  }
}

export async function serveEndpoint(endpoint, request) {
  if (request.method !== 'GET') {
    return Response.json({ error: 'GET only' }, { status: 405, headers: { Allow: 'GET' } });
  }
  const url = new URL(request.url);
  try {
    const data = await getSportsData(endpoint, url.searchParams);
    return Response.json(data, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Unable to load data.' }, {
      status: error.status || 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
