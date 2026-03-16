/**
 * Call Prompter — Chrome Extension Content Script
 *
 * Injected into Google Meet pages. Reads live captions from the DOM
 * and sends them to the local Call Prompter server via WebSocket.
 *
 * No CDP required. No special Chrome flags. Just install and go.
 */

const WS_URL = 'ws://127.0.0.1:4242'
const CAPTION_SELECTORS = [
  '[jsname="tgaKEf"]',
  '[data-message-text]',
  '.iOzk7',
  '[jscontroller="TEjod"] span',
  '.TBMuR span',
  'div[class*="caption"] span',
  'div[class*="subtitle"] span',
]

let ws = null
let lastText = ''
let connected = false
let reconnectTimer = null

function log(msg) {
  console.log(`[Call Prompter] ${msg}`)
}

function connectWs() {
  if (ws && ws.readyState <= 1) return

  try {
    ws = new WebSocket(WS_URL)

    ws.onopen = () => {
      connected = true
      log('Connected to prompter server')
      updateBadge('ON')
    }

    ws.onclose = () => {
      connected = false
      log('Disconnected. Retrying in 5s...')
      updateBadge('OFF')
      clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(connectWs, 5000)
    }

    ws.onerror = () => {
      ws.close()
    }
  } catch {
    log('Server not running. Start with: bun server.mjs')
    updateBadge('OFF')
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connectWs, 5000)
  }
}

function updateBadge(status) {
  try {
    chrome.runtime?.sendMessage({ type: 'badge', status })
  } catch {}
}

function readCaptions() {
  for (const sel of CAPTION_SELECTORS) {
    const els = document.querySelectorAll(sel)
    if (els.length > 0) {
      const text = Array.from(els)
        .map(el => el.textContent)
        .filter(Boolean)
        .join(' ')
        .trim()

      if (text && text !== lastText && text.length > 2) {
        lastText = text
        sendCaption(text)
      }
      return
    }
  }
}

function sendCaption(text) {
  if (!connected || !ws || ws.readyState !== 1) return

  ws.send(JSON.stringify({
    type: 'caption',
    text,
    ts: Date.now(),
    source: 'extension',
  }))
}

// MutationObserver — fires on any DOM change (captions appearing)
const observer = new MutationObserver(() => readCaptions())

function startObserving() {
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  // Backup poll every 500ms
  setInterval(readCaptions, 500)

  log('Caption observer started')
}

// Notify popup of current state
chrome.runtime?.onMessage?.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getStatus') {
    sendResponse({
      connected,
      lastText: lastText.slice(0, 50),
      url: window.location.href,
    })
  }
})

// Start
log('Initializing on ' + window.location.href)
connectWs()

// Wait for Meet to fully load before observing
if (document.readyState === 'complete') {
  startObserving()
} else {
  window.addEventListener('load', startObserving)
}
