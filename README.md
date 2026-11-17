# STATLINE — NBA & NFL Player Season Stats

An NBA / NFL player stats dashboard with per-game logs, season totals, per-game averages, and CSV export. Highlights NBA minutes, points, field-goal attempts, three-point attempts, and free-throw attempts; and NFL targets, carries, passing attempts, yards, and touchdowns.

## Deploy using GitHub + Vercel

1. Create a **new repository** named `statline-player-stats` under the GitHub account you want to use.
2. Upload the files **from this folder into the root of the repository**. The repository's root should contain `index.html`, `package.json`, `vercel.json`, and an `api/` directory; do **not** put them inside an extra `player-season-stats/` folder.
3. In [Vercel](https://vercel.com/new), choose **Add New → Project**, import the repository, and use:
   - Framework Preset: **Other**
   - Root Directory: `./`
   - Build Command: **none (blank)**
   - Output Directory: **default** (root, because there is no `public/` directory)
   - Environment Variables: **none required**
4. Deploy. Check the homepage, and test `/api/search?league=nba&q=Stephen%20Curry`.

Vercel serves `index.html` as a static asset and runs the files in `api/` as Node.js serverless functions. Those functions proxy the ESPN endpoints, so the browser does not call ESPN directly.

## Run locally

Requires Node.js 18+ and no external packages or API keys.

```bash
npm start
```

Visit <http://localhost:3000>. This starts `server.js` for local development; on Vercel, the serverless handlers under `api/` serve the same endpoints.

## API

- `GET /api/search?league=nba&q=Stephen%20Curry`
- `GET /api/gamelog?league=nfl&id=3918298&season=2026`
- `GET /api/profile?league=nba&id=3975`

## Important limitations

- ESPN's JSON endpoints are **unofficial and undocumented**. ESPN could change them or restrict access, and some NFL metrics (particularly targets or snap counts) may be missing for a given player or year. The app shows a dash for unavailable values instead of assuming zero.
- NBA season selection uses the ending year: “2026–27” corresponds to API season `2027`. NFL seasons use the starting year.
- The main table supports regular season, postseason, and combined views. Totals are computed from the displayed game logs. Stats that cannot be meaningfully aggregated are excluded from totals.
- The app is not affiliated with ESPN, the NBA, or the NFL. If you plan commercial or heavy traffic use, consider a licensed data provider.
