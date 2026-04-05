import { useRef, useState, useCallback, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  SafeAreaView,
  ScrollView,
  Platform,
} from 'react-native';
import Constants from 'expo-constants';
import { WebView } from 'react-native-webview';

// ─── Config ──────────────────────────────────────────────────
const BETKING_URL =
  'https://m.betking.com/en-ng/virtuals/instant/leagues/kings-instaleague';
const BASE_BET = 10;
const BET_STEP = 10;
const FAV_MIN = 1.93;
const FAV_MAX = 1.99;
const DRAW_MIN = 3.2;
const DRAW_MAX = 3.9;
const POLL_MS = 3000;

// ─── Bot States ──────────────────────────────────────────────
const S = {
  IDLE: 'IDLE',
  WAIT_PAGE: 'WAIT_PAGE',
  SCANNING: 'SCANNING',
  SELECTING: 'SELECTING',
  OPENING_SLIP: 'OPENING_SLIP',
  SETTING_STAKE: 'SETTING_STAKE',
  PLACING: 'PLACING',
  WAIT_LIVE: 'WAIT_LIVE',
  WAIT_RESULTS: 'WAIT_RESULTS',
  GOING_NEXT: 'GOING_NEXT',
  SKIPPING: 'SKIPPING',
};

// ─── Injected JS: Detect Page & Scan ─────────────────────────
const JS_DETECT = `
(function(){
  try{
    var r={type:'bot',action:'detect'};
    var body=document.body?document.body.innerText:'';

    // 1) Win popup — check for <dialog> element or "You won!" in body
    var modal=document.querySelector('dialog[open],dialog.dialog,[role="dialog"]');
    if(!modal){
      var ds=document.querySelectorAll('[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"]');
      for(var i=0;i<ds.length;i++){if(ds[i].offsetParent!==null||ds[i].tagName==='DIALOG'){modal=ds[i];break;}}
    }
    // Also check body text for "You won!" even if no modal found
    if(!modal&&body.indexOf('You won!')!==-1){
      // Find the nearest container with "You won!"
      var all=document.querySelectorAll('div,section,dialog');
      for(var i=0;i<all.length;i++){
        var t=(all[i].innerText||'').trim();
        if(t.indexOf('You won!')!==-1&&t.length<300){modal=all[i];break;}
      }
    }
    if(modal&&(modal.tagName==='DIALOG'||modal.offsetParent!==null)&&(modal.innerText||'').indexOf('You won!')!==-1){
      r.page='popup';
      r.winAmount='';
      var spans=modal.querySelectorAll('*');
      for(var i=0;i<spans.length;i++){
        var t=spans[i].textContent.trim();
        if(t.match(/^[₦N][\\d,.]+$/)){r.winAmount=t;break;}
      }
      window.ReactNativeWebView.postMessage(JSON.stringify(r));return;
    }

    // 2) Betslip overlay
    if(body.indexOf('PLACE BET')!==-1&&(body.indexOf('BETSLIP')!==-1||body.indexOf('Betslip')!==-1)){
      r.page='betslip';
      var inputs=document.querySelectorAll('input');
      r.stakeVal='';
      for(var i=0;i<inputs.length;i++){
        var inp=inputs[i];
        if(inp.type!=='checkbox'&&inp.type!=='hidden'&&inp.offsetParent!==null){
          r.stakeVal=inp.value;break;
        }
      }
      window.ReactNativeWebView.postMessage(JSON.stringify(r));return;
    }

    // 3) Live play
    var bodyUpper=body.toUpperCase();
    if(bodyUpper.indexOf('- LIVE')!==-1&&bodyUpper.indexOf('PROCEED TO RESULTS')!==-1){
      r.page='live';
      window.ReactNativeWebView.postMessage(JSON.stringify(r));return;
    }

    // 4) Results page
    if(bodyUpper.indexOf('NEXT ROUND')!==-1&&body.indexOf('All Fixtures')!==-1){
      r.page='results';
      r.fixtures=[];
      var re=/([A-Z]{3})\\D{0,20}?(\\d+)\\s*[-\\u2013]\\s*(\\d+)\\D{0,20}?([A-Z]{3})/g;
      var m;while((m=re.exec(body))!==null){
        r.fixtures.push({h:m[1],hs:+m[2],as:+m[3],a:m[4]});
      }
      window.ReactNativeWebView.postMessage(JSON.stringify(r));return;
    }

    // 5) Match listing
    var roundEl=document.querySelector('[data-testid="league-data-subtext"]');
    if(roundEl){
      r.page='listing';
      r.round=roundEl.textContent.trim();
      var groups=document.querySelectorAll('[class*="button-group--rounded"]');
      r.matches=[];
      for(var g=0;g<groups.length;g++){
        var btns=groups[g].querySelectorAll('[class*="pill-contained--odd"]');
        if(btns.length!==3) continue;
        var odds=[];
        for(var b=0;b<3;b++) odds.push(parseFloat(btns[b].textContent.trim()));
        if(odds.some(function(v){return isNaN(v);})) continue;
        var par=groups[g].parentElement;
        var tt='';
        if(par){
          for(var c=0;c<par.childNodes.length;c++){
            var ch=par.childNodes[c];
            if(ch===groups[g]||(ch.contains&&ch.contains(groups[g]))) continue;
            tt+=(ch.textContent||'').trim()+' ';
          }
        }
        var tm=tt.match(/([A-Z]{3})\\s*[-\\u2013]\\s*([A-Z]{3})/);
        r.matches.push({idx:g,home:tm?tm[1]:'?',away:tm?tm[2]:'?',odds:odds});
      }
      // Find qualified match
      r.qualified=null;
      for(var i=0;i<r.matches.length;i++){
        var mx=r.matches[i];
        if(mx.odds[1]<${DRAW_MIN}||mx.odds[1]>${DRAW_MAX}) continue;
        if(mx.odds[0]>=${FAV_MIN}&&mx.odds[0]<=${FAV_MAX}){
          r.qualified={idx:mx.idx,home:mx.home,away:mx.away,type:'1X',odds:mx.odds};break;
        }
        if(mx.odds[2]>=${FAV_MIN}&&mx.odds[2]<=${FAV_MAX}){
          r.qualified={idx:mx.idx,home:mx.home,away:mx.away,type:'X2',odds:mx.odds};break;
        }
      }
      window.ReactNativeWebView.postMessage(JSON.stringify(r));return;
    }

    r.page='unknown';
    window.ReactNativeWebView.postMessage(JSON.stringify(r));
  }catch(e){
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'detect',page:'error',msg:e.message}));
  }
})();true;`;

// ─── Injected JS: Actions ────────────────────────────────────

function jsSelectOdds(groupIdx, type) {
  const first = type === '1X' ? 0 : 1;
  const second = type === '1X' ? 1 : 2;
  return `
(function(){
  try{
    var groups=document.querySelectorAll('[class*="button-group--rounded"]');
    var g=groups[${groupIdx}];
    if(!g){window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'select',ok:false,msg:'group not found'}));return;}
    var b=g.querySelectorAll('[class*="pill-contained--odd"]');
    if(b.length<3){window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'select',ok:false,msg:'buttons not found'}));return;}
    g.scrollIntoView({block:'center'});
    setTimeout(function(){b[${first}].click();},500);
    setTimeout(function(){b[${second}].click();},1200);
    setTimeout(function(){
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'select',ok:true}));
    },1800);
  }catch(e){
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'select',ok:false,msg:e.message}));
  }
})();true;`;
}

const JS_OPEN_BETSLIP = `
(function(){
  try{
    var found=false;

    // Strategy 1: Click the bottom-nav Betslip icon (most reliable)
    var nav=document.querySelector('#islands-bottom-nav');
    if(nav){
      // Find the anchor/link whose visible label is "Betslip"
      var links=nav.querySelectorAll('a');
      for(var i=0;i<links.length;i++){
        if(links[i].textContent.indexOf('Betslip')!==-1){
          links[i].click();found=true;break;
        }
      }
      // If no <a>, try any clickable child
      if(!found){
        var ch=nav.children;
        for(var i=0;i<ch.length;i++){
          if(ch[i].textContent.indexOf('Betslip')!==-1){
            ch[i].click();found=true;break;
          }
        }
      }
    }

    // Strategy 2: Click the floating selections bar
    if(!found){
      var all=document.querySelectorAll('div');
      var best=null;var bestLen=99999;
      for(var i=0;i<all.length;i++){
        var t=all[i].textContent||'';
        if(t.indexOf('Selection')!==-1&&t.indexOf('Odds')!==-1&&all[i].offsetParent!==null){
          if(t.length<bestLen){bestLen=t.length;best=all[i];}
        }
      }
      if(best){best.click();found=true;}
    }

    // Strategy 3: Click the pill betslip button
    if(!found){
      var btn=document.querySelector('button.pill.pill-text.pill-text--inherit');
      if(btn&&btn.offsetParent!==null){btn.click();found=true;}
    }

    setTimeout(function(){
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'openSlip',ok:found}));
    },2000);
  }catch(e){
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'openSlip',ok:false,msg:e.message}));
  }
})();true;`;

function jsSetStake(amount) {
  return `
(function(){
  try{
    var inputs=document.querySelectorAll('input');
    var inp=null;
    for(var i=0;i<inputs.length;i++){
      if(inputs[i].type!=='checkbox'&&inputs[i].type!=='hidden'&&inputs[i].offsetParent!==null){
        inp=inputs[i];break;
      }
    }
    if(!inp){
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'stake',ok:false,msg:'no input found'}));return;
    }
    inp.focus();
    inp.select&&inp.select();
    var ns=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    ns.call(inp,'${amount}');
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    inp.dispatchEvent(new Event('change',{bubbles:true}));
    setTimeout(function(){
      inp.dispatchEvent(new Event('blur',{bubbles:true}));
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'stake',ok:true,val:inp.value}));
    },800);
  }catch(e){
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'stake',ok:false,msg:e.message}));
  }
})();true;`;
}

const JS_PLACE_BET = `
(function(){
  try{
    var found=false;
    var el=null;

    // Strategy 1: exact selector from BetKing DOM
    el=document.querySelector('button[data-testid="loading-button-contained--highlight"]');
    if(!el) el=document.querySelector('button.pill-contained--highlight');
    if(!el) el=document.querySelector('button.pill--fullWidth');

    // Strategy 2: innerText search (respects text-transform CSS)
    if(!el){
      var all=document.querySelectorAll('button,a,div,span,[role="button"]');
      for(var i=0;i<all.length;i++){
        var t=(all[i].innerText||'').trim().toUpperCase();
        if(t==='PLACE BET'||t==='PLACEBET'){
          el=all[i];break;
        }
      }
    }

    // Strategy 3: Find largest button in bottom half of viewport (betslip area)
    if(!el){
      var btns=document.querySelectorAll('button,a,[role="button"]');
      var maxArea=0;
      var vh=window.innerHeight;
      for(var i=0;i<btns.length;i++){
        var rect=btns[i].getBoundingClientRect();
        var area=rect.width*rect.height;
        // Must be wide (>60% viewport), tall enough, in bottom half
        if(rect.width>vh*0.5&&rect.height>35&&rect.top>vh*0.5&&area>maxArea){
          maxArea=area;el=btns[i];
        }
      }
    }

    // Strategy 4: elementFromPoint — PLACE BET is center-bottom of viewport
    if(!el){
      var vh=window.innerHeight;
      var vw=window.innerWidth;
      el=document.elementFromPoint(vw/2, vh-80);
    }

    // Log what we found
    var info=el?('tag='+el.tagName+' inner="'+(el.innerText||'').trim().substring(0,30)+'" text="'+(el.textContent||'').trim().substring(0,30)+'" testid='+(el.getAttribute('data-testid')||'-')+' class='+(el.className||'').toString().substring(0,40)):'NOTHING';
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'placeDebug',info:info}));

    if(el){
      found=true;
      el.scrollIntoView({block:'center'});
      el.click();

      // Log which element we clicked
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'placeDebug',
        info:'CLICKED: tag='+el.tagName+' testid='+(el.getAttribute('data-testid')||'-')+' class='+(el.className||'').toString().substring(0,60)
      }));
    }

    // Verify bet was actually placed by checking if betslip closes
    setTimeout(function(){
      var stillOnSlip=document.body.innerText.indexOf('PLACE BET')!==-1&&document.body.innerText.indexOf('BETSLIP')!==-1;
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'place',ok:found&&!stillOnSlip}));
    },2000);
  }catch(e){
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'place',ok:false,msg:e.message}));
  }
})();true;`;

const JS_PROCEED = `
(function(){
  var els=document.querySelectorAll('button,a,div,span');
  var found=false;
  for(var i=0;i<els.length;i++){
    var t=(els[i].innerText||els[i].textContent||'').trim().toUpperCase();
    if(t.indexOf('PROCEED TO RESULTS')!==-1){
      var rect=els[i].getBoundingClientRect();
      if(rect.width>30){els[i].click();found=true;break;}
    }
  }
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'proceed',ok:found}));
})();true;`;

const JS_NEXT_ROUND = `
(function(){
  var els=document.querySelectorAll('button,a,div,span');
  var found=false;
  // Find smallest element with "Next Round" text (avoid clicking huge parent)
  var best=null;var bestLen=99999;
  for(var i=0;i<els.length;i++){
    var t=(els[i].innerText||els[i].textContent||'').trim().toUpperCase();
    if(t.indexOf('NEXT ROUND')!==-1){
      var rect=els[i].getBoundingClientRect();
      if(rect.width>30&&rect.height>10&&t.length<bestLen){
        bestLen=t.length;best=els[i];
      }
    }
  }
  if(best){best.click();found=true;}
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'next',ok:found}));
})();true;`;

const JS_DISMISS_POPUP = `
(function(){
  var found=false;

  // Find the popup: <dialog> or container with "You won!"
  var modal=document.querySelector('dialog[open],dialog.dialog,[role="dialog"]');
  if(!modal){
    var ds=document.querySelectorAll('[class*="modal"],[class*="Modal"],[class*="dialog"],[class*="Dialog"],dialog');
    for(var i=0;i<ds.length;i++){
      if((ds[i].innerText||'').indexOf('You won!')!==-1){modal=ds[i];break;}
    }
  }
  if(!modal){
    // Broad search for You won! container
    var all=document.querySelectorAll('div,section,dialog');
    for(var i=0;i<all.length;i++){
      var t=(all[i].innerText||'').trim();
      if(t.indexOf('You won!')!==-1&&t.length<300){modal=all[i];break;}
    }
  }

  if(modal){
    // Try NEXT ROUND button inside popup
    var els=modal.querySelectorAll('button,a,div,span');
    for(var i=0;i<els.length;i++){
      var t=(els[i].innerText||els[i].textContent||'').trim().toUpperCase();
      if(t==='NEXT ROUND'||t.indexOf('NEXT ROUND')!==-1){els[i].click();found=true;break;}
    }
    // Try close/X button
    if(!found){
      var cls=modal.querySelectorAll('button,span,svg,div');
      for(var i=0;i<cls.length;i++){
        var t=cls[i].textContent.trim();
        if(t==='\\u00d7'||t==='\\u2715'||t==='X'||t==='x'||t==='\\u2573'){cls[i].click();found=true;break;}
      }
    }
  }

  // Ultimate fallback: click any visible NEXT ROUND on page
  if(!found){
    var all=document.querySelectorAll('button,a,div,span');
    for(var i=0;i<all.length;i++){
      var t=(all[i].innerText||'').trim().toUpperCase();
      if(t.indexOf('NEXT ROUND')!==-1){
        var rect=all[i].getBoundingClientRect();
        if(rect.width>30&&rect.height>10){all[i].click();found=true;break;}
      }
    }
  }

  window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'dismiss',ok:found}));
})();true;`;

const JS_SKIP_ROUND = `
(function(){
  var els=document.querySelectorAll('button,a,div,span');
  var found=false;
  var best=null;var bestLen=99999;
  for(var i=0;i<els.length;i++){
    var t=(els[i].innerText||els[i].textContent||'').trim().toUpperCase();
    if(t.indexOf('SKIP ROUND')!==-1){
      if(t.length<bestLen){bestLen=t.length;best=els[i];}
    }
  }
  if(best){
    // Click the element and its parent (handler may be on parent)
    best.click();
    if(best.parentElement) best.parentElement.click();
    found=true;
  }
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'bot',action:'skip',ok:found}));
})();true;`;

// ─── App Component ───────────────────────────────────────────

export default function App() {
  const wv = useRef(null);
  const timerRef = useRef(null);
  const botState = useRef(S.IDLE);
  const cooldownUntil = useRef(0);
  const stateStartedAt = useRef(0);
  const betInfo = useRef(null);
  const lastRound = useRef(null);

  const [running, setRunning] = useState(false);
  const [ui, setUi] = useState({
    state: S.IDLE,
    stake: BASE_BET,
    pnl: 0,
    round: '-',
    log: [],
    roundsBet: 0,
    wins: 0,
    losses: 0,
  });

  // Mutable bot data (refs to avoid stale closures)
  const d = useRef({
    stake: BASE_BET,
    pnl: 0,
    round: '-',
    log: [],
    roundsBet: 0,
    wins: 0,
    losses: 0,
  });

  const setBotState = useCallback((newState) => {
    botState.current = newState;
    stateStartedAt.current = Date.now();
  }, []);

  const addLog = useCallback((msg) => {
    const ts = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    d.current.log = [`[${ts}] ${msg}`, ...d.current.log.slice(0, 49)];
  }, []);

  const syncUi = useCallback(() => {
    setUi({
      state: botState.current,
      stake: d.current.stake,
      pnl: d.current.pnl,
      round: d.current.round,
      log: [...d.current.log],
      roundsBet: d.current.roundsBet,
      wins: d.current.wins,
      losses: d.current.losses,
    });
  }, []);

  const inject = useCallback((js) => {
    wv.current?.injectJavaScript(js);
  }, []);

  const setCooldown = useCallback((ms) => {
    cooldownUntil.current = Date.now() + ms;
  }, []);

  // ─── Process results ────────────────────────────────────────
  const processResults = useCallback(
    (fixtures) => {
      const bi = betInfo.current;
      if (!bi) return;

      const fix = fixtures.find(
        (f) =>
          (f.h === bi.home && f.a === bi.away) ||
          (f.a === bi.home && f.h === bi.away)
      );

      if (!fix) {
        addLog('Could not find match in results');
        betInfo.current = null;
        return;
      }

      // Normalize so home/away match our bet
      const hs = fix.h === bi.home ? fix.hs : fix.as;
      const as = fix.h === bi.home ? fix.as : fix.hs;
      addLog(`Result: ${bi.home} ${hs} - ${as} ${bi.away}`);

      let outcome;
      if (bi.type === '1X') {
        if (hs > as) outcome = 'fav';
        else if (hs === as) outcome = 'draw';
        else outcome = 'lost';
      } else {
        if (as > hs) outcome = 'fav';
        else if (hs === as) outcome = 'draw';
        else outcome = 'lost';
      }

      const stake = d.current.stake;
      let profit;
      if (outcome === 'fav') {
        const favOdd = bi.type === '1X' ? bi.odds[0] : bi.odds[2];
        profit = stake * favOdd - stake * 2;
        addLog(
          `Fav won (${bi.type === '1X' ? 'Home' : 'Away'}). Net: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`
        );
      } else if (outcome === 'draw') {
        profit = stake * bi.odds[1] - stake * 2;
        addLog(`DRAW WON! Net: +${profit.toFixed(2)}`);
      } else {
        profit = -(stake * 2);
        addLog(`Both LOST. Net: ${profit.toFixed(2)}`);
      }

      d.current.pnl += profit;
      addLog(`P&L: ${d.current.pnl >= 0 ? '+' : ''}${d.current.pnl.toFixed(2)}`);

      // Staking logic
      if (outcome === 'lost') {
        d.current.stake += BET_STEP;
        d.current.losses++;
        addLog(`Stake increased to ${d.current.stake}`);
      } else if (outcome === 'draw') {
        d.current.wins++;
        if (d.current.pnl > 0) {
          d.current.stake = BASE_BET;
          addLog('P&L positive - reset to base stake');
        }
      } else {
        // fav won — small loss, keep stake
        d.current.losses++;
      }

      betInfo.current = null;
    },
    [addLog]
  );

  // ─── Handle WebView messages ────────────────────────────────
  const handleMessage = useCallback(
    (event) => {
      let msg;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (msg.type !== 'bot') return;

      const st = botState.current;

      // ── Action confirmations ──
      if (msg.action === 'select') {
        if (msg.ok) {
          addLog(
            `Selected ${betInfo.current?.type} for ${betInfo.current?.home}-${betInfo.current?.away}`
          );
          setBotState(S.OPENING_SLIP);
          setCooldown(2000);
          setTimeout(() => inject(JS_OPEN_BETSLIP), 2000);
        } else {
          addLog(`Select failed: ${msg.msg}. Rescanning...`);
          setBotState(S.SCANNING);
          setCooldown(2000);
        }
        syncUi();
        return;
      }

      if (msg.action === 'openSlip') {
        if (msg.ok) {
          addLog('Betslip clicked, waiting for overlay...');
          // Don't jump to SETTING_STAKE yet — let the tick detect 'betslip' page
          setBotState(S.OPENING_SLIP);
          setCooldown(2500);
        } else {
          addLog('Betslip open failed, retrying...');
          setCooldown(2000);
          setTimeout(() => inject(JS_OPEN_BETSLIP), 2000);
        }
        syncUi();
        return;
      }

      if (msg.action === 'stake') {
        if (msg.ok) {
          addLog(`Stake set to ${d.current.stake}`);
          setBotState(S.PLACING);
          setCooldown(1500);
          setTimeout(() => inject(JS_PLACE_BET), 1500);
        } else {
          addLog(`Stake failed: ${msg.msg}. Retrying...`);
          setCooldown(2000);
          setTimeout(() => inject(jsSetStake(d.current.stake)), 2000);
        }
        syncUi();
        return;
      }

      if (msg.action === 'placeDebug') {
        addLog(`PLACE BTN: ${msg.info}`);
        syncUi();
        return;
      }

      if (msg.action === 'place') {
        if (msg.ok) {
          d.current.roundsBet++;
          addLog(
            `BET PLACED! ${d.current.stake} x 2 = ${d.current.stake * 2} total`
          );
          setBotState(S.WAIT_LIVE);
          setCooldown(4000);
        } else {
          addLog('Place bet failed, retrying...');
          setCooldown(2000);
          setTimeout(() => inject(JS_PLACE_BET), 2000);
        }
        syncUi();
        return;
      }

      if (msg.action === 'proceed') {
        setBotState(S.WAIT_RESULTS);
        setCooldown(3000);
        syncUi();
        return;
      }

      if (
        msg.action === 'next' ||
        msg.action === 'dismiss' ||
        msg.action === 'skip'
      ) {
        setBotState(S.WAIT_PAGE);
        setCooldown(3000);
        syncUi();
        return;
      }

      // ── Page detection ──
      if (msg.action === 'detect') {
        const page = msg.page;

        if (page === 'error') {
          addLog(`Error: ${msg.msg}`);
          setCooldown(3000);
          syncUi();
          return;
        }

        if (page === 'unknown') {
          setCooldown(2000);
          return;
        }

        // Win popup — handle from any state
        if (page === 'popup') {
          addLog(`YOU WON! ${msg.winAmount || ''}`);
          setBotState(S.GOING_NEXT);
          inject(JS_DISMISS_POPUP);
          setCooldown(3000);
          syncUi();
          return;
        }

        // Live page
        if (page === 'live') {
          if (
            [S.WAIT_LIVE, S.SCANNING, S.SKIPPING, S.WAIT_PAGE, S.WAIT_RESULTS].includes(st)
          ) {
            addLog('Live play — proceeding to results...');
            inject(JS_PROCEED);
            setBotState(S.WAIT_RESULTS);
            setCooldown(3000);
          }
          syncUi();
          return;
        }

        // Results page
        if (page === 'results') {
          if (
            [S.WAIT_RESULTS, S.WAIT_LIVE, S.GOING_NEXT, S.SCANNING, S.SKIPPING, S.WAIT_PAGE].includes(st)
          ) {
            // Process our bet if we have one
            if (betInfo.current && msg.fixtures && msg.fixtures.length > 0) {
              processResults(msg.fixtures);
            }
            addLog('Going to next round...');
            setBotState(S.GOING_NEXT);
            inject(JS_NEXT_ROUND);
            setCooldown(3000);
          }
          syncUi();
          return;
        }

        // Betslip overlay
        if (page === 'betslip') {
          if (st === S.OPENING_SLIP || st === S.SETTING_STAKE) {
            addLog('On betslip, setting stake...');
            setBotState(S.SETTING_STAKE);
            inject(jsSetStake(d.current.stake));
            setCooldown(2000);
          } else if (st === S.PLACING || st === S.WAIT_LIVE) {
            // Bet wasn't actually placed — retry
            addLog('Bet not placed yet, retrying...');
            d.current.roundsBet = Math.max(0, d.current.roundsBet - 1);
            setBotState(S.PLACING);
            inject(JS_PLACE_BET);
            setCooldown(3000);
          } else if (st === S.SCANNING || st === S.WAIT_PAGE) {
            setCooldown(2000);
          }
          syncUi();
          return;
        }

        // Match listing
        if (page === 'listing') {
          d.current.round = msg.round;

          // Betslip didn't open — retry
          if (st === S.OPENING_SLIP || st === S.SETTING_STAKE) {
            addLog('Betslip not open yet, retrying...');
            inject(JS_OPEN_BETSLIP);
            setCooldown(3000);
            syncUi();
            return;
          }

          if (st === S.SCANNING || st === S.WAIT_PAGE) {
            // If same round as last — skip didn't navigate yet, retry skip
            if (msg.round === lastRound.current) {
              addLog(`Still on ${msg.round}, retrying skip...`);
              setBotState(S.SKIPPING);
              inject(JS_SKIP_ROUND);
              setCooldown(3000);
              syncUi();
              return;
            }

            if (msg.qualified) {
              const q = msg.qualified;
              addLog(
                `${msg.round}: ${q.home}-${q.away} qualifies! ${q.type} [${q.odds.join(', ')}]`
              );
              betInfo.current = {
                home: q.home,
                away: q.away,
                type: q.type,
                odds: q.odds,
                groupIdx: q.idx,
              };
              lastRound.current = msg.round;
              setBotState(S.SELECTING);
              inject(jsSelectOdds(q.idx, q.type));
              setCooldown(3000);
            } else {
              addLog(
                `${msg.round}: No qualifier (${msg.matches?.length || 0} matches). Skipping...`
              );
              lastRound.current = msg.round;
              setBotState(S.SKIPPING);
              inject(JS_SKIP_ROUND);
              setCooldown(3000);
            }
          }
          syncUi();
          return;
        }
      }
    },
    [addLog, inject, processResults, setBotState, setCooldown, syncUi]
  );

  // ─── Tick (polling loop) ────────────────────────────────────
  const tick = useCallback(() => {
    const st = botState.current;
    if (st === S.IDLE) return;
    if (Date.now() < cooldownUntil.current) return;

    // Only detect during waiting/recovery states
    const waitStates = [
      S.SCANNING,
      S.WAIT_PAGE,
      S.WAIT_LIVE,
      S.WAIT_RESULTS,
      S.GOING_NEXT,
      S.SKIPPING,
      S.OPENING_SLIP,
      S.SETTING_STAKE,
      S.PLACING,
    ];
    if (waitStates.includes(st)) {
      inject(JS_DETECT);
      return;
    }

    // Recovery: if stuck in action state > 15s, force rescan
    const actionStates = [S.SELECTING, S.PLACING];
    if (
      actionStates.includes(st) &&
      Date.now() - stateStartedAt.current > 15000
    ) {
      addLog('Action timed out, rescanning...');
      setBotState(S.SCANNING);
      lastRound.current = null;
      syncUi();
    }
  }, [inject, addLog, setBotState, syncUi]);

  // ─── Start / Stop ──────────────────────────────────────────
  const toggleBot = useCallback(() => {
    if (running) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setBotState(S.IDLE);
      setRunning(false);
      addLog('Bot STOPPED');
      syncUi();
    } else {
      setRunning(true);
      setBotState(S.SCANNING);
      cooldownUntil.current = 0;
      lastRound.current = null;
      addLog('Bot STARTED');
      syncUi();
      timerRef.current = setInterval(tick, POLL_MS);
      setTimeout(() => inject(JS_DETECT), 500);
    }
  }, [running, tick, addLog, inject, setBotState, syncUi]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleLoadEnd = useCallback(() => {
    if (botState.current !== S.IDLE) {
      setCooldown(2000);
    }
  }, [setCooldown]);

  // ─── Render ─────────────────────────────────────────────────
  const pnlColor = ui.pnl >= 0 ? '#00b894' : '#e94560';

  const statusBarH = Constants.statusBarHeight || 0;

  return (
    <View style={[styles.container, { paddingTop: statusBarH }]}>
      <StatusBar style="light" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>BetKing Virtual</Text>
        <TouchableOpacity
          style={[styles.btn, running ? styles.btnStop : styles.btnStart]}
          onPress={toggleBot}
        >
          <Text style={styles.btnText}>
            {running ? '\u25A0 Stop' : '\u25B6 Start'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status Bar */}
      <View style={[styles.status, running ? styles.statusOn : styles.statusOff]}>
        <View style={[styles.dot, running ? styles.dotOn : styles.dotOff]} />
        <Text style={styles.statusText}>
          {ui.state} | {ui.round} | Stake: {'\u20A6'}{ui.stake} | P&L:{' '}
          <Text style={{ color: pnlColor }}>
            {'\u20A6'}{ui.pnl >= 0 ? '+' : ''}
            {ui.pnl.toFixed(1)}
          </Text>
          {' | '}Bets: {ui.roundsBet} W:{ui.wins} L:{ui.losses}
        </Text>
      </View>

      {/* Log */}
      {ui.log.length > 0 && (
        <View style={styles.logBox}>
          <ScrollView style={{ maxHeight: 90 }} nestedScrollEnabled>
            {ui.log.slice(0, 8).map((entry, i) => (
              <Text key={i} style={styles.logText} numberOfLines={1}>
                {entry}
              </Text>
            ))}
          </ScrollView>
        </View>
      )}

      {/* WebView */}
      <WebView
        ref={wv}
        source={{ uri: BETKING_URL }}
        style={styles.webview}
        onMessage={handleMessage}
        onLoadEnd={handleLoadEnd}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        userAgent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="compatibility"
        originWhitelist={['*']}
      />
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#16213e',
    borderBottomWidth: 1,
    borderBottomColor: '#0f3460',
  },
  title: { color: '#e94560', fontSize: 18, fontWeight: '700' },
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    minWidth: 80,
    alignItems: 'center',
  },
  btnStart: { backgroundColor: '#00b894' },
  btnStop: { backgroundColor: '#e94560' },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6,
  },
  statusOn: { backgroundColor: '#0a3d2a' },
  statusOff: { backgroundColor: '#2d1a1a' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: '#00b894' },
  dotOff: { backgroundColor: '#555' },
  statusText: { color: '#bbb', fontSize: 10, flex: 1 },
  logBox: {
    backgroundColor: '#0d0d1a',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  logText: { color: '#777', fontSize: 9.5, lineHeight: 13 },
  webview: { flex: 1 },
});
