# STATLINE — NBA & NFL Game-Day Scouting

A mobile-first matchup dashboard that shows today's NBA games and upcoming NFL games, with the seven season-leading offensive contributors on each team. Select a game, compare each club's players, and switch between season averages and totals. Every stat has a full, readable name.

The previous player-by-player season game log is preserved at **`/player.html`** and accessible through the **Player Search** link and every player's **Full season** link.

## Deploy using GitHub + Vercel

1. Import `sakar9751/statline-player-stats` into [Vercel](https://vercel.com/new), or let your already-connected Vercel project deploy the next `main` commit.
2. Use:
   - Framework Preset: **Other**
   - Root Directory: `./`
   - Build Command: **none (blank)**
   - Output Directory: **default** (root, because there is no `public/` directory)
   - Environment Variables: **none required**
3. Deploy. Check the homepage, then test `/api/games?league=nba` and a selected matchup's seven-player stats.

Vercel serves `index.html` and `player.html` as static assets and runs `api/` as Node.js serverless functions. The public API proxies ESPN to avoid browser CORS restrictions, with a shared cache (best-effort in serverless) and CDN cache headers.

## Run locally

Requires Node.js 18+ and no external packages or API keys.

```bash
npm start
```

Visit <http://localhost:3000>. This starts `server.js` for local development; on Vercel, the serverless handlers under `api/` serve the same endpoints.

## API

- `GET /api/games?league=nba&date=2026-11-17` — NBA scoreboard on a Central Time date.
- `GET /api/games?league=nfl` — upcoming games in the next two weeks.
- `GET /api/team?league=nba&team=2&season=2027` — top seven players by regular-season contribution, with totals and per-game stats.
- `GET /api/boxscore?league=nba&event=401000001` — game box score when available.
- `GET /api/search?league=nba&q=Stephen%20Curry`
- `GET /api/gamelog?league=nfl&id=3918298&season=2026`
- `GET /api/profile?league=nba&id=3975`

## Important limitations

- ESPN's JSON endpoints are **unofficial and undocumented**. ESPN could change them or restrict access, and some NFL metrics (particularly targets or snap counts) may be missing for a given player or year. The app shows a dash for unavailable values instead of assuming zero.
- To rank players, the team endpoint reads active roster candidates, collects each athlete's regular-season game log, and scores NBA court time and production or NFL offensive volume and production. This is an explicitly labeled selection methodology, not an official "best player" ranking or a confirmed starting lineup. The endpoint might take several seconds the first time a team is requested.
- Team roster and game-log availability depend on ESPN. When it cannot retrieve seven verified stat lines, the site shows the number actually available instead of inventing statistics.
- NBA season selection uses the ending year: “2026–27” corresponds to API season `2027`. NFL seasons use the starting year.
- The main table supports regular season, postseason, and combined views. Totals are computed from the displayed game logs. Stats that cannot be meaningfully aggregated are excluded from totals.
- The app is not affiliated with ESPN, the NBA, or the NFL. If you plan commercial or heavy traffic use, consider a licensed data provider.

