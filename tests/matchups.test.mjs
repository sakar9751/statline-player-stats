import test from 'node:test';
import assert from 'node:assert/strict';
import { getGames, getTeamPlayers, seasonLineFromGameLog, __testing } from '../lib/matchups.mjs';

const exampleGame = {
  id: '401765432',
  date: '2026-11-18T01:30:00Z',
  season: { year: 2027 },
  status: { type: { state: 'pre', description: 'Scheduled' } },
  competitions: [{
    competitors: [
      { homeAway: 'home', team: { id: '2', abbreviation: 'BOS', displayName: 'Boston Celtics' }, records: [{name:'overall',summary:'9-2'}] },
      { homeAway: 'away', team: { id: '13', abbreviation: 'LAL', displayName: 'Los Angeles Lakers' }, records: [{name:'overall',summary:'7-4'}] },
    ],
  }],
};

const nbaLog = (minutes, points, games = 2) => ({
  labels: ['MIN','FG','3PT','FT','REB','AST','STL','BLK','TO','PTS'],
  names: ['minutes','fieldGoals','threePointFieldGoals','freeThrows','rebounds','assists','steals','blocks','turnovers','points'],
  seasonTypes: [{
    id: '2', name: 'Regular Season',
    categories: [{ events: Array.from({length:games},(_,i)=>({
      eventId:'40'+i+'70000', stats:[String(minutes),'8-17','3-8','4-5','6','8','1','0','3',String(points)]
    })) }],
  }],
});

test('Chicago day changes at midnight Central, not UTC', () => {
  assert.equal(__testing.todayInChicago(new Date('2026-11-18T03:00:00Z')), '2026-11-17');
});

test('NBA game log correctly uses attempted shots, never made shots', () => {
  const line=seasonLineFromGameLog(nbaLog(33,26), 'nba');
  assert.equal(line.gamesPlayed,2);
  assert.equal(line.totals.fieldGoalAttempts,34);
  assert.equal(line.perGame.threePointAttempts,8);
  assert.equal(line.totals.points,52);
  assert.equal(line.perGame.minutes,33);
});

test('NFL passing and receiving volume resolves duplicate YDS labels', () => {
  const qb = {
    labels: ['C/ATT','YDS','TD','INT','CAR','YDS','TD'],
    names: ['completionsPassingAttempts','passingYards','passingTouchdowns','interceptions','rushingAttempts','rushingYards','rushingTouchdowns'],
    seasonTypes:[{name:'Regular Season',categories:[{events:[{eventId:'123',stats:['21/36','287','3','1','6','42','1']}]}]}],
  };
  const stats=seasonLineFromGameLog(qb,'nfl','QB');
  assert.equal(stats.totals.passAttempts,36);
  assert.equal(stats.totals.completions,21);
  assert.equal(stats.totals.passingYards,287);
  assert.equal(stats.totals.rushingYards,42);
});

test('scoreboard normalizes away/home and game date', async () => {
  const saved=globalThis.fetch;
  globalThis.fetch=async()=>Response.json({events:[exampleGame]});
  try{
    const games=await getGames('nba','2026-11-17',new Date('2026-11-17T18:00:00Z'));
    assert.equal(games.games.length,1);
    assert.equal(games.games[0].home.abbreviation,'BOS');
    assert.equal(games.games[0].away.abbreviation,'LAL');
  }finally{globalThis.fetch=saved}
});

test('team endpoint ranks seven real season contributors',async()=>{
  const saved=globalThis.fetch;
  globalThis.fetch=async(url)=>{
    const u=String(url);
    if(u.includes('/roster')) return Response.json({athletes:Array.from({length:9},(_,i)=>({
      id:String(1001+i), displayName:'Player '+(i+1), position:{abbreviation:'G'}, status:{type:'active'}
    }))});
    const id=Number(u.match(/athletes\/(\d+)/)?.[1]||1001);
    return Response.json(nbaLog(20+id-1001,10+id-1001));
  };
  try{
    const data=await getTeamPlayers('nba','88','2027');
    assert.equal(data.count,7);
    assert.equal(data.players[0].name,'Player 9');
    assert.equal(data.players[0].perGame.points,18);
    assert.equal(data.players.at(-1).name,'Player 3');
  }finally{globalThis.fetch=saved}
});
