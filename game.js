(function(){
'use strict';
const DBG='[GAME]';

const W = 800, H = 600;
let canvas, ctx;
let energyEl, coinsEl, questsEl, logEl, hintEl;

// ----- State -----
const state = {
  roomId: null,

  phase: 'menu', // 'menu' | 'game'

  gridW: 5,
  gridH: 5,
  cell: 96,
  gridX: (W-96*5)/2 - 120, // shift left to make space for opponent
  oppGridX: (W-96*5)/2 + 120,

  gridY: 80,
  grid: [],
  coins: 0,
  energy: 100,
  maxEnergy: 100,
  lastEnergyTick: Date.now(),
  regenMs: 30000,
  dragging: null,
  quests: [],
  completed: {},
  stats: {1:0,2:0,3:0,4:0,5:0,6:0},
  mode: 'solo',
  youId: null,
  opp: { grid: Array.from({length:5},()=>Array(5).fill(0)), coins:0, energy:100, stats:{1:0,2:0,3:0,4:0,5:0,6:0}, effects:{}, anim:{active:false, t:0, dur:200, slides:[], mask:{}}, quests:[], completed:{} },

  fly: [],
  effects: {}, // jump effects
  anim: { active:false, t:0, dur:200, slides:[], mask:{}, afterFn:null },
  t: 0
};

// ----- Assets -----
const bg = new Image(); bg.src = "assets/background.png";

// ----- Utils -----
function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }
function keyCell(x,y){ return x + "," + y; }
function easeOutCubic(t){ return 1 - Math.pow(1-t, 3); }
function lerp(a,b,t){ return a + (b-a)*t; }
function colorForLevel(lv){
  const cols = [
    [240,148,51], [80,170,250], [78,201,176], [178,102,235], [231,76,60], [241,196,15]
  ];
  const i = Math.max(1, Math.min(6, lv)) - 1;
  return cols[i];
}

// Positions
function rectPos(x,y){
  const cx = state.gridX + x*state.cell + state.cell/2;
  const cy = state.gridY + y*state.cell + state.cell/2;
  return {x:cx, y:cy};
}
function gridFromXY(mx,my){
  const gx = Math.floor((mx - state.gridX)/state.cell);
  const gy = Math.floor((my - state.gridY)/state.cell);
  if (gx<0||gy<0||gx>=state.gridW||gy>=state.gridH) return null;
  return {x:gx, y:gy};
}

// Spheres (matte)
function drawSphere(cx, cy, radius, color, digit){
  // shadow
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.ellipse(cx, cy + radius*0.52, radius*0.88, radius*0.32, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.restore();

  // matte gradient
  const col = color || [200,200,200];
  const grad = ctx.createRadialGradient(cx, cy, radius*0.15, cx, cy, radius);
  grad.addColorStop(0, "rgba("+col[0]+","+col[1]+","+col[2]+",1)");
  grad.addColorStop(1, "rgba("+((col[0]*0.75)|0)+","+((col[1]*0.75)|0)+","+((col[2]*0.75)|0)+",1)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI*2);
  ctx.fill();

  // digit
  if (digit != null){
    ctx.save();
    ctx.fillStyle = "white";
    ctx.font = Math.max(12, Math.floor(radius*0.9)) + "px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 3;
    ctx.strokeText(String(digit), cx, cy);
    ctx.fillText(String(digit), cx, cy);
    ctx.restore();
  }
}

// Parallax
function drawParallax(t){
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#ffffff";
  for (let i=0;i<5;i++){
    const y = (t*0.02 + i*120) % (H+120) - 120;
    ctx.fillRect(0, y, W, 60);
  }
  ctx.restore();
}
// ---- Layout helpers ----
function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
}
function drawBadge(x, y, text, color){
  ctx.save();
  ctx.fillStyle = color;
  const pad = 8;
  ctx.font = "bold 14px Arial";
  const w = ctx.measureText(text).width + pad*2;
  const h = 26;
  roundRect(ctx, x - w/2, y - h, w, h, 12);
  ctx.fill();
  ctx.fillStyle = "#0e0f12";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y - h/2);
  ctx.restore();
}
function layoutForMode(){ console.log(DBG,'layoutForMode', state.mode);
  if (state.mode === 'vs') {
    const leftMargin = 40, rightMargin = 40, centerGap = 48;
    const boardsArea = W - leftMargin - rightMargin - centerGap;
    const boardW = Math.floor(boardsArea / 2);
    state.cell = Math.min(72, Math.floor(boardW / state.gridW));
    const actualBoardW = state.cell * state.gridW;
    state.gridY = 140;
    state.oppGridX = leftMargin;                         // opponent left
    state.gridX   = W - rightMargin - actualBoardW;      // you right
  } else {
    state.cell = 96;
    state.gridY = 80;
    state.gridX = (W - state.cell*state.gridW)/2;
    state.oppGridX = state.gridX + 9999;
  }
}


// Stats
function statsTargetPos(lv){
  const margin = 20, slotW = 110;
  return {x: margin + (lv-1)*slotW + 55, y: 40};
}
function addFly(fromX, fromY, lv){
  const to = statsTargetPos(lv);
  state.fly.push({lv:lv, x0:fromX, y0:fromY, x1:to.x, y1:to.y, t:0, dur:800});
}

// HUD & log
function updateHUD(){
  energyEl.textContent = state.energy + "/" + state.maxEnergy;
  coinsEl.textContent = String(state.coins);
}
function log(t){
  const div = document.createElement("div");
  div.textContent = t;
  logEl.prepend(div);
}

// Grid init
function initGrid(){
  state.grid = Array.from({length:state.gridH}, () => Array(state.gridW).fill(0));
  state.grid[2][2] = 1;
  state.grid[2][3] = 1;
}

// Spawns
function spawn(){ console.log(DBG,'spawn called, mode=',state.mode,'phase=',state.phase);
  if (state.phase!=='game') return;
  if (state.mode==='vs'){ _NET.send({type:'input', roomId:_NET.roomId, youId:_NET.youId, input:{type:'spawn'}}); return; }
  if (state.phase!=='game') return; if (state.anim.active) return;
  if (state.energy <= 0){ log("Недостаточно энергии"); return; }
  const empty = [];
  for (let y=0;y<state.gridH;y++) for (let x=0;x<state.gridW;x++) if (state.grid[y][x]===0) empty.push({x:x,y:y});
  if (!empty.length){ log("Нет свободных клеток"); return; }
  const p = empty[Math.floor(Math.random()*empty.length)];
  state.grid[p.y][p.x] = 1;
  state.energy = Math.max(0, state.energy-1);
  if (hintEl) hintEl.style.display = "none";
  updateHUD();
}
function spawnFree(){
  const empty = [];
  for (let y=0;y<state.gridH;y++) for (let x=0;x<state.gridW;x++) if (state.grid[y][x]===0) empty.push({x:x,y:y});
  if (!empty.length) return false;
  const p = empty[Math.floor(Math.random()*empty.length)];
  state.grid[p.y][p.x] = 1;
  return true;
}

// Merge (tap/drag)
function tryMerge(x,y){ console.log(DBG,'tryMerge', x,y);
  const v = state.grid[y][x];
  if (v <= 0) return false;
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  for (let i=0; i<dirs.length; i++){
    const d = dirs[i];
    const nx = x + d[0], ny = y + d[1];
    if (nx<0||ny<0||nx>=state.gridW||ny>=state.gridH) continue;
    if (state.grid[ny][nx] === v){
      const nv = Math.min(v+1, 6);
      state.grid[y][x] = nv;
      state.grid[ny][nx] = 0;
      state.effects[keyCell(x,y)] = {t:0, dur:250};
      log("Слияние: LV"+v+"+LV"+v+" → LV"+nv);
      checkQuests();
      return true;
    }
  }
  return false;
}

// Arrow movement core
function compact(arr){
  const tmp = [];
  for (let i=0;i<arr.length;i++){ if (arr[i]>0) tmp.push(arr[i]); }
  while (tmp.length < arr.length) tmp.push(0);
  return tmp;
}
function mergeLine(line){
  line = compact(line);
  for (let i=0;i<line.length-1;i++){
    if (line[i]>0 && line[i]===line[i+1]){
      line[i] = Math.min(line[i]+1, 6);
      line[i+1] = 0;
      i++;
    }
  }
  return compact(line);
}

// Build slides for a left/up move
function buildSlidesForLine(line){
  const len = line.length;
  const slides = [];
  const before = line.slice();
  const after = mergeLine(line.slice());

  // mapping
  let write = 0;
  for (let i=0;i<len;i++){
    const v = before[i];
    if (v===0) continue;
    // find next non-zero to see if merging
    let j = i+1; while (j<len && before[j]===0) j++;
    if (j<len && before[j]===v){
      // merge pair i + j => write
      slides.push({from:i, to:write, lv:v, merged:true, primary:true});
      slides.push({from:j, to:write, lv:v, merged:true, primary:false});
      i = j; write++;
    } else {
      slides.push({from:i, to:write, lv:v, merged:false, primary:true});
      write++;
    }
  }

  return {slides, after};
}

function startAnim(slides, mask, afterFn){
  state.anim.active = true;
  state.anim.t = 0;
  state.anim.dur = 200;
  state.anim.slides = slides;
  state.anim.mask = mask || {};
  state.anim.afterFn = afterFn || null;
}

// Moves with sliding
function moveLeft(){
  console.log(DBG,'moveLeft', 'mode=',state.mode,'anim=',state.anim.active,'phase=',state.phase);
  if (state.phase!=='game') return;
  if (state.anim.active) return;
  if (state.mode==='vs' && window._NET) {
    try { _NET.send({type:'input', roomId:_NET.roomId||state.roomId, youId:_NET.youId, input:{type:'move', dir:'L'}}); } catch(e) { console.error(DBG,'send fail moveLeft', e); }
    return;
  }
  return _moveLeftLocal();
}
function _moveLeftLocal(){
 console.log(DBG,'moveLeft', 'mode=',state.mode,'anim=',state.anim.active);
  if (state.mode==='vs'){ _NET.send({type:'input', roomId:_NET.roomId, youId:_NET.youId, input:{type:'move', dir:'L'}}); return; }
  if (state.phase!=='game') return; if (state.anim.active) return;
  let anyChanged=false;
  const allSlides=[]; const maskCells={};
  const newGrid = Array.from({length:state.gridH}, ()=> Array(state.gridW).fill(0));

  for (let y=0;y<state.gridH;y++){
    const line = state.grid[y].slice();
    const pack = buildSlidesForLine(line);
    const slides = pack.slides;
    const after = pack.after;
    for (let i=0;i<after.length;i++){ newGrid[y][i]=after[i]; if (after[i]!==line[i]) anyChanged=true; }
    for (const s of slides){
      const p0 = rectPos(s.from, y), p1 = rectPos(s.to, y);
      allSlides.push({x0:p0.x, y0:p0.y, x1:p1.x, y1:p1.y, lv:s.lv, merged:s.merged, primary:s.primary, destX:s.to, destY:y});
      maskCells[keyCell(s.to,y)] = true;
    }
  }
  if (!anyChanged) return;
  startAnim(allSlides, maskCells, function(){
    state.grid = newGrid;
    checkQuests();
    spawnFree();
  });

}

function moveRight(){
  console.log(DBG,'moveRight', 'mode=',state.mode,'anim=',state.anim.active,'phase=',state.phase);
  if (state.phase!=='game') return;
  if (state.anim.active) return;
  if (state.mode==='vs' && window._NET) {
    try { _NET.send({type:'input', roomId:_NET.roomId||state.roomId, youId:_NET.youId, input:{type:'move', dir:'R'}}); } catch(e) { console.error(DBG,'send fail moveRight', e); }
    return;
  }
  return _moveRightLocal();
}
function _moveRightLocal(){
 console.log(DBG,'moveRight', 'mode=',state.mode,'anim=',state.anim.active);
  if (state.mode==='vs'){ _NET.send({type:'input', roomId:_NET.roomId, youId:_NET.youId, input:{type:'move', dir:'R'}}); return; }
  if (state.phase!=='game') return; if (state.anim.active) return;
  let anyChanged=false;
  const allSlides=[]; const maskCells={};
  const newGrid = Array.from({length:state.gridH}, ()=> Array(state.gridW).fill(0));

  for (let y=0;y<state.gridH;y++){
    const lineR = state.grid[y].slice().reverse();
    const pack = buildSlidesForLine(lineR);
    const slides = pack.slides;
    const after = pack.after.reverse();
    for (let i=0;i<after.length;i++){ newGrid[y][i]=after[i]; if (after[i]!==state.grid[y][i]) anyChanged=true; }
    for (const s of slides){
      const fromIdx = state.gridW-1 - s.from;
      const toIdx   = state.gridW-1 - s.to;
      const p0 = rectPos(fromIdx, y), p1 = rectPos(toIdx, y);
      allSlides.push({x0:p0.x, y0:p0.y, x1:p1.x, y1:p1.y, lv:s.lv, merged:s.merged, primary:s.primary, destX:toIdx, destY:y});
      maskCells[keyCell(toIdx,y)] = true;
    }
  }
  if (!anyChanged) return;
  startAnim(allSlides, maskCells, function(){
    state.grid = newGrid;
    checkQuests();
    spawnFree();
  });

}

function moveUp(){
  console.log(DBG,'moveUp', 'mode=',state.mode,'anim=',state.anim.active,'phase=',state.phase);
  if (state.phase!=='game') return;
  if (state.anim.active) return;
  if (state.mode==='vs' && window._NET) {
    try { _NET.send({type:'input', roomId:_NET.roomId||state.roomId, youId:_NET.youId, input:{type:'move', dir:'U'}}); } catch(e) { console.error(DBG,'send fail moveUp', e); }
    return;
  }
  return _moveUpLocal();
}
function _moveUpLocal(){
 console.log(DBG,'moveUp', 'mode=',state.mode,'anim=',state.anim.active);
  if (state.mode==='vs'){ _NET.send({type:'input', roomId:_NET.roomId, youId:_NET.youId, input:{type:'move', dir:'U'}}); return; }
  if (state.phase!=='game') return; if (state.anim.active) return;
  let anyChanged=false;
  const allSlides=[]; const maskCells={};
  const newGrid = Array.from({length:state.gridH}, ()=> Array(state.gridW).fill(0));

  for (let x=0;x<state.gridW;x++){
    const col = []; for (let y=0;y<state.gridH;y++) col.push(state.grid[y][x]);
    const pack = buildSlidesForLine(col);
    const slides = pack.slides;
    const after = pack.after;
    for (let y=0;y<after.length;y++){ newGrid[y][x]=after[y]; if (after[y]!==col[y]) anyChanged=true; }
    for (const s of slides){
      const p0 = rectPos(x, s.from), p1 = rectPos(x, s.to);
      allSlides.push({x0:p0.x, y0:p0.y, x1:p1.x, y1:p1.y, lv:s.lv, merged:s.merged, primary:s.primary, destX:x, destY:s.to});
      maskCells[keyCell(x,s.to)] = true;
    }
  }
  if (!anyChanged) return;
  startAnim(allSlides, maskCells, function(){
    state.grid = newGrid;
    checkQuests();
    spawnFree();
  });

}

function moveDown(){
  console.log(DBG,'moveDown', 'mode=',state.mode,'anim=',state.anim.active,'phase=',state.phase);
  if (state.phase!=='game') return;
  if (state.anim.active) return;
  if (state.mode==='vs' && window._NET) {
    try { _NET.send({type:'input', roomId:_NET.roomId||state.roomId, youId:_NET.youId, input:{type:'move', dir:'D'}}); } catch(e) { console.error(DBG,'send fail moveDown', e); }
    return;
  }
  return _moveDownLocal();
}
function _moveDownLocal(){
 console.log(DBG,'moveDown', 'mode=',state.mode,'anim=',state.anim.active);
  if (state.mode==='vs'){ _NET.send({type:'input', roomId:_NET.roomId, youId:_NET.youId, input:{type:'move', dir:'D'}}); return; }
  if (state.phase!=='game') return; if (state.anim.active) return;
  let anyChanged=false;
  const allSlides=[]; const maskCells={};
  const newGrid = Array.from({length:state.gridH}, ()=> Array(state.gridW).fill(0));

  for (let x=0;x<state.gridW;x++){
    const col = []; for (let y=0;y<state.gridH;y++) col.push(state.grid[y][x]);
    const rev = col.slice().reverse();
    const pack = buildSlidesForLine(rev);
    const slides = pack.slides;
    const after = pack.after.reverse();
    for (let y=0;y<after.length;y++){ newGrid[y][x]=after[y]; if (after[y]!==state.grid[y][x]) anyChanged=true; }
    for (const s of slides){
      const fromIdx = state.gridH-1 - s.from;
      const toIdx   = state.gridH-1 - s.to;
      const p0 = rectPos(x, fromIdx), p1 = rectPos(x, toIdx);
      allSlides.push({x0:p0.x, y0:p0.y, x1:p1.x, y1:p1.y, lv:s.lv, merged:s.merged, primary:s.primary, destX:x, destY:toIdx});
      maskCells[keyCell(x,toIdx)] = true;
    }
  }
  if (!anyChanged) return;
  startAnim(allSlides, maskCells, function(){
    state.grid = newGrid;
    checkQuests();
    spawnFree();
  });

}


// Quests
function renderQuests(){ console.log(DBG,'renderQuests');
  questsEl.innerHTML = "";
  for (let i=0; i<state.quests.length; i++){
    const q = state.quests[i];
    const d = document.createElement("div");
    const done = state.completed[q.id] ? " done" : "";
    d.className = "q" + done;
    const needParts = [];
    for (const lv in q.need){ if (Object.prototype.hasOwnProperty.call(q.need, lv)) needParts.push("LV"+lv+"×"+q.need[lv]); }
    d.innerHTML = "<b>"+q.title+"</b><br><small>Нужно: "+needParts.join(", ")+"</small>";
    questsEl.appendChild(d);
  }
}
function checkQuests(){ console.log(DBG,'checkQuests');
  for (let i=0;i<state.quests.length;i++){
    const q = state.quests[i];
    if (state.completed[q.id]) continue;
    const counts = {};
    for (let y=0;y<state.gridH;y++) for (let x=0;x<state.gridW;x++){ const v=state.grid[y][x]; if (v>0) counts[v]=(counts[v]||0)+1; }
    let ok = true;
    for (const lv in q.need){ if (Object.prototype.hasOwnProperty.call(q.need, lv)){ if ((counts[lv|0]||0) < q.need[lv]) { ok=false; break; } } }
    if (!ok) continue;

    // consume with fly-to-stats
    for (const lv2 in q.need){
      if (!Object.prototype.hasOwnProperty.call(q.need, lv2)) continue;
      let need = q.need[lv2];
      for (let y2=0;y2<state.gridH;y2++){
        for (let x2=0;x2<state.gridW;x2++){
          if (need<=0) break;
          if (state.grid[y2][x2]===(lv2|0)){
            const p = rectPos(x2,y2);
            addFly(p.x, p.y, lv2|0);
            state.grid[y2][x2] = 0;
            need--;
          }
        }
      }
    }

    state.coins += q.reward.coins || 0;
    state.energy = clamp(state.energy + (q.reward.energy||0), 0, state.maxEnergy);
    state.completed[q.id] = true;
    updateHUD(); renderQuests();
    log("Квест выполнен: "+q.title+" (+"+(q.reward.coins||0)+" монет, +"+(q.reward.energy||0)+" энергии)");
  }
}

// Energy regen
function tick(){
  const now = Date.now();
  if (now - state.lastEnergyTick >= state.regenMs){
    const gained = Math.floor((now - state.lastEnergyTick)/state.regenMs);
    state.energy = clamp(state.energy + gained, 0, state.maxEnergy);
    state.lastEnergyTick += gained*state.regenMs;
    updateHUD();
  }
  state.t += 16;
}

// Input (drag/tap)
function getPosFromEvent(e){
  const r = canvas.getBoundingClientRect();
  let x,y;
  if (e.touches && e.touches[0]){ x=e.touches[0].clientX; y=e.touches[0].clientY; }
  else { x=e.clientX; y=e.clientY; }
  return {x: x - r.left, y: y - r.top};
}
function onDown(e){
  if (state.phase!=='game') return;
  if (state.phase!=='game') return; if (state.anim.active) return;
  e.preventDefault();
  const p = getPosFromEvent(e);
  const g = gridFromXY(p.x, p.y); if(!g) return;
  const v = state.grid[g.y][g.x];
  if (v>0) state.dragging = {from:g, value:v};
}
function onUp(e){
  if (state.phase!=='game') return;
  if (state.phase!=='game') return; if (state.anim.active) return;
  e.preventDefault();
  if (!state.dragging) return;
  const p = getPosFromEvent(e);
  const g = gridFromXY(p.x, p.y);
  const d = state.dragging; state.dragging=null;
  if (!g) return;
  if (g.x===d.from.x && g.y===d.from.y){ tryMerge(g.x,g.y); }
  else {
    if (state.grid[g.y][g.x]===0){
      state.grid[g.y][g.x]=d.value; state.grid[d.from.y][d.from.x]=0; tryMerge(g.x,g.y);
    }
  }
}

// Keyboard
function onKey(e){
  if (state.phase!=='game') return; if (state.anim.active) return;
  const k = e.key;
  if (k==="ArrowLeft"){ e.preventDefault(); moveLeft(); }
  else if (k==="ArrowRight"){ e.preventDefault(); moveRight(); }
  else if (k==="ArrowUp"){ e.preventDefault(); moveUp(); }
  else if (k==="ArrowDown"){ e.preventDefault(); moveDown(); }
}

// Draw
function draw(){ /* render loop */
  ctx.clearRect(0,0,W,H);
  if (bg.complete) ctx.drawImage(bg,0,0,W,H);
  drawParallax(state.t);

  // VS panels & divider
  if (state.mode==='vs'){
    const bw = state.cell*state.gridW, bh = state.cell*state.gridH;
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    roundRect(ctx, state.oppGridX-16, state.gridY-100, bw+32, bh+140, 18);
    ctx.fill();
    roundRect(ctx, state.gridX-16, state.gridY-100, bw+32, bh+140, 18);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(W/2-2, 80, 4, H-120);
    ctx.restore();
    drawBadge(state.oppGridX + bw/2, state.gridY-8, "Соперник", "#fab36e");
    drawBadge(state.gridX + bw/2, state.gridY-8, "Вы", "#7bd38c");
  }

  
  // room id (top-left) in VS
  if (state.mode==='vs' && state.roomId){
    ctx.save();
    ctx.fillStyle = "#e8ecf1";
    ctx.font = "bold 14px Arial";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("Комната: " + state.roomId, 12, 10);
    ctx.restore();
  }

  // grid
  for (let y=0;y<state.gridH;y++){
    for (let x=0;x<state.gridW;x++){
      const gx = state.gridX + x*state.cell;
      const gy = state.gridY + y*state.cell;
      ctx.fillStyle = "#191b1f";
      ctx.fillRect(gx, gy, state.cell, state.cell);
      ctx.strokeStyle = "#8a93a0";
      ctx.lineWidth = 3;
      ctx.strokeRect(gx+0.5, gy+0.5, state.cell-1, state.cell-1);
    }
  }

  // static items (hidden at anim destinations)
  for (let y2=0;y2<state.gridH;y2++){
    for (let x2=0;x2<state.gridW;x2++){
      const v = state.grid[y2][x2];
      if (v>0){
        if (state.anim.active && state.anim.mask[keyCell(x2,y2)]) continue;
        const p2 = rectPos(x2,y2);
        const key = keyCell(x2,y2);
        const fx = state.effects[key];
        let jumpY = 0, scale = 1;
        if (fx){
          fx.t += 16;
          const tt = Math.min(1, fx.t / fx.dur);
          const e = easeOutCubic(tt);
          jumpY = -10 * (1 - e);
          scale = 1 + 0.1 * (1 - e);
          if (tt>=1) delete state.effects[key];
        }
        ctx.save();
        ctx.translate(p2.x, p2.y + jumpY);
        ctx.scale(scale, scale);
        drawSphere(0, 0, 22 + v*3, colorForLevel(v), v);
        ctx.restore();
      }
    }
  }

  // sliding animation
  if (state.anim.active){
    const tt = Math.min(1, state.anim.t / state.anim.dur);
    const e = easeOutCubic(tt);
    for (let i=0;i<state.anim.slides.length;i++){
      const s = state.anim.slides[i];
      const x = lerp(s.x0, s.x1, e);
      const y = lerp(s.y0, s.y1, e);
      drawSphere(x, y, 22 + s.lv*3, colorForLevel(s.lv), s.lv);
    }
    state.anim.t += 16;
    if (tt>=1){
      state.anim.active=false;
      // jump for merged results
      for (let i=0;i<state.anim.slides.length;i++){
        const s = state.anim.slides[i];
        if (s.merged && s.primary){
          state.effects[keyCell(s.destX, s.destY)] = {t:0, dur:250};
        }
      }
      if (state.anim.afterFn) state.anim.afterFn();
      state.anim.slides=[]; state.anim.mask={}; state.anim.afterFn=null;
    }
  }


  // opponent grid (right, read-only in VS mode)
  if (state.mode==='vs'){
    for (let y=0;y<state.gridH;y++){
      for (let x=0;x<state.gridW;x++){
        const gx = state.oppGridX + x*state.cell;
        const gy = state.gridY + y*state.cell;
        ctx.fillStyle = "#16181c";
        ctx.fillRect(gx, gy, state.cell, state.cell);
        ctx.strokeStyle = "#566070";
        ctx.lineWidth = 2;
        ctx.strokeRect(gx+0.5, gy+0.5, state.cell-1, state.cell-1);
      }
    }
    for (let y2=0;y2<state.gridH;y2++){
      for (let x2=0;x2<state.gridW;x2++){
        const v = state.opp.grid[y2] ? state.opp.grid[y2][x2] : 0;
        if (v>0){
          const p2 = {x: state.oppGridX + x2*state.cell + state.cell/2, y: state.gridY + y2*state.cell + state.cell/2};
          drawSphere(p2.x, p2.y, 22 + v*3, colorForLevel(v), v);
        }
      }
    }
  }


  // opponent grid (left, read-only in VS mode)
  if (state.mode==='vs'){
    // draw opp tiles
    let oppCount=0;
    for (let y=0;y<state.gridH;y++){
      for (let x=0;x<state.gridW;x++){
        const gx = state.oppGridX + x*state.cell;
        const gy = state.gridY + y*state.cell;
        ctx.fillStyle = "#16181c";
        ctx.fillRect(gx, gy, state.cell, state.cell);
        ctx.strokeStyle = "#566070";
        ctx.lineWidth = 2;
        ctx.strokeRect(gx+0.5, gy+0.5, state.cell-1, state.cell-1);
      }
    }
    for (let y2=0;y2<state.gridH;y2++){
      for (let x2=0;x2<state.gridW;x2++){
        const v = (state.opp.grid[y2] && state.opp.grid[y2][x2]) || 0;
        if (v>0){
          const p2 = {x: state.oppGridX + x2*state.cell + state.cell/2, y: state.gridY + y2*state.cell + state.cell/2};
          drawSphere(p2.x, p2.y, 22 + v*3, colorForLevel(v), v);
          oppCount++;
        }
      }
    }
    if ((state.t%60)===0) { try{ console.debug(DBG,'opp tiles', oppCount); }catch(e){} }
  }

  // stats
  if (state.mode==='vs'){
    // your stats (right board), small spheres
    for (let lv=1; lv<=6; lv++){
      const baseX = state.gridX + (lv-1)*(state.cell*state.gridW/6) + (state.cell*state.gridW/12);
      const yTop = state.gridY - 28; // above the board
      drawSphere(baseX, yTop, 12, colorForLevel(lv), lv);
      ctx.fillStyle = "#e8ecf1";
      ctx.font = "bold 11px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(state.stats[lv]||0), baseX, yTop+14);
    }
    // opponent stats (left board), small spheres
    for (let lv=1; lv<=6; lv++){
      const baseX = state.oppGridX + (lv-1)*(state.cell*state.gridW/6) + (state.cell*state.gridW/12);
      const yTop = state.gridY - 28;
      drawSphere(baseX, yTop, 12, colorForLevel(lv), lv);
      ctx.fillStyle = "#e8ecf1";
      ctx.font = "bold 11px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(state.opp.stats[lv]||0), baseX, yTop+14);
    }
  } else {
    // solo: single bar on top as before
    for (let lv=1; lv<=6; lv++){
      const sp = statsTargetPos(lv);
      drawSphere(sp.x, sp.y, 22, colorForLevel(lv), lv);
      ctx.fillStyle = "#e8ecf1";
      ctx.font = "bold 14px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(state.stats[lv]||0), sp.x, sp.y+26);
    }
  }

  // fly-to-stats
  const keep = [];
  for (let i=0;i<state.fly.length;i++){
    const fx = state.fly[i];
    fx.t += 16;
    const tt = Math.min(1, fx.t / fx.dur);
    const e2 = easeOutCubic(tt);
    const x = fx.x0 + (fx.x1 - fx.x0) * e2;
    const y = fx.y0 + (fx.y1 - fx.y0) * e2 - 20*(1-e2);
    drawSphere(x, y, 18, colorForLevel(fx.lv), fx.lv);
    if (tt>=1){
      state.stats[fx.lv] = (state.stats[fx.lv]||0) + 1;
    } else {
      keep.push(fx);
    }
  }
  state.fly = keep;

  requestAnimationFrame(draw);
}

// Bootstrap
function start(){ console.log(DBG,'start');
  // Wire start menu buttons
  const menu = document.getElementById('startMenu');
  const wrap = document.getElementById('wrap');
  const hudDiv = document.getElementById('hud');
  const netbar = document.getElementById('netbar');
  const btnSolo = document.getElementById('menuSolo');
  const btnCreate = document.getElementById('menuVSCreate');
  const btnJoin = document.getElementById('menuVSJoin');
  const roomInput = document.getElementById('menuRoomId');
  function showGame(){
    state.phase = 'game';
    if (menu) menu.style.display = 'none';
    if (wrap) wrap.style.display = '';
    if (hudDiv) hudDiv.style.display = 'none'; // keep hidden per request
    if (state.mode==='vs' && netbar) netbar.style.display = 'none'; // keep hidden per request
    layoutForMode();
  }
  if (btnSolo){
    btnSolo.addEventListener('click', ()=>{ console.log(DBG,'menu: solo');
      state.mode='solo';
      showGame();
  // Fallback to Solo if no server connection is established shortly
  setTimeout(function(){
    if (state.mode==='vs' && (!window._NET || !_NET.connected)){
      try{ alert('Сервер недоступен. Включаю Solo.'); }catch(e){}
      state.mode='solo';
      layoutForMode();
    }
  }, 1500);

    });
  }
  if (btnCreate){
    btnCreate.addEventListener('click', ()=>{ console.log(DBG,'menu: create');
      state.mode='vs';
      const id = (roomInput && roomInput.value.trim()) || Math.random().toString(36).slice(2,8);
      state.roomId = id;
      if (roomInput) roomInput.value = id;
      if (window._NET){ _NET.connect(); _NET.send({type:'create', roomId:id, name:'Player'}); }
      showGame();
  // Fallback to Solo if no server connection is established shortly
  setTimeout(function(){
    if (state.mode==='vs' && (!window._NET || !_NET.connected)){
      try{ alert('Сервер недоступен. Включаю Solo.'); }catch(e){}
      state.mode='solo';
      layoutForMode();
    }
  }, 1500);

    });
  }
  if (btnJoin){
    btnJoin.addEventListener('click', ()=>{ console.log(DBG,'menu: join');
      state.mode='vs';
      const id = roomInput && roomInput.value.trim();
      state.roomId = id;
      if (!id) { alert('Введите Room ID'); return; }
      if (window._NET){ _NET.connect(); _NET.send({type:'join', roomId:id, name:'Player'}); }
      showGame();
  // Fallback to Solo if no server connection is established shortly
  setTimeout(function(){
    if (state.mode==='vs' && (!window._NET || !_NET.connected)){
      try{ alert('Сервер недоступен. Включаю Solo.'); }catch(e){}
      state.mode='solo';
      layoutForMode();
    }
  }, 1500);

    });
  }

  canvas = document.getElementById("gameCanvas");
  ctx = canvas.getContext("2d");
  energyEl = document.getElementById("energyText");
  coinsEl = document.getElementById("coinsText");
  questsEl = document.getElementById("quests");
  logEl = document.getElementById("log");
  hintEl = document.getElementById("hint");

  initGrid();
  layoutForMode();
  state.quests = (window.QUESTS || []).slice();
  renderQuests();
  updateHUD();
  draw();
  setInterval(tick, 500);

  var _sb=document.getElementById("spawnBtn"); if(_sb) _sb.addEventListener("click", spawn);
  var _sv=document.getElementById("saveBtn"); if(_sv) _sv.addEventListener("click", function(){ 
    YSDK.saveCloud({grid:state.grid, coins:state.coins, energy:state.energy, completed:state.completed, t:Date.now()}); 
    log("Сохранение выполнено"); 
  });
  var _lv=document.getElementById("loadBtn"); if(_lv) _lv.addEventListener("click", function(){ 
    YSDK.loadCloud(function(data){ 
      if(!data){ log("Сохранение не найдено"); return; } 
      state.grid=data.grid||state.grid; 
      state.coins=data.coins||0; 
      state.energy=data.energy||state.energy; 
      state.completed=data.completed||{}; 
      updateHUD(); 
      renderQuests(); 
      log("Сохранение загружено"); 
    }); 
  });
  var _ad=document.getElementById("adBtn"); if(_ad) _ad.addEventListener("click", function(){ 
    YSDK.showRewarded(function(){ 
      state.energy = clamp(state.energy+20, 0, state.maxEnergy); 
      updateHUD(); 
      log("Получено +20 энергии"); 
    }); 
  });

  canvas.addEventListener("mousedown", onDown, {passive:false});
  canvas.addEventListener("mouseup", onUp, {passive:false});
  canvas.addEventListener("touchstart", onDown, {passive:false});
  canvas.addEventListener("touchend", onUp, {passive:false});
  window.addEventListener("keydown", onKey);

  if (hintEl) setTimeout(function(){ hintEl.style.display = "none"; }, 6000);
}

window.addEventListener("DOMContentLoaded", start);

// Wire net UI
window.addEventListener("DOMContentLoaded", function(){
  const modeSel = document.getElementById('modeSel');
  const roomId = document.getElementById('roomId');
  const btnC = document.getElementById('createBtn');
  const btnJ = document.getElementById('joinBtn');
  const btnR = document.getElementById('readyBtn');
  if (!modeSel) return;
  modeSel.addEventListener('change', ()=>{
    state.mode = modeSel.value;
    layoutForMode();
    if (state.mode==='vs'){ _NET.connect(); } else { uiSetConn('offline'); }
  });
  btnC.addEventListener('click', ()=>{
    state.mode='vs'; modeSel.value='vs'; _NET.connect();
    const id = roomId.value.trim() || Math.random().toString(36).slice(2,8);
    roomId.value = id;
    _NET.send({type:'create', roomId:id, name:'Player'});
  });
  btnJ.addEventListener('click', ()=>{
    state.mode='vs'; modeSel.value='vs'; _NET.connect();
    const id = roomId.value.trim(); if(!id) return alert('Room ID');
    _NET.send({type:'join', roomId:id, name:'Player'});
  });
  btnR.addEventListener('click', ()=>{
    if (state.mode!=='vs') return;
    _NET.send({type:'ready', roomId:_NET.roomId, youId:_NET.youId});
  });

  _NET.onRoom = (m)=>{ console.log(DBG,'onRoom', m);
    state.youId = m.youId;
    state.roomId = m.roomId || (window._NET && _NET.roomId) || state.roomId;
    layoutForMode();
    // reset boards to server-provided initial if present
    if (m.state){
      state.grid = (m.state && m.state.you && m.state.you.grid) ? m.state.you.grid.map(r=>r.slice()) : state.grid;
      state.energy = m.state.you.energy;
      state.coins = m.state.you.coins;
      state.completed = m.state.you.completed || {};
      state.quests = m.state.you.quests || state.quests;
      state.opp.grid = (m.state && m.state.opp && m.state.opp.grid) ? m.state.opp.grid.map(r=>r.slice()) : state.opp.grid;
      state.opp.energy = m.state.opp.energy;
      state.opp.coins = m.state.opp.coins;
      state.opp.completed = m.state.opp.completed || {};
      state.opp.quests = m.state.opp.quests || [];
    }
    updateHUD(); renderQuests();
  };

  _NET.onDelta = (d)=>{ console.log(DBG,'onDelta', d); try{ window.requestAnimationFrame(()=>draw()); }catch(_){}
    // Apply server authoritative state
    if (d.you){
      state.grid = (d.you && d.you.grid) ? d.you.grid.map(r=>r.slice()) : state.grid;
      state.energy = d.you.energy;
      state.coins = d.you.coins;
      state.completed = d.you.completed || state.completed;
      state.stats = d.you.stats || state.stats;
    }
    if (d.opp){
      state.opp.grid = (d.opp && d.opp.grid) ? d.opp.grid.map(r=>r.slice()) : state.opp.grid;
      state.opp.energy = d.opp.energy;
      state.opp.coins = d.opp.coins;
      state.opp.completed = d.opp.completed || state.opp.completed;
      state.opp.stats = d.opp.stats || state.opp.stats;
    }
    updateHUD(); renderQuests();
  };
});
// Safe wrappers if panel elements are absent
try{
  if (!document.getElementById('quests')){
    // override to no-op
    if (typeof renderQuests === 'function'){ renderQuests = function(){}; }
  }
} catch(e){}
try{
  if (!document.getElementById('log')){
    if (typeof log === 'function'){ log = function(){}; }
  }
} catch(e){}
})();