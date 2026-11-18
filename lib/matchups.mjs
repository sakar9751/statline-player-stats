/**
 * Matchup data adapters for STATLINE.
 * ESPN feeds are unofficial: normalize only data that actually exists.
 */
const ESPN_SITE = 'https://site.api.espn.com';
const ESPN_WEB = 'https://site.web.api.espn.com';
const SPORT = { nba: 'basketball', nfl: 'football' };
const responseCache = new Map();
const teamCache = new Map();

class DataError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const numeric = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const clean = value.replaceAll(',', '').trim();
  return /^-?\d+(?:\.\d+)?$/.test(clean) ? Number(clean) : null;
};
const validId = value => /^\d{1,12}$/.test(String(value || ''));
const validSeason = value => Number.isInteger(Number(value)) && Number(value) >= 2000 && Number(value) <= 2100;
const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function fetchJson(url, ttl = 180000) {
  const cached = responseCache.get(url);
  if (cached && cached.until > Date.now()) return cached.data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 11000);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'STATLINE/2.0' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('ESPN responded with HTTP ' + response.status);
    const data = await response.json();
    responseCache.set(url, { data, until: Date.now() + ttl });
    if (responseCache.size > 400) responseCache.delete(responseCache.keys().next().value);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function todayInChicago(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(dateString, days) {
  const date = new Date(dateString + 'T12:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeGame(event, league) {
  const competition = event.competitions?.[0] || {};
  const participants = competition.competitors || [];
  const toTeam = side => {
    const raw = participants.find(c => c.homeAway === side);
    if (!raw) return null;
    const team = raw.team || {};
    return {
      id: String(team.id || raw.id || ''),
      abbreviation: team.abbreviation || '',
      name: team.displayName || team.name || '',
      shortName: team.shortDisplayName || team.name || team.abbreviation || '',
      logo: team.logo || team.logos?.[0]?.href || '',
      color: /^([0-9a-f]{6})$/i.test(team.color || '') ? '#' + team.color : '',
      score: raw.score ?? null,
      record: raw.records?.find(r => r.name === 'overall')?.summary || raw.records?.[0]?.summary || '',
    };
  };
  const status = event.status || {};
  const state = status.type?.state || 'pre';
  const format = competition.broadcasts?.[0]?.names?.[0] || competition.broadcasts?.[0]?.media?.shortName || '';
  return {
    id: String(event.id || ''),
    league,
    start: event.date || '',
    season: Number(event.season?.year || 0),
    week: Number(event.week?.number || event.week || 0),
    state: ['pre', 'in', 'post'].includes(state) ? state : 'pre',
    statusText: status.type?.shortDetail || status.type?.detail || status.type?.description || '',
    period: status.period || 0,
    clock: status.displayClock || '',
    venue: competition.venue?.fullName || '',
    broadcast: format,
    away: toTeam('away'),
    home: toTeam('home'),
  };
}

export async function getGames(league, date, now = new Date()) {
  if (!SPORT[league]) throw new DataError(400, 'Choose NBA or NFL.');
  const localToday = todayInChicago(now);
  if (league === 'nba') {
    const selection = date || localToday;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selection) || Number.isNaN(Date.parse(selection))) {
      throw new DataError(400, 'Date must be YYYY-MM-DD.');
    }
    const dateKey = selection.replaceAll('-', '');
    const data = await fetchJson(`${ESPN_SITE}/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateKey}&limit=50`, 70000);
    const games = (data.events || []).map(e => normalizeGame(e, league)).filter(g => g.home && g.away);
    return { league, date: selection, today: localToday, games: games.sort((a, b) => a.start.localeCompare(b.start)) };
  }
  // ESPN's week-aware NFL feed is preferred. Search ahead in case Monday's
  // scoreboard still points to the just-finished week.
  const start = localToday.replaceAll('-', '');
  const end = addDays(localToday, 15).replaceAll('-', '');
  let data;
  try {
    data = await fetchJson(`${ESPN_SITE}/apis/site/v2/sports/football/nfl/scoreboard?dates=${start}-${end}&limit=100`, 120000);
  } catch {
    data = await fetchJson(`${ESPN_SITE}/apis/site/v2/sports/football/nfl/scoreboard?limit=100`, 120000);
  }
  let games = (data.events || []).map(e => normalizeGame(e, league)).filter(g => g.home && g.away && g.state !== 'post');
  if (!games.length) {
    // Fallback for endpoints that treat dates= as a single week.
    const week = Number(data.week?.number || data.events?.[0]?.week?.number || 0);
    const season = Number(data.leagues?.[0]?.season?.year || now.getUTCFullYear());
    if (week && week < 22) {
      const next = await fetchJson(`${ESPN_SITE}/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week + 1}&limit=100`, 120000);
      games = (next.events || []).map(e => normalizeGame(e, league)).filter(g => g.home && g.away && g.state !== 'post');
    }
  }
  games.sort((a, b) => a.start.localeCompare(b.start));
  return { league, date: localToday, today: localToday, games: games.slice(0, 24) };
}

function rosterAthletes(payload) {
  const groups = payload.athletes || payload.items || [];
  const collected = [];
  for (const item of groups) {
    if (Array.isArray(item.items)) collected.push(...item.items);
    else if (item.athletes && Array.isArray(item.athletes)) collected.push(...item.athletes);
    else collected.push(item.athlete || item);
  }
  const seen = new Set();
  return collected.flatMap(raw => {
    const id = String(raw?.id || '');
    if (!validId(id) || seen.has(id)) return [];
    seen.add(id);
    const status = raw.status?.type || '';
    return [{
      id,
      name: raw.displayName || raw.fullName || [raw.firstName, raw.lastName].filter(Boolean).join(' ') || 'Player',
      position: raw.position?.abbreviation || raw.position?.displayName || '',
      image: raw.headshot?.href || '',
      jersey: raw.jersey || '',
      inactive: /inactive|out|suspended|reserve/i.test(status),
      injury: raw.injuries?.[0]?.status || '',
      depth: Number(raw.depth || raw.depthOrder || 99),
    }];
  });
}

function selectCandidates(roster, league) {
  if (league === 'nba') return roster.slice(0, 18);
  // Only offensive fantasy-relevant roles; no defensive volume is conflated
  // with receptions or passing yards.
  const buckets = [
    ['QB', 3], ['RB', 6], ['FB', 1], ['WR', 10], ['TE', 5],
  ];
  const selected = [];
  for (const [position, cap] of buckets) {
    const matches = roster.filter(p => p.position.toUpperCase() === position);
    selected.push(...matches.sort((a, b) => a.depth - b.depth).slice(0, cap));
  }
  return selected.slice(0, 25);
}

function regularGameRows(data) {
  const rows = new Map();
  for (const season of data?.seasonTypes || []) {
    const type = [season.name, season.displayName, season.type?.name].filter(Boolean).join(' ').toLowerCase();
    const code = String(season.id || season.type?.id || season.type || '');
    if (/preseason|postseason|playoff/.test(type) || ['1', '3'].includes(code)) continue;
    for (const cat of season.categories || []) {
      if (cat.type === 'total') continue;
      for (const event of cat.events || []) {
        if (!event.eventId || !Array.isArray(event.stats)) continue;
        const current = rows.get(String(event.eventId));
        if (!current || current.length < event.stats.length) rows.set(String(event.eventId), event.stats);
      }
    }
  }
  return [...rows.values()];
}

function indexFor(names, labels, namePatterns, labelPatterns, after = -1, before = Infinity) {
  const allNames = names.map(norm), allLabels = labels.map(norm);
  let i = allNames.findIndex((value, index) => index > after && index < before && namePatterns.some(p => p.test(value)));
  if (i >= 0) return i;
  return allLabels.findIndex((value, index) => index > after && index < before && labelPatterns.some(p => p.test(value)));
}

function findStatIndex(names, labels, key, position) {
  const ix = (np, lp, after = -1, before = Infinity) => indexFor(names, labels, np, lp, after, before);
  const pass = ix([/completionspassingattempts/, /passingcompletions/], [/catt/, /cmpatt/, /cmp/, /comp/]);
  const carries = ix([/rushingattempts/, /carries/], [/car/, /rushatt/]);
  const reception = ix([/receptions/], [/rec/]);
  const firstYard = ix([/passingyards/], [/passyds/]);
  const isQB = String(position).toUpperCase() === 'QB';
  const defs = {
    minutes: [[/^minutes$/, /minutesplayed/], [/^min$/]],
    points: [[/^points$/, /^avgpoints$/, /totalpoints/], [/^pts$/]],
    rebounds: [[/totalrebounds/, /^rebounds$/, /avgrebounds/], [/^reb$/]],
    assists: [[/^assists$/, /avgassists/], [/^ast$/]],
    steals: [[/^steals$/], [/^stl$/]],
    blocks: [[/^blocks$/], [/^blk$/]],
    turnovers: [[/^turnovers$/], [/^to$/]],
    fieldGoals: [[/^fieldgoals$/, /^fieldgoalsmadefieldgoalsattempted$/], [/^fg$/]],
    threes: [[/^threepointfieldgoals$/], [/^3pt$/, /^3p$/]],
    freeThrows: [[/^freethrows$/], [/^ft$/]],
    passAttempts: [[/passingattempts/, /passattempts/], [/^att$/, /^passatt$/, /^catt$/, /^cmpatt$/]],
    completions: [[/passingcompletions/, /^completions$/], [/^cmp$/, /^comp$/, /^catt$/, /^cmpatt$/]],
    passingYards: [[/passingyards/], [/^passyds$/]],
    passingTDs: [[/passingtouchdowns/, /passtds/], [/^passtd$/]],
    interceptions: [[/passinginterceptions/, /^interceptions$/], [/^int$/]],
    carries: [[/rushingattempts/, /carries/], [/^car$/, /^rushatt$/]],
    rushingYards: [[/rushingyards/], [/^rushyds$/]],
    rushingTDs: [[/rushingtouchdowns/, /rushtds/], [/^rushtd$/]],
    targets: [[/receivingtargets/, /^targets$/], [/^tgts?$/, /^targets$/]],
    receptions: [[/^receptions$/, /receivingreceptions/], [/^rec$/]],
    receivingYards: [[/receivingyards/], [/^recyds$/]],
    receivingTDs: [[/receivingtouchdowns/, /rectds/], [/^rectd$/]],
  };
  const [np, lp] = defs[key] || [[], []];
  let result = ix(np, lp);
  if (result >= 0) return result;
  if (key === 'passingYards' && isQB) return ix([], [/^yds$/], -1, carries >= 0 ? carries : Infinity);
  if (key === 'passingTDs' && isQB) return ix([], [/^td$/], -1, carries >= 0 ? carries : Infinity);
  if (key === 'rushingYards') return ix([], [/^yds$/], carries);
  if (key === 'rushingTDs') return ix([], [/^td$/], carries);
  if (key === 'receivingYards') return ix([], [/^yds$/], reception);
  if (key === 'receivingTDs') return ix([], [/^td$/], reception);
  if (key === 'passAttempts' && isQB) return pass;
  if (key === 'completions' && isQB) return pass;
  if (key === 'passingYards') return firstYard;
  return -1;
}

const NBA_STATS = ['minutes', 'points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'fieldGoalAttempts', 'threePointAttempts', 'freeThrowAttempts'];
const NFL_STATS = ['passAttempts', 'completions', 'passingYards', 'passingTDs', 'interceptions', 'carries', 'rushingYards', 'rushingTDs', 'targets', 'receptions', 'receivingYards', 'receivingTDs'];

export function seasonLineFromGameLog(data, league, position = '') {
  const labels = Array.isArray(data?.labels) ? data.labels : [];
  const names = Array.isArray(data?.names) ? data.names : [];
  const games = regularGameRows(data);
  const keys = league === 'nba' ? NBA_STATS : NFL_STATS;
  const metric = (stats, key) => {
    const paired = { fieldGoalAttempts: 'fieldGoals', threePointAttempts: 'threes', freeThrowAttempts: 'freeThrows' };
    if (paired[key]) {
      const index = findStatIndex(names, labels, paired[key], position);
      const value = String(stats[index] ?? '');
      const matched = value.match(/^\s*\d+(?:\.\d+)?\s*[-/]\s*(\d+(?:\.\d+)?)\s*$/);
      return matched ? Number(matched[1]) : null;
    }
    const index = findStatIndex(names, labels, key, position);
    if (index < 0) return null;
    let value = stats[index];
    if (key === 'passAttempts' || key === 'completions') {
      const pair = String(value ?? '').match(/^\s*(\d+)\s*[-/]\s*(\d+)\s*$/);
      if (pair) return Number(pair[key === 'completions' ? 1 : 2]);
    }
    return numeric(value);
  };
  const totals = {}, perGame = {};
  for (const key of keys) {
    const vals = games.map(game => metric(game, key)).filter(v => v !== null);
    totals[key] = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    perGame[key] = vals.length ? totals[key] / vals.length : null;
  }
  return { gamesPlayed: games.length, totals, perGame };
}

function rank(line, league, position) {
  const t = line.totals;
  const n = key => t[key] || 0;
  if (league === 'nba') return n('minutes') * 0.55 + n('points') * 1.4 + n('assists') * 0.5 + n('rebounds') * 0.3;
  if (position === 'QB') return n('passAttempts') * 0.65 + n('passingYards') * 0.03 + n('passingTDs') * 3 + n('carries') * 0.3;
  return n('carries') + n('targets') * 1.15 + (n('rushingYards') + n('receivingYards')) * 0.055 + (n('rushingTDs') + n('receivingTDs')) * 4;
}

async function mapWithConcurrency(items, limit, fn) {
  let cursor = 0;
  const results = Array(items.length);
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try { results[index] = await fn(items[index]); } catch { results[index] = null; }
    }
  }));
  return results;
}

export async function getTeamPlayers(league, team, season) {
  if (!SPORT[league]) throw new DataError(400, 'Choose NBA or NFL.');
  if (!validId(team)) throw new DataError(400, 'Invalid team identifier.');
  if (!validSeason(season)) throw new DataError(400, 'Invalid season.');
  const cacheKey = `${league}:${team}:${season}`;
  const hit = teamCache.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.data;
  const rosterUrl = `${ESPN_SITE}/apis/site/v2/sports/${SPORT[league]}/${league}/teams/${team}/roster?season=${season}`;
  const rosterData = await fetchJson(rosterUrl, 900000);
  const roster = selectCandidates(rosterAthletes(rosterData), league);
  if (!roster.length) throw new DataError(502, 'ESPN did not return a roster for this team.');
  const entries = await mapWithConcurrency(roster, 5, async athlete => {
    const endpoint = `${ESPN_WEB}/apis/common/v3/sports/${SPORT[league]}/${league}/athletes/${athlete.id}/gamelog?season=${season}`;
    const log = await fetchJson(endpoint, 900000);
    const line = seasonLineFromGameLog(log, league, athlete.position);
    return { ...athlete, ...line, score: rank(line, league, athlete.position.toUpperCase()) };
  });
  const available = entries.filter(p => p?.gamesPlayed > 0);
  // For NFL, include the primary quarterback even when skill-player volume
  // is high. Otherwise rank all players by documented involvement score.
  let ranked = available.sort((a, b) => b.score - a.score);
  if (league === 'nfl') {
    const quarterback = ranked.filter(p => p.position.toUpperCase() === 'QB').sort((a, b) => b.score - a.score)[0];
    if (quarterback) ranked = [quarterback, ...ranked.filter(p => p.id !== quarterback.id)];
  }
  const selected = ranked.slice(0, 7);
  const data = {
    league, teamId: team, season: Number(season),
    players: selected.map(({ score, depth, ...player }) => player),
    count: selected.length,
    ranking: league === 'nba'
      ? 'Seven leaders by season playing time and production'
      : 'Top offensive contributors by season opportunities and production',
    note: selected.length < 7
      ? 'ESPN returned fewer than seven players with usable regular-season game logs.'
      : '',
    dataAsOf: new Date().toISOString(),
  };
  teamCache.set(cacheKey, { data, until: Date.now() + 600000 });
  if (teamCache.size > 100) teamCache.delete(teamCache.keys().next().value);
  return data;
}

export async function getGameBoxscore(league, eventId) {
  if (!SPORT[league]) throw new DataError(400, 'Choose NBA or NFL.');
  if (!validId(eventId)) throw new DataError(400, 'Invalid game identifier.');
  const data = await fetchJson(`${ESPN_SITE}/apis/site/v2/sports/${SPORT[league]}/${league}/summary?event=${eventId}`, 45000);
  const teams = [];
  for (const group of data.boxscore?.players || []) {
    const athletes = [];
    for (const section of group.statistics || []) {
      const labels = section.labels || section.names || [];
      for (const row of section.athletes || []) {
        const athlete = row.athlete || {};
        const metrics = {};
        labels.forEach((label, index) => {
          const val = row.stats?.[index];
          if (val !== undefined && val !== null && val !== '') metrics[norm(label)] = String(val);
        });
        athletes.push({ id: String(athlete.id || ''), name: athlete.displayName || '', metrics });
      }
    }
    teams.push({ teamId: String(group.team?.id || ''), athletes });
  }
  return { league, eventId, teams, updatedAt: new Date().toISOString() };
}

export async function serveMatchup(endpoint, request) {
  if (request.method !== 'GET') return Response.json({ error: 'GET only.' }, { status: 405 });
  const params = new URL(request.url).searchParams;
  try {
    const league = params.get('league');
    let data;
    if (endpoint === 'games') data = await getGames(league, params.get('date'));
    else if (endpoint === 'team') data = await getTeamPlayers(league, params.get('team'), params.get('season'));
    else if (endpoint === 'boxscore') data = await getGameBoxscore(league, params.get('event'));
    else throw new DataError(404, 'Unknown endpoint.');
    const maxAge = endpoint === 'games' ? 60 : endpoint === 'team' ? 600 : 40;
    return Response.json(data, {
      headers: {
        'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=120`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return Response.json({ error: error.message || 'Sports data is unavailable.' }, {
      status: error.status || 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

export const __testing = { todayInChicago, normalizeGame, rosterAthletes, selectCandidates, regularGameRows, findStatIndex };
