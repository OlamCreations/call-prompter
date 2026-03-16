/**
 * Call Prompter Bookmarklet
 *
 * Drag this to your bookmarks bar, then click it when on a Google Meet call.
 * No extension, no CDP, no install needed.
 *
 * Requires: server running (bun server.mjs)
 *
 * Minified bookmarklet URL (paste as bookmark URL):
 */

// javascript:void((()=>{const W='ws://127.0.0.1:4242',S=['[jsname="tgaKEf"]','[data-message-text]','.iOzk7','.TBMuR span','div[class*="caption"] span'];let w,l='';try{w=new WebSocket(W)}catch{return alert('Call Prompter server not running. Start with: bun server.mjs')}w.onopen=()=>{console.log('[CP] Connected');const o=new MutationObserver(()=>{for(const s of S){const e=document.querySelectorAll(s);if(e.length){const t=Array.from(e).map(x=>x.textContent).filter(Boolean).join(' ').trim();if(t&&t!==l&&t.length>2){l=t;w.send(JSON.stringify({type:'caption',text:t,ts:Date.now(),source:'bookmarklet'}))}return}}});o.observe(document.body,{childList:!0,subtree:!0,characterData:!0});setInterval(()=>{for(const s of S){const e=document.querySelectorAll(s);if(e.length){const t=Array.from(e).map(x=>x.textContent).filter(Boolean).join(' ').trim();if(t&&t!==l&&t.length>2){l=t;w.send(JSON.stringify({type:'caption',text:t,ts:Date.now(),source:'bookmarklet'}))}return}}},500)};w.onerror=()=>alert('Cannot connect to Call Prompter server')})())
