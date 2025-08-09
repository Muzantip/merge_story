// server.js — Authoritative 1v1 server for Merge Story
// Run: node server.js
// Requires: npm i ws seedrandom
import { WebSocketServer, WebSocket } from 'ws';
import seedrandom from 'seedrandom';

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });
console.log('[SRV] up on', PORT);

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

const rooms = new Map(); // roomId -> {seed, rng, players:[{id,ws}], state}
let nextId = 1;

function initBoard(){
  const grid = Array.from({length:5}, ()=> Array(5).fill(0));
  grid[2][2] = 1; grid[2][3] = 1;
  return grid;
}
function initQuests(){
  return [
    {id:1, need:{2:1}, reward:{coins:50, energy:10}, title:"Починить вывеску"},
    {id:2, need:{2:2}, reward:{coins:70, energy:10}, title:"Отремонтировать забор"},
    {id:3, need:{3:1}, reward:{coins:100, energy:15}, title:"Открыть кузницу"},
  ];
}
function newRoom(roomId){
  const seed = String(Math.floor(Math.random()*1e9));
  const rng = mulberry32(Number(seed.slice(-9))||1);
  const state = {
    A:{ grid:initBoard(), coins:0, energy:100, maxEnergy:100, completed:{}, stats:{1:0,2:0,3:0,4:0,5:0,6:0}, quests:initQuests() },
    B:{ grid:initBoard(), coins:0, energy:100, maxEnergy:100, completed:{}, stats:{1:0,2:0,3:0,4:0,5:0,6:0}, quests:initQuests() },
  };
  return {roomId, seed, rng, players:[], state};
}

function compact(arr){
  const tmp=[]; for (let i=0;i<arr.length;i++) if (arr[i]>0) tmp.push(arr[i]);
  while (tmp.length<arr.length) tmp.push(0);
  return tmp;
}
function mergeLine(line){
  line = compact(line);
  for (let i=0;i<line.length-1;i++){
    if (line[i]>0 && line[i]===line[i+1]){ line[i]=Math.min(line[i]+1,6); line[i+1]=0; i++; }
  }
  return compact(line);
}
function applyMove(p, dir){
  if (dir==='L'){
    for (let y=0;y<5;y++){ p.grid[y]=mergeLine(p.grid[y].slice()); }
  } else if (dir==='R'){
    for (let y=0;y<5;y++){ const rev=p.grid[y].slice().reverse(); p.grid[y]=mergeLine(rev).reverse(); }
  } else if (dir==='U'){
    for (let x=0;x<5;x++){ const col=[]; for (let y=0;y<5;y++) col.push(p.grid[y][x]); const out=mergeLine(col); for (let y=0;y<5;y++) p.grid[y][x]=out[y]; }
  } else if (dir==='D'){
    for (let x=0;x<5;x++){ const col=[]; for (let y=0;y<5;y++) col.push(p.grid[y][x]); const rev=col.slice().reverse(); const out=mergeLine(rev).reverse(); for (let y=0;y<5;y++) p.grid[y][x]=out[y]; }
  }
  // spawn 1 LV1 randomly
  const empty=[]; for (let y=0;y<5;y++) for (let x=0;x<5;x++) if (p.grid[y][x]===0) empty.push({x,y});
  if (empty.length){ const pick = empty[Math.floor(Math.random()*empty.length)]; p.grid[pick.y][pick.x]=1; }
  return p;
}
function applySpawn(p){
  if (p.energy<=0) return p;
  const empty=[]; for (let y=0;y<5;y++) for (let x=0;x<5;x++) if (p.grid[y][x]===0) empty.push({x,y});
  if (!empty.length) return p;
  const pick = empty[Math.floor(Math.random()*empty.length)];
  p.grid[pick.y][pick.x]=1; p.energy = Math.max(0, p.energy-1);
  return p;
}

function packStateFor(id, room){
  const youSide = room.players[0]?.id===id ? 'A' : 'B';
  const oppSide = youSide==='A' ? 'B' : 'A';
  return {
    roomId: room.roomId,
    youId: id,
    seed: room.seed,
    state: {
      you: room.state[youSide],
      opp: room.state[oppSide],
    }
  };
}

function broadcast(room, msg){
  for (const p of room.players){
    if (p.ws.readyState === WebSocket.OPEN){
      p.ws.send(JSON.stringify(msg));
    }
  }
}

wss.on('connection', (ws) => { console.log('[SRV] conn');
  const pid = nextId++;
  let curRoom = null;
  let side = null;

  ws.on('message', (buf) => {
    let m; try{ m=JSON.parse(buf.toString()); }catch(e){ return; }
    if (m.type==='create'){ console.log('[SRV] create', m.roomId);
      const id = m.roomId || String(Math.floor(Math.random()*1e6));
      curRoom = newRoom(id);
      side = 'A';
      curRoom.players.push({id:pid, ws});
      rooms.set(id, curRoom);
      ws.send(JSON.stringify({type:'room_state', roomId:id, youId:pid, seed:curRoom.seed, state: packStateFor(pid, curRoom).state}));
    } else if (m.type==='join'){ console.log('[SRV] join', m.roomId);
      const r = rooms.get(m.roomId);
      if (!r || r.players.length>=2){ ws.send(JSON.stringify({type:'error', message:'room unavailable'})); return; }
      curRoom = r; side='B'; r.players.push({id:pid, ws});
      // notify both
      for (const p of r.players){
        p.ws.send(JSON.stringify({type:'room_state', roomId:r.roomId, youId:p.id, seed:r.seed, state: packStateFor(p.id, r).state}));
      }
    } else if (m.type==='ready'){ console.log('[SRV] ready');
      // auto start when both in room
      if (!curRoom) return;
      if (curRoom.players.length===2){
        broadcast(curRoom, {type:'start', countdown:1});
        for (const p of curRoom.players){ const youSide2 = curRoom.players[0]?.id===p.id ? 'A' : 'B'; const oppSide2 = youSide2==='A'?'B':'A'; p.ws.send(JSON.stringify({type:'state_delta', you:curRoom.state[youSide2], opp:curRoom.state[oppSide2]})); }
      }
    } else if (m.type==='input'){ console.log('[SRV] input', m.input);
      if (!curRoom) return;
      const youSide = curRoom.players[0]?.id===pid ? 'A' : 'B';
      const player = curRoom.state[youSide];
      if (m.input?.type==='move') applyMove(player, m.input.dir);
      else if (m.input?.type==='spawn') applySpawn(player);
      // send delta to both
      for (const p of curRoom.players){
        const youSide2 = curRoom.players[0]?.id===p.id ? 'A' : 'B';
        const oppSide2 = youSide2==='A' ? 'B' : 'A';
        p.ws.send(JSON.stringify({type:'state_delta', you:curRoom.state[youSide2], opp:curRoom.state[oppSide2]}));
      }
    } else if (m.type==='reconnect'){ console.log('[SRV] reconnect', m.roomId);
      const r = rooms.get(m.roomId);
      if (!r){ ws.send(JSON.stringify({type:'error', message:'no such room'})); return; }
      curRoom = r;
      // replace dead slot or add if not present
      if (r.players.length<2) r.players.push({id:pid, ws});
      ws.send(JSON.stringify({type:'room_state', roomId:r.roomId, youId:pid, seed:r.seed, state: packStateFor(pid, r).state}));
    }
  });

  ws.on('close', ()=>{
    if (curRoom){
      // remove player; if room empty, delete
      curRoom.players = curRoom.players.filter(p => p.id!==pid);
      if (curRoom.players.length===0) rooms.delete(curRoom.roomId);
    }
  });
});
