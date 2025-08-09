(function(){
'use strict';

const proto = location.protocol === 'https:' ? 'wss' : 'ws';

const Net = {
  _tag: '[NET]',
  ws:null,
  url: (location.hostname ? `${proto}://${location.hostname}:8080` : `${proto}://localhost:8080`),
  roomId:null,
  youId:null,
  seed:null,
  mode:'solo',
  connected:false,
  ready:false,
  onDelta:null,
  onRoom:null,
  connect(){
    if (this.ws && (this.ws.readyState===WebSocket.OPEN || this.ws.readyState===WebSocket.CONNECTING)) return;
    this.ws = new WebSocket(this.url);
    this.ws.onopen = ()=>{ console.log(this._tag,'open'); this.connected=true; uiSetConn('online'); if (this.roomId && this.mode==='vs') { console.log(this._tag,'reconnect', this.roomId, this.youId); this.send({type:'reconnect', roomId:this.roomId, youId:this.youId}); } };
    this.ws.onclose = (e)=>{ console.warn(this._tag,'close', e?.code, e?.reason); this.connected=false; uiSetConn('offline'); };
    this.ws.onerror = (e)=>{ console.error(this._tag,'error', e); this.connected=false; uiSetConn('error'); };
    this.ws.onmessage = (e)=>{ try{ console.log(this._tag,'recv', e.data?.slice?.(0,120)); }catch(_){}
      try{ const m = JSON.parse(e.data); this.handle(m); }catch(err){ console.error(err); }
    };
  },
  send(obj){ if (!this.ws || this.ws.readyState!==WebSocket.OPEN) return; this.ws.send(JSON.stringify(obj)); },
  handle(m){ console.log(this._tag,'handle', m?.type, m);
    if (m.type==='room_state'){ this.roomId=m.roomId; this.youId=m.youId; this.seed=m.seed; this.ready=false; this.onRoom && this.onRoom(m); uiSetConn(`room ${this.roomId}`); }
    else if (m.type==='state_delta'){ this.onDelta && this.onDelta(m); }
    else if (m.type==='start'){ log(`Матч старт через ${m.countdown}...`); }
    else if (m.type==='chat'){ log(`[${m.from}]: ${m.text}`); }
  }
};

// Simple UI helpers (wired by game.js)
window._NET = Net;
window.uiSetConn = function(t){ const el=document.getElementById('connState'); if(el) el.textContent=t; };

})();