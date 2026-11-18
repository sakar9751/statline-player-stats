/** Player Season Stats — zero-dependency Node server and ESPN proxy. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const portFlag = process.argv.indexOf('--port');
const PORT = Number(portFlag >= 0 ? process.argv[portFlag + 1] : process.env.PORT) || 3000;
const WEB = 'https://site.web.api.espn.com';
const SITE = 'https://site.api.espn.com';
const cache = new Map();

function send(res, status, data, type='application/json; charset=utf-8') {
  res.writeHead(status, {'Content-Type':type,'Cache-Control': type.startsWith('text/html') ? 'no-cache' : 'public, max-age=30', 'X-Content-Type-Options':'nosniff'});
  res.end(typeof data === 'string' ? data : JSON.stringify(data));
}
async function remote(url, ttl=180000) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(), 14000);
  try {
    const rsp = await fetch(url,{headers:{Accept:'application/json','User-Agent':'PlayerSeasonStats/1.0'},signal:controller.signal});
    if(!rsp.ok) throw new Error(`Sports data provider returned ${rsp.status}`);
    const data = await rsp.json();
    cache.set(url,{data,at:Date.now()});
    if(cache.size > 300) cache.delete(cache.keys().next().value);
    return data;
  } finally { clearTimeout(timer); }
}
const SPORTS = {nba:'basketball',nfl:'football'};
http.createServer(async(req,res)=>{
  let u;
  try { u=new URL(req.url,'http://localhost'); } catch { return send(res,400,{error:'Invalid URL'}); }
  if(req.method!=='GET') return send(res,405,{error:'GET only'});
  if(u.pathname==='/health') return send(res,200,{ok:true});
  const matchupApi = {'/api/games':'games','/api/team':'team','/api/boxscore':'boxscore'};
  if (matchupApi[u.pathname]) {
    try {
      const { serveMatchup } = await import('./lib/matchups.mjs');
      const response = await serveMatchup(matchupApi[u.pathname], new Request(u.toString()));
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      return res.end(await response.text());
    } catch (error) {
      return send(res, 502, {error: error.message});
    }
  }
  if(u.pathname==='/api/search' || u.pathname==='/api/gamelog' || u.pathname==='/api/profile') {
    try {
      const league=u.searchParams.get('league');
      if(!SPORTS[league]) return send(res,400,{error:'Choose NBA or NFL.'});
      let target;
      if(u.pathname==='/api/search') {
        const q=(u.searchParams.get('q')||'').trim().slice(0,90);
        if(q.length<2) return send(res,200,{results:[]});
        target=`${SITE}/apis/search/v2?query=${encodeURIComponent(q)}&limit=25`;
      } else {
        const id=u.searchParams.get('id')||'';
        if(!/^\d{1,12}$/.test(id)) return send(res,400,{error:'Invalid athlete id.'});
        const prefix=`${WEB}/apis/common/v3/sports/${SPORTS[league]}/${league}/athletes/${id}`;
        if(u.pathname==='/api/profile') target=prefix+'/overview';
        else {
          const year=Number(u.searchParams.get('season'));
          if(!Number.isInteger(year)||year<2000||year>2100) return send(res,400,{error:'Invalid season.'});
          target=prefix+`/gamelog?season=${year}`;
        }
      }
      return send(res,200,await remote(target,u.pathname==='/api/search'?180000:300000));
    } catch(err) { return send(res,502,{error:`Unable to load ESPN data: ${err.message}`}); }
  }
  if(!['/','/index.html','/player.html'].includes(u.pathname)) return send(res,404,'Not found','text/plain; charset=utf-8');
  const filename = u.pathname === '/player.html' ? 'player.html' : 'index.html';
  try { send(res,200,fs.readFileSync(path.join(__dirname,filename),'utf8'),'text/html; charset=utf-8'); }
  catch { send(res,500,'Site unavailable','text/plain'); }
}).listen(PORT,()=>console.log(`Player Season Stats running at http://localhost:${PORT}`));

