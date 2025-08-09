(function(){
  function isInIframe(){ try{ return window.top !== window; } catch(e){ return true; } }
  function loadYandexSDK(cb){
    if (!isInIframe()) { console.log("Running outside iframe: skipping Yandex SDK load"); cb(false); return; }
    if (typeof YaGames !== "undefined") { cb(true); return; }
    var s = document.createElement('script');
    s.src = "https://yandex.ru/games/sdk/v2";
    s.async = true;
    s.onload = function(){ cb(true); };
    s.onerror = function(){ console.warn("Failed to load Yandex SDK"); cb(false); };
    document.head.appendChild(s);
  }
  window.YSDK = {
    ysdk:null,
    init:function(){
      loadYandexSDK(function(ok){
        if (!ok || typeof YaGames==="undefined"){ console.log("YSDK in stub mode"); return; }
        YaGames.init().then(function(sdk){
          YSDK.ysdk = sdk;
          try { sdk.features.LoadingAPI && sdk.features.LoadingAPI.ready(); } catch(e){}
          console.log("YSDK initialized");
        }).catch(function(e){ console.warn("YSDK init failed", e); });
      });
    },
    gameplayStart:function(){ try{ YSDK.ysdk && YSDK.ysdk.features && YSDK.ysdk.features.GameplayAPI && YSDK.ysdk.features.GameplayAPI.start(); }catch(e){} },
    gameplayStop:function(){ try{ YSDK.ysdk && YSDK.ysdk.features && YSDK.ysdk.features.GameplayAPI && YSDK.ysdk.features.GameplayAPI.stop(); }catch(e){} },
    showRewarded:function(onReward){
      var stub=function(){ if(confirm("Псевдо‑видео (локально): получить +20 энергии?")) onReward && onReward(); };
      if(!YSDK.ysdk){ stub(); return; }
      try{
        var p = YSDK.ysdk.ads.showRewardedVideo({callbacks:{
          onOpen:function(){},
          onRewarded:function(){ onReward && onReward(); },
          onClose:function(){},
          onError:function(e){ console.warn("reward err", e); stub(); }
        }});
        if (p && p.catch) p.catch(function(e){ console.warn("reward catch", e); stub(); });
      }catch(e){ console.warn(e); stub(); }
    },
    showInterstitial:function(){
      var stub=function(){ console.log("Interstitial suppressed (локально)"); };
      if(!YSDK.ysdk){ stub(); return; }
      try{
        var p = YSDK.ysdk.ads.showFullscreenAdv({callbacks:{
          onClose:function(){},
          onError:function(e){ console.warn("interstitial err", e); stub(); }
        }});
        if (p && p.catch) p.catch(function(e){ console.warn("interstitial catch", e); stub(); });
      }catch(e){ console.warn(e); stub(); }
    },
    saveCloud:function(data){
      var saveLocal=function(){ try{ localStorage.setItem("ms_save", JSON.stringify(data)); }catch(e){} };
      if(!YSDK.ysdk){ saveLocal(); return; }
      try{
        YSDK.ysdk.getPlayer({signed:false}).then(function(p){
          p.setData({ms:data}).catch(function(e){ console.warn(e); saveLocal(); });
        }).catch(function(e){ console.warn(e); saveLocal(); });
      }catch(e){ console.warn(e); saveLocal(); }
    },
    loadCloud:function(cb){
      var loadLocal=function(){ var s=localStorage.getItem("ms_save"); cb(s?JSON.parse(s):null); };
      if(!YSDK.ysdk){ loadLocal(); return; }
      try{
        YSDK.ysdk.getPlayer({signed:false}).then(function(p){
          p.getData(["ms"]).then(function(d){ cb(d && d.ms ? d.ms : null); }).catch(function(e){ console.warn(e); loadLocal(); });
        }).catch(function(e){ console.warn(e); loadLocal(); });
      }catch(e){ console.warn(e); loadLocal(); }
    }
  };
  window.addEventListener("DOMContentLoaded", function(){ YSDK.init(); });
})();